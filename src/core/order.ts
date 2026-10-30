import type { Task } from "./types";
import { compareTasks } from "./today";

// Order inside one list. Tasks the user has moved by hand keep the place they
// were given; tasks never moved (null) follow them, by deadline as before.
export function compareListOrder(a: Task, b: Task): number {
  const ao = a.sort_order ?? null;
  const bo = b.sort_order ?? null;
  if (ao != null && bo != null) return ao - bo || compareTasks(a, b);
  if (ao != null) return -1;
  if (bo != null) return 1;
  return compareTasks(a, b);
}

// The ids with `id` taken out and put back at index `to`.
export function moveId(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  if (rest.length === ids.length) return ids;
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

// Where a dragged row lands: its centre is compared with the other rows'
// middles. `mids` are the middles of all rows in their current order, `from`
// the dragged row's index and `centre` its centre now.
export function dropIndex(mids: number[], from: number, centre: number): number {
  let to = 0;
  mids.forEach((m, i) => {
    if (i !== from && centre > m) to++;
  });
  return to;
}

// Positions to store: every task of the list, in the new order.
export function orderPatches(ids: string[]): { id: string; patch: { sort_order: number } }[] {
  return ids.map((id, i) => ({ id, patch: { sort_order: i + 1 } }));
}
