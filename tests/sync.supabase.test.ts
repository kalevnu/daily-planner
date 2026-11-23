import { beforeEach, describe, expect, it, vi } from "vitest";
vi.useFakeTimers({ toFake: ["Date"] });
import { decidePull, planFirstSync, rowHash, rowsToPush } from "../src/core/sync";

// ---- a tiny localStorage per simulated PC -------------------------------------

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
const g = globalThis as unknown as { localStorage: MemStorage };
g.localStorage = new MemStorage();

const store = await import("../src/data/store");
const { runSync } = await import("../src/data/syncRun");
type RemoteRow = import("../src/data/syncRun").RemoteRow;
type PushRow = import("../src/data/syncRun").PushRow;

// (FakeServer kept for reference)
// In-memory twin of supabase/schema.sql: later updated_at wins, every write gets a new seq.
class FakeServer {
  rows = new Map<string, RemoteRow>();
  seq = 0;
  async pull(after: number) {
    return [...this.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, 3); // small pages on purpose
  }
  async push(rows: PushRow[]) {
    for (const r of rows) {
      const k = `${r.tbl}:${r.id}`;
      const cur = this.rows.get(k);
      if (cur && cur.updated_at >= r.updated_at) continue;
      this.rows.set(k, { ...r, data: JSON.parse(JSON.stringify(r.data)), seq: ++this.seq });
    }
  }
}

interface Device {
  ls: MemStorage;
  cursor: { seq: number; first: boolean };
}
const device = (): Device => ({ ls: new MemStorage(), cursor: { seq: 0, first: true } });
let clock = Date.parse("2026-11-23T00:00:00Z");

// Runs `fn` "on" a device: its own storage, and a clock that always moves on.
async function on<T>(d: Device, fn: () => Promise<T>): Promise<T> {
  g.localStorage = d.ls;
  clock += 1000;
  vi.setSystemTime(clock);
  return fn();
}

const sync = (d: Device, s: FakeServer) => on(d, () => runSync(s, d.cursor));
const titles = async (d: Device) => on(d, async () => (await store.listAll("tasks")).map((t) => t.title).sort());

const newTask = (title: string, list_id: string | null = null) =>
  store.createRow("tasks", {
    list_id,
    title,
    note: "",
    due_date: null,
    due_time: null,
    priority: 0,
    status: "todo",
    completed_at: null,
    rrule: null,
    today_pinned_on: null,
    remind_minutes: null,
  });


// Runs only with a Supabase to talk to, e.g. a local one from `npx supabase start`
// with supabase/schema.sql applied:
//   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_KEY=<anon key> npx vitest run tests/sync.supabase.test.ts
const URL_ = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_KEY;
const { createClient } = await import("@supabase/supabase-js");
const { supabaseServer } = await import("../src/data/cloud");

async function account(email: string) {
  const c = createClient(URL_!, KEY!, { auth: { persistSession: false } });
  const { error } = await c.auth.signUp({ email, password: "test-pass-123" });
  if (error) throw error;
  return c;
}

describe.skipIf(!URL_ || !KEY)("real Supabase", () => {
  const stamp = Date.now();

  it("two PCs on one account meet; another account sees nothing", async () => {
    const c1 = await account(`pc-${stamp}@example.com`);
    const c1b = createClient(URL_!, KEY!, { auth: { persistSession: false } });
    await c1b.auth.signInWithPassword({ email: `pc-${stamp}@example.com`, password: "test-pass-123" });
    const other = await account(`other-${stamp}@example.com`);
    const a = device();
    const b = device();

    const t = await on(a, () => newTask("서버 거쳐 감"));
    await sync(a, supabaseServer(c1));
    await sync(b, supabaseServer(c1b));
    expect(await titles(b)).toEqual(["서버 거쳐 감"]);

    await on(b, () => store.updateRow("tasks", t.id, { title: "B에서 고침", status: "done" }));
    await sync(b, supabaseServer(c1b));
    await sync(a, supabaseServer(c1));
    const onA = await on(a, () => store.getRow("tasks", t.id));
    expect(onA).toMatchObject({ title: "B에서 고침", status: "done" });

    const { data: seen } = await other.from("sync_rows").select("id");
    expect(seen).toEqual([]);
    // Writing into someone else's rows is refused or lands in one's own space.
    await other.rpc("sync_push", { rows: [{ tbl: "tasks", id: t.id, data: { title: "해킹" }, updated_at: "2999-01-01T00:00:00.000Z" }] });
    await sync(a, supabaseServer(c1));
    expect((await on(a, () => store.getRow("tasks", t.id)))!.title).toBe("B에서 고침");
  });

  it("the server keeps the later edit even when an older copy arrives last", async () => {
    const c = await account(`lww-${stamp}@example.com`);
    const s = supabaseServer(c);
    await s.push([{ tbl: "tasks", id: "x", data: { title: "새것" }, updated_at: "2026-11-23T10:00:00.000Z" }]);
    await s.push([{ tbl: "tasks", id: "x", data: { title: "옛것" }, updated_at: "2026-11-23T09:00:00.000Z" }]);
    const rows = await s.pull(0);
    expect(rows.map((r) => r.data.title)).toEqual(["새것"]);
  });
});
