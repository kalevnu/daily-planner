// Cloud sync through Supabase: sign-in, the server adapter, and the loop that
// keeps this device in step (on start, shortly after every local change,
// whenever the server says another device changed something, and every few
// minutes as a fallback). Runs only in the main window.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { isSyncTable } from "../core/sync";
import { clearSyncBases, getSetting, onChange, setSetting } from "./store";
import { SYNC_SERVER_ANON_KEY, SYNC_SERVER_URL } from "./syncServer";
import { runSync, type PushRow, type RemoteRow, type SyncCursor, type SyncServer } from "./syncRun";

export const SYNC_URL_KEY = "sync_url";
export const SYNC_KEY_KEY = "sync_anon_key";
const SYNC_ACCOUNT_KEY = "sync_account"; // user id this device last synced with
const SYNC_LAST_KEY = "sync_last_at";

const PAGE = 1000;
const PUSH_DELAY = 1500;
const POLL_EVERY = 5 * 60 * 1000;

// Built into the app; 설정 > 서버 바꾸기 can point a PC elsewhere.
const BUILT_IN_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SYNC_SERVER_URL;
const BUILT_IN_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SYNC_SERVER_ANON_KEY;

export type SyncPhase = "unconfigured" | "signed-out" | "idle" | "syncing" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  email: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  builtIn: boolean; // server address came with the app
}

let status: SyncStatus = { phase: "unconfigured", email: null, lastSyncedAt: null, error: null, builtIn: !!BUILT_IN_URL };
const watchers = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  watchers.forEach((w) => w(status));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function watchSyncStatus(w: (s: SyncStatus) => void): () => void {
  watchers.add(w);
  return () => watchers.delete(w);
}

// ---- client ------------------------------------------------------------------

let client: SupabaseClient | null = null;
let clientFor = "";

export async function serverConfig(): Promise<{ url: string; key: string }> {
  return {
    url: ((await getSetting(SYNC_URL_KEY)) || BUILT_IN_URL).trim(),
    key: ((await getSetting(SYNC_KEY_KEY)) || BUILT_IN_KEY).trim(),
  };
}

async function getClient(): Promise<SupabaseClient | null> {
  const { url, key } = await serverConfig();
  if (!url || !key) return null;
  if (!client || clientFor !== `${url}|${key}`) {
    stopRealtime();
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "planner-sync-auth" },
    });
    clientFor = `${url}|${key}`;
  }
  return client;
}

export async function saveServerConfig(url: string, key: string) {
  await setSetting(SYNC_URL_KEY, url.trim());
  await setSetting(SYNC_KEY_KEY, key.trim());
  await refreshStatus();
}

export function supabaseServer(c: SupabaseClient): SyncServer {
  return {
    async pull(after: number): Promise<RemoteRow[]> {
      const { data, error } = await c.from("sync_rows").select("tbl,id,data,updated_at,seq").gt("seq", after).order("seq").limit(PAGE);
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteRow[];
    },
    async push(rows: PushRow[]): Promise<void> {
      const { error } = await c.rpc("sync_push", { rows });
      if (error) throw new Error(error.message);
    },
  };
}

// ---- account -------------------------------------------------------------------

// Korean text for the errors people actually hit.
function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Invalid login credentials/i.test(m)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/Email not confirmed/i.test(m)) return "메일함의 확인 링크를 먼저 눌러 주세요.";
  if (/already registered|already been registered/i.test(m)) return "이미 가입된 이메일이에요. 로그인을 눌러 주세요.";
  if (/Password should be at least/i.test(m)) return "비밀번호는 6자 이상이어야 해요.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "서버에 연결하지 못했어요. 인터넷 연결이나 서버 주소를 확인해 주세요.";
  if (/sync_rows|sync_push|schema cache/i.test(m)) return "서버에 동기화 표가 없어요. supabase/schema.sql을 SQL Editor에서 실행해 주세요.";
  return m;
}

export async function signIn(email: string, password: string): Promise<void> {
  const c = await getClient();
  if (!c) throw new Error("서버 주소와 키를 먼저 넣어 주세요.");
  const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(explain(error));
  await afterSignIn();
}

// Returns false when the server wants the email confirmed first.
export async function signUp(email: string, password: string): Promise<boolean> {
  const c = await getClient();
  if (!c) throw new Error("서버 주소와 키를 먼저 넣어 주세요.");
  const { data, error } = await c.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(explain(error));
  if (!data.session) return false;
  await afterSignIn();
  return true;
}

export async function signOut(): Promise<void> {
  stopRealtime();
  await client?.auth.signOut();
  setStatus({ phase: "signed-out", email: null, error: null });
}

async function afterSignIn() {
  await refreshStatus();
  startRealtime();
  await syncNow();
}

async function refreshStatus() {
  const c = await getClient();
  if (!c) return setStatus({ phase: "unconfigured", email: null });
  const { data } = await c.auth.getSession();
  const user = data.session?.user;
  setStatus({
    phase: user ? (status.phase === "syncing" ? "syncing" : status.error ? "error" : "idle") : "signed-out",
    email: user?.email ?? null,
    lastSyncedAt: await getSetting(SYNC_LAST_KEY),
  });
}

// ---- the loop --------------------------------------------------------------------

const cursor: SyncCursor = { seq: 0, first: false };
let running: Promise<void> | null = null;
let again = false;

// Runs one sync, or queues one more after the sync in flight.
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

async function syncOnce() {
  const c = await getClient();
  if (!c) return setStatus({ phase: "unconfigured" });
  const { data } = await c.auth.getSession();
  const user = data.session?.user;
  if (!user) return setStatus({ phase: "signed-out", email: null });

  // Another account on this device starts over: every local row is new to it.
  if ((await getSetting(SYNC_ACCOUNT_KEY)) !== user.id) {
    await clearSyncBases();
    cursor.seq = 0;
    cursor.first = true;
  }

  setStatus({ phase: "syncing", email: user.email ?? null });
  try {
    await runSync(supabaseServer(c), cursor);
    await setSetting(SYNC_ACCOUNT_KEY, user.id);
    const at = new Date().toISOString();
    await setSetting(SYNC_LAST_KEY, at);
    setStatus({ phase: "idle", lastSyncedAt: at, error: null });
  } catch (e) {
    setStatus({ phase: "error", error: explain(e) });
  }
}

let realtime: RealtimeChannel | null = null;

function startRealtime() {
  if (!client || realtime) return;
  // Any change on the server (RLS shows only this account's rows) means
  // another device wrote something; fetch it.
  realtime = client
    .channel("sync_rows")
    .on("postgres_changes", { event: "*", schema: "public", table: "sync_rows" }, () => schedule(500))
    .subscribe();
}

function stopRealtime() {
  if (realtime && client) client.removeChannel(realtime);
  realtime = null;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (status.phase !== "signed-out" && status.phase !== "unconfigured") syncNow();
  }, ms);
}

let started = false;

export async function startSync() {
  if (started) return;
  started = true;
  // A fresh start fetches everything once, so nothing missed while closed
  // (or out of order on the server) is left behind.
  cursor.seq = 0;
  await refreshStatus();
  onChange((t) => {
    if (isSyncTable(t)) schedule(PUSH_DELAY);
  });
  const c = await getClient();
  c?.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") stopRealtime();
  });
  if (status.phase === "idle") {
    startRealtime();
    syncNow();
  }
  setInterval(() => schedule(0), POLL_EVERY);
  window.addEventListener("online", () => schedule(0));
}
