import type { TableName } from "../core/types";

type ColumnType = "TEXT" | "INTEGER" | "REAL";

// Columns beyond the shared sync columns, per table. The order here is the
// order used in SQL statements.
export const COLUMNS: Record<TableName, Record<string, ColumnType>> = {
  lists: { name: "TEXT", color: "TEXT", sort_order: "INTEGER" },
  tasks: {
    list_id: "TEXT",
    title: "TEXT",
    note: "TEXT",
    due_date: "TEXT",
    due_time: "TEXT",
    priority: "INTEGER",
    status: "TEXT",
    completed_at: "TEXT",
    rrule: "TEXT",
    today_pinned_on: "TEXT",
    remind_minutes: "INTEGER",
    sort_order: "REAL",
  },
  events: {
    title: "TEXT",
    location: "TEXT",
    note: "TEXT",
    all_day: "INTEGER",
    start: "TEXT",
    end: "TEXT",
    color: "TEXT",
    rrule: "TEXT",
    exdates: "TEXT",
    remind_minutes: "INTEGER",
  },
  notes: {
    content: "TEXT",
    color: "TEXT",
    is_open: "INTEGER",
    is_pinned: "INTEGER",
    pos_x: "REAL",
    pos_y: "REAL",
    width: "REAL",
    height: "REAL",
  },
  settings: { value: "TEXT" },
};

export const SYNC_COLUMNS = ["id", "created_at", "updated_at", "deleted_at"] as const;

export const TABLES = Object.keys(COLUMNS) as TableName[];

export function columnsOf(table: TableName): string[] {
  return [...SYNC_COLUMNS, ...Object.keys(COLUMNS[table])];
}

// Column names are quoted because "start" and "end" are SQL keywords.
export function createTableSql(table: TableName): string {
  const cols = Object.entries(COLUMNS[table]).map(([name, type]) => `"${name}" ${type}`);
  return `CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    ${cols.join(",\n    ")}
  )`;
}

// 2: tasks.sort_order (hand-made order inside a list).
export const SCHEMA_VERSION = 2;
