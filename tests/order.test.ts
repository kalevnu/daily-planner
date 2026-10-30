import { describe, expect, it } from "vitest";
import { compareListOrder, dropIndex, moveId, orderPatches } from "../src/core/order";
import type { Task } from "../src/core/types";

const task = (id: string, p: Partial<Task> = {}): Task => ({
  id,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
  list_id: "work",
  title: id,
  note: "",
  due_date: null,
  due_time: null,
  priority: 0,
  status: "todo",
  completed_at: null,
  rrule: null,
  today_pinned_on: null,
  remind_minutes: null,
  ...p,
});

const ids = (ts: Task[]) => ts.map((t) => t.id);

describe("list order", () => {
  it("falls back to deadline order when nothing was moved by hand", () => {
    const ts = [task("c"), task("b", { due_date: "2026-11-02" }), task("a", { due_date: "2026-11-01" })];
    expect(ids(ts.sort(compareListOrder))).toEqual(["a", "b", "c"]);
  });

  it("keeps the hand-made order over deadlines", () => {
    const ts = [
      task("a", { due_date: "2026-11-01", sort_order: 3 }),
      task("b", { due_date: "2026-11-02", sort_order: 1 }),
      task("c", { sort_order: 2 }),
    ];
    expect(ids(ts.sort(compareListOrder))).toEqual(["b", "c", "a"]);
  });

  it("puts tasks added after a move below the moved ones", () => {
    const ts = [task("new", { due_date: "2026-10-30" }), task("x", { sort_order: 2 }), task("y", { sort_order: 1 })];
    expect(ids(ts.sort(compareListOrder))).toEqual(["y", "x", "new"]);
  });

  it("moves an id to a new index", () => {
    expect(moveId(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveId(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "b", 9)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b"], "zz", 0)).toEqual(["a", "b"]);
  });

  it("finds where a dragged row lands", () => {
    const mids = [10, 30, 50, 70];
    expect(dropIndex(mids, 0, 10)).toBe(0); // not moved
    expect(dropIndex(mids, 0, 35)).toBe(1); // past the second row's middle
    expect(dropIndex(mids, 0, 80)).toBe(3); // below everything
    expect(dropIndex(mids, 3, 5)).toBe(0); // dragged to the top
    expect(dropIndex(mids, 2, 45)).toBe(2); // short move stays
  });

  it("numbers every task of the list in the new order", () => {
    expect(orderPatches(["b", "a"])).toEqual([
      { id: "b", patch: { sort_order: 1 } },
      { id: "a", patch: { sort_order: 2 } },
    ]);
  });
});
