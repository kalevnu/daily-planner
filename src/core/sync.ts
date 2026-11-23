// Cloud sync rules, kept free of storage and network so they can be tested
// and shared with the phone app later.
//
// Every device keeps its own SQLite copy. The server keeps one JSON copy of
// each row. For each row a device remembers the "base": a hash of the row's
// shared fields as it was last sent or received. A row whose hash differs
// from its base was changed here since; a row equal to its base was not.
//
// Pull: a remote row replaces the local one unless both sides changed it;
// then the one edited later (updated_at) wins.
// Push: rows that differ from their base go up; the server keeps whichever
// copy has the later updated_at.
import { ACADEMIC_ID_PREFIX } from "./academic";
import type { TableName } from "./types";

type Row = Record<string, unknown>;

export const SYNC_TABLES = ["lists", "tasks", "events", "notes"] as const satisfies readonly TableName[];
export type SyncTable = (typeof SYNC_TABLES)[number];

// Fields that belong to one computer: where a sticky note sits on this
// screen and whether it is shown. They travel with a new row so the note
// appears on the other PC, but never overwrite what the other PC chose.
export const DEVICE_COLUMNS: Partial<Record<SyncTable, readonly string[]>> = {
  notes: ["is_open", "is_pinned", "pos_x", "pos_y", "width", "height"],
};

export function isSyncTable(t: string): t is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(t);
}

// The 학사일정 rows are fetched by every PC on its own.
export function shouldSync(table: SyncTable, id: string): boolean {
  return !(table === "events" && id.startsWith(ACADEMIC_ID_PREFIX));
}

const IGNORED = new Set(["id", "created_at", "updated_at"]);

function sharedEntries(table: SyncTable, row: Row): [string, unknown][] {
  const device = DEVICE_COLUMNS[table] ?? [];
  return Object.keys(row)
    .filter((k) => !IGNORED.has(k) && !device.includes(k))
    .sort()
    .map((k) => [k, row[k] ?? null]);
}

// 53-bit string hash (cyrb53); collisions are not a concern at this size.
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Hash of what the user can change and every PC should see. Columns missing
// on one side count as null, so an older app version hashes the same.
export function rowHash(table: SyncTable, row: Row): string {
  const entries = sharedEntries(table, row).filter(([, v]) => v !== null);
  return cyrb53(JSON.stringify(entries));
}

// A remote row as this device should store it: the remote's shared fields
// with this device's own fields kept.
export function mergeDeviceFields(table: SyncTable, local: Row | undefined, remote: Row): Row {
  const device = DEVICE_COLUMNS[table] ?? [];
  if (!local || !device.length) return { ...remote };
  const out = { ...remote };
  for (const k of device) out[k] = local[k] ?? null;
  return out;
}

export type PullDecision =
  | { kind: "same" } // nothing to write; base becomes the remote hash
  | { kind: "apply"; row: Row } // write row; base becomes the remote hash
  | { kind: "keep" }; // local edit is newer; leave base so it is pushed

export function decidePull(table: SyncTable, local: Row | undefined, remote: Row, base: string | undefined): PullDecision {
  if (!local) return { kind: "apply", row: { ...remote } };
  const localHash = rowHash(table, local);
  if (localHash === rowHash(table, remote)) return { kind: "same" };
  const changedHere = localHash !== base;
  if (changedHere && String(local.updated_at ?? "") >= String(remote.updated_at ?? "")) return { kind: "keep" };
  return { kind: "apply", row: mergeDeviceFields(table, local, remote) };
}

// Rows changed here since they were last synced.
export function rowsToPush(table: SyncTable, rows: Row[], bases: Map<string, string>): Row[] {
  return rows.filter((r) => shouldSync(table, String(r.id)) && bases.get(String(r.id)) !== rowHash(table, r));
}

// ---- first connection ------------------------------------------------------
// A PC that already has data joins an account that already has data. Each PC
// made its own "업무" and "개인" lists and its own welcome note on first run;
// joining should not double them.

// What a row says, without when or where it was made.
function contentKey(table: SyncTable, row: Row): string {
  return rowHash(table, row);
}

export interface FirstSyncPlan {
  drop: { table: SyncTable; id: string }[]; // local copies of rows the account already has
  remapLists: Map<string, string>; // local list id -> account list id with the same name
}

export function planFirstSync(local: Record<SyncTable, Row[]>, remote: Record<SyncTable, Row[]>): FirstSyncPlan {
  const drop: FirstSyncPlan["drop"] = [];
  const remapLists = new Map<string, string>();
  const remoteIds = new Set(SYNC_TABLES.flatMap((t) => remote[t].map((r) => `${t}:${r.id}`)));

  const liveRemoteLists = remote.lists.filter((l) => !l.deleted_at);
  for (const l of local.lists) {
    if (l.deleted_at || remoteIds.has(`lists:${l.id}`)) continue;
    const same = liveRemoteLists.find((r) => String(r.name).trim() === String(l.name).trim());
    if (same) {
      remapLists.set(String(l.id), String(same.id));
      drop.push({ table: "lists", id: String(l.id) });
    }
  }

  for (const t of ["tasks", "events", "notes"] as const) {
    const keys = new Set(remote[t].filter((r) => !r.deleted_at).map((r) => contentKey(t, r)));
    for (const r of local[t]) {
      if (r.deleted_at || remoteIds.has(`${t}:${r.id}`) || !shouldSync(t, String(r.id))) continue;
      const remapped = t === "tasks" && r.list_id && remapLists.has(String(r.list_id)) ? { ...r, list_id: remapLists.get(String(r.list_id)) } : r;
      if (keys.has(contentKey(t, remapped))) drop.push({ table: t, id: String(r.id) });
    }
  }
  return { drop, remapLists };
}
