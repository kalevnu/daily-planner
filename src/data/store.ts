import type { TableName, Tables } from "../core/types";
import { SCHEMA_VERSION, TABLES, columnsOf, createTableSql } from "./schema";
import { isTauri } from "../platform/env";

type Row = Record<string, unknown>;

// Raw storage. Two implementations: SQLite in the desktop app, and
// localStorage when the UI runs in a plain browser during development.
interface Backend {
  all(table: TableName): Promise<Row[]>;
  put(table: TableName, row: Row): Promise<void>;
  // Changes only the given columns, so two windows saving different fields of
  // the same row (a note's text and its position) never undo each other.
  patch(table: TableName, id: string, fields: Row): Promise<void>;
}

class SqliteBackend implements Backend {
  private db: Promise<import("@tauri-apps/plugin-sql").default>;

  constructor() {
    this.db = (async () => {
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      const db = await Database.load("sqlite:planner.db");
      const [{ user_version }] = await db.select<{ user_version: number }[]>("PRAGMA user_version");
      if (user_version < SCHEMA_VERSION) {
        for (const t of TABLES) await db.execute(createTableSql(t));
        await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      }
      return db;
    })();
  }

  async all(table: TableName): Promise<Row[]> {
    const db = await this.db;
    return db.select<Row[]>(`SELECT * FROM ${table}`);
  }

  async put(table: TableName, row: Row): Promise<void> {
    const db = await this.db;
    const cols = columnsOf(table);
    const quoted = cols.map((c) => `"${c}"`);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = quoted.slice(1).map((c) => `${c} = excluded.${c}`);
    await db.execute(
      `INSERT INTO ${table} (${quoted.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`,
      cols.map((c) => row[c] ?? null),
    );
  }

  async patch(table: TableName, id: string, fields: Row): Promise<void> {
    const db = await this.db;
    const cols = columnsOf(table).filter((c) => c !== "id" && c in fields);
    if (!cols.length) return;
    const sets = cols.map((c, i) => `"${c}" = $${i + 1}`);
    await db.execute(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${cols.length + 1}`, [...cols.map((c) => fields[c] ?? null), id]);
  }
}

class LocalBackend implements Backend {
  private key = (t: TableName) => `planner:${t}`;

  async all(table: TableName): Promise<Row[]> {
    try {
      return JSON.parse(localStorage.getItem(this.key(table)) ?? "[]");
    } catch {
      return [];
    }
  }

  async put(table: TableName, row: Row): Promise<void> {
    const rows = await this.all(table);
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    localStorage.setItem(this.key(table), JSON.stringify(rows));
  }

  async patch(table: TableName, id: string, fields: Row): Promise<void> {
    const rows = await this.all(table);
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    rows[i] = { ...rows[i], ...fields, id };
    localStorage.setItem(this.key(table), JSON.stringify(rows));
  }
}

const backend: Backend = isTauri ? new SqliteBackend() : new LocalBackend();

// ---- change notifications across windows ----------------------------------

type Listener = (table: TableName) => void;
const listeners = new Set<Listener>();
const source = Math.random().toString(36).slice(2);
const channel = !isTauri && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("planner-db") : null;

function notify(table: TableName) {
  listeners.forEach((l) => l(table));
  if (isTauri) {
    import("@tauri-apps/api/event").then(({ emit }) => emit("db-changed", { table, source }));
  } else {
    channel?.postMessage({ table, source });
  }
}

if (isTauri) {
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ table: TableName; source: string }>("db-changed", (e) => {
      if (e.payload.source !== source) listeners.forEach((l) => l(e.payload.table));
    }),
  );
} else if (channel) {
  channel.onmessage = (e) => listeners.forEach((l) => l(e.data.table));
}

export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- repository -----------------------------------------------------------

const nowIso = () => new Date().toISOString();

export async function listAll<T extends TableName>(table: T): Promise<Tables[T][]> {
  const rows = (await backend.all(table)) as unknown as Tables[T][];
  return rows.filter((r) => !r.deleted_at);
}

// Includes soft-deleted rows, for code that must remember what the user removed.
export async function listWithDeleted<T extends TableName>(table: T): Promise<Tables[T][]> {
  return (await backend.all(table)) as unknown as Tables[T][];
}

export async function getRow<T extends TableName>(table: T, id: string): Promise<Tables[T] | undefined> {
  const rows = (await backend.all(table)) as unknown as Tables[T][];
  return rows.find((r) => r.id === id && !r.deleted_at);
}

export type NewRow<T extends TableName> = Omit<Tables[T], "id" | "created_at" | "updated_at" | "deleted_at">;

export async function createRow<T extends TableName>(table: T, fields: NewRow<T>, id?: string): Promise<Tables[T]> {
  const now = nowIso();
  const row = { ...fields, id: id ?? crypto.randomUUID(), created_at: now, updated_at: now, deleted_at: null } as Tables[T];
  await backend.put(table, row as unknown as Row);
  notify(table);
  return row;
}

export async function updateRow<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Promise<void> {
  await backend.patch(table, id, { ...patch, updated_at: nowIso() });
  notify(table);
}

export async function deleteRow(table: TableName, id: string): Promise<void> {
  await updateRow(table, id, { deleted_at: nowIso() } as never);
}

export async function restoreRow(table: TableName, id: string): Promise<void> {
  await updateRow(table, id, { deleted_at: null } as never);
}

// ---- settings (key/value) -------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  return (await getRow("settings", key))?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (await getRow("settings", key)) await updateRow("settings", key, { value });
  else await createRow("settings", { value }, key);
}
