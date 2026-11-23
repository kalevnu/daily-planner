// One round of cloud sync between this device's database and a server:
// pull what changed there, then push what changed here. The server is
// passed in, so tests can use an in-memory one.
import { SYNC_TABLES, decidePull, planFirstSync, rowHash, rowsToPush, shouldSync, type SyncTable } from "../core/sync";
import type { TableName } from "../core/types";
import { dropRaw, getSetting, notify, putRaw, rawRows, setSetting, setSyncBases, syncBases } from "./store";

type Row = Record<string, unknown>;

export interface RemoteRow {
  tbl: string;
  id: string;
  data: Row;
  updated_at: string;
  seq: number;
}

export interface PushRow {
  tbl: string;
  id: string;
  data: Row;
  updated_at: string;
}

export interface SyncServer {
  // Rows with seq > after, in seq order; at most one page.
  pull(after: number): Promise<RemoteRow[]>;
  push(rows: PushRow[]): Promise<void>;
}

export interface SyncCursor {
  seq: number; // highest server seq seen
  first: boolean; // this device has never synced with this account
}

export interface SyncResult {
  pulled: number; // rows written here from the server
  pushed: number; // rows sent up
}

const PUSH_BATCH = 500;

async function pullAll(server: SyncServer, after: number): Promise<RemoteRow[]> {
  const out: RemoteRow[] = [];
  let cursor = after;
  for (;;) {
    const page = await server.pull(cursor);
    if (!page.length) return out;
    out.push(...page);
    cursor = page[page.length - 1].seq;
  }
}

// The list sticky's open/position setting follows its list to the new id.
async function moveListSticky(from: string, to: string) {
  const saved = await getSetting(`list_sticky:${from}`);
  if (saved && !(await getSetting(`list_sticky:${to}`))) await setSetting(`list_sticky:${to}`, saved);
}

export async function runSync(server: SyncServer, cursor: SyncCursor): Promise<SyncResult> {
  const remote = await pullAll(server, cursor.seq);
  const latest = new Map<string, RemoteRow>(); // later seq wins
  for (const r of remote) if (isSyncTableName(r.tbl)) latest.set(`${r.tbl}:${r.id}`, r);
  const byTable = Object.fromEntries(SYNC_TABLES.map((t) => [t, [] as Row[]])) as Record<SyncTable, Row[]>;
  for (const r of latest.values()) byTable[r.tbl as SyncTable].push({ ...r.data, id: r.id, updated_at: r.updated_at });

  const changed = new Set<TableName>();

  if (cursor.first) {
    const local = Object.fromEntries(await Promise.all(SYNC_TABLES.map(async (t) => [t, await rawRows(t)]))) as Record<SyncTable, Row[]>;
    const plan = planFirstSync(local, byTable);
    const now = new Date().toISOString();
    for (const t of local.tasks) {
      const to = t.list_id ? plan.remapLists.get(String(t.list_id)) : undefined;
      if (to) {
        await putRaw("tasks", { ...t, list_id: to, updated_at: now });
        changed.add("tasks");
      }
    }
    for (const [from, to] of plan.remapLists) await moveListSticky(from, to);
    for (const { table, id } of plan.drop) {
      await dropRaw(table, id);
      changed.add(table);
    }
  }

  let pulled = 0;
  let pushed = 0;
  for (const table of SYNC_TABLES) {
    const bases = await syncBases(table);
    const local = new Map((await rawRows(table)).map((r) => [String(r.id), r]));
    const newBases: [string, string][] = [];
    for (const r of byTable[table]) {
      const id = String(r.id);
      if (!shouldSync(table, id)) continue;
      const d = decidePull(table, local.get(id), r, bases.get(id));
      if (d.kind === "keep") continue;
      if (d.kind === "apply") {
        await putRaw(table, d.row);
        local.set(id, d.row);
        pulled++;
        changed.add(table);
      }
      const h = rowHash(table, r);
      bases.set(id, h);
      newBases.push([id, h]);
    }
    await setSyncBases(table, newBases);

    const up = rowsToPush(table, [...local.values()], bases);
    for (let i = 0; i < up.length; i += PUSH_BATCH) {
      const chunk = up.slice(i, i + PUSH_BATCH);
      await server.push(chunk.map((r) => ({ tbl: table, id: String(r.id), data: r, updated_at: String(r.updated_at) })));
      await setSyncBases(
        table,
        chunk.map((r) => [String(r.id), rowHash(table, r)]),
      );
      pushed += chunk.length;
    }
  }

  if (remote.length) cursor.seq = remote[remote.length - 1].seq;
  cursor.first = false;
  for (const t of changed) notify(t);
  return { pulled, pushed };
}

function isSyncTableName(t: string): t is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(t);
}
