import { useEffect, useState } from "react";
import type { TableName, Tables } from "../core/types";
import { listAll, onChange } from "../data/store";
import { toDateStr } from "../core/dates";

// Rows of a table (without deleted rows), reloaded whenever any window changes it.
export function useTable<T extends TableName>(table: T): Tables[T][] {
  const [rows, setRows] = useState<Tables[T][]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => listAll(table).then((r) => alive && setRows(r));
    load();
    const off = onChange((t) => t === table && load());
    return () => {
      alive = false;
      off();
    };
  }, [table]);
  return rows;
}

// Today's local date, updated when the day changes.
export function useToday(): string {
  const [today, setToday] = useState(() => toDateStr(new Date()));
  useEffect(() => {
    const id = setInterval(() => setToday(toDateStr(new Date())), 30000);
    return () => clearInterval(id);
  }, []);
  return today;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
