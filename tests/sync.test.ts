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

// ---- pure rules ----------------------------------------------------------------

describe("sync rules", () => {
  const row = { id: "a", created_at: "x", updated_at: "2026-11-01T00:00:00.000Z", deleted_at: null, title: "A", content: "c", pos_x: 1, is_open: 1 };

  it("hash ignores timestamps and a note's place on this screen", () => {
    expect(rowHash("notes", row)).toBe(rowHash("notes", { ...row, updated_at: "later", pos_x: 500, is_open: 0 }));
    expect(rowHash("notes", row)).not.toBe(rowHash("notes", { ...row, content: "d" }));
    expect(rowHash("tasks", { ...row, sort_order: null })).toBe(rowHash("tasks", row)); // missing column = null
  });

  it("takes the remote copy unless this side changed it later", () => {
    const base = rowHash("tasks", row);
    const remote = { ...row, title: "B", updated_at: "2026-11-02T00:00:00.000Z" };
    expect(decidePull("tasks", row, remote, base).kind).toBe("apply");
    const editedEarlier = { ...row, title: "C", updated_at: "2026-11-01T12:00:00.000Z" };
    expect(decidePull("tasks", editedEarlier, remote, base).kind).toBe("apply");
    const editedLater = { ...row, title: "C", updated_at: "2026-11-03T00:00:00.000Z" };
    expect(decidePull("tasks", editedLater, remote, base).kind).toBe("keep");
    expect(decidePull("tasks", row, { ...row, updated_at: "z" }, base).kind).toBe("same");
  });

  it("keeps where a note sits on this PC when its text changes elsewhere", () => {
    const remote = { ...row, content: "new", pos_x: 900, is_open: 0, updated_at: "2026-11-05T00:00:00.000Z" };
    const d = decidePull("notes", row, remote, rowHash("notes", row));
    expect(d).toMatchObject({ kind: "apply", row: { content: "new", pos_x: 1, is_open: 1 } });
  });

  it("pushes only rows changed since the last sync, never the 학사일정", () => {
    const bases = new Map([["a", rowHash("tasks", row)]]);
    const rows = [row, { ...row, id: "b" }, { ...row, id: "hyu-grad:x" }];
    expect(rowsToPush("tasks", rows, bases).map((r) => r.id)).toEqual(["b", "hyu-grad:x"]);
    expect(rowsToPush("events", rows, bases).map((r) => r.id)).toEqual(["b"]);
  });

  it("first sync folds same-named lists and identical notes into the account's", () => {
    const empty = { lists: [], tasks: [], events: [], notes: [] };
    const plan = planFirstSync(
      {
        ...empty,
        lists: [{ id: "l1", name: "업무" }, { id: "l2", name: "취미" }],
        notes: [{ id: "n1", content: "환영", color: "y", deleted_at: null }],
      },
      { ...empty, lists: [{ id: "r1", name: "업무", deleted_at: null }], notes: [{ id: "rn", content: "환영", color: "y", deleted_at: null }] },
    );
    expect([...plan.remapLists]).toEqual([["l1", "r1"]]);
    expect(plan.drop).toEqual([
      { table: "lists", id: "l1" },
      { table: "notes", id: "n1" },
    ]);
  });
});

// ---- two PCs through one server ------------------------------------------------------

describe("two PCs", () => {
  let server: FakeServer;
  let a: Device;
  let b: Device;
  beforeEach(() => {
    server = new FakeServer();
    a = device();
    b = device();
  });

  it("joins two PCs that both have data, without doubling the default lists", async () => {
    await on(a, async () => {
      const work = await store.createRow("lists", { name: "업무", color: "#1", sort_order: 0 });
      await store.createRow("lists", { name: "개인", color: "#2", sort_order: 1 });
      await newTask("A 보고서", work.id);
    });
    await on(b, async () => {
      const work = await store.createRow("lists", { name: "업무", color: "#1", sort_order: 0 });
      await store.createRow("lists", { name: "개인", color: "#2", sort_order: 1 });
      await newTask("B 회의", work.id);
    });

    await sync(a, server);
    await sync(b, server);
    await sync(a, server);

    expect(await titles(a)).toEqual(["A 보고서", "B 회의"]);
    expect(await titles(b)).toEqual(["A 보고서", "B 회의"]);
    for (const d of [a, b]) {
      const lists = await on(d, () => store.listAll("lists"));
      expect(lists.map((l) => l.name).sort()).toEqual(["개인", "업무"]);
      const tasks = await on(d, () => store.listAll("tasks"));
      expect(new Set(tasks.map((t) => t.list_id))).toEqual(new Set([lists.find((l) => l.name === "업무")!.id]));
    }
  });

  it("carries edits and deletions both ways, and the later edit wins a clash", async () => {
    const t = await on(a, () => newTask("원래"));
    await sync(a, server);
    await sync(b, server);
    expect(await titles(b)).toEqual(["원래"]);

    await on(b, () => store.updateRow("tasks", t.id, { title: "B가 고침" }));
    await sync(b, server);
    await sync(a, server);
    expect(await titles(a)).toEqual(["B가 고침"]);

    // Both change it before syncing; A's edit is later.
    await on(b, () => store.updateRow("tasks", t.id, { title: "B 먼저" }));
    await on(a, () => store.updateRow("tasks", t.id, { title: "A 나중" }));
    await sync(b, server);
    await sync(a, server);
    await sync(b, server);
    expect(await titles(a)).toEqual(["A 나중"]);
    expect(await titles(b)).toEqual(["A 나중"]);

    await on(a, () => store.deleteRow("tasks", t.id));
    await sync(a, server);
    await sync(b, server);
    expect(await titles(b)).toEqual([]);
  });

  it("does not send rows that did not change, and a second pass is quiet", async () => {
    await on(a, () => newTask("하나"));
    expect((await sync(a, server)).pushed).toBe(1);
    expect(await sync(a, server)).toEqual({ pulled: 0, pushed: 0 });
    await sync(b, server);
    expect(await sync(b, server)).toEqual({ pulled: 0, pushed: 0 });
  });
});
