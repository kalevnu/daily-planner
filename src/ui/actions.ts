import type { CalendarEvent, Note, Task } from "../core/types";
import { addDays, toDateStr } from "../core/dates";
import { completionPatch, reopenPatch } from "../core/today";
import { createRow, deleteRow, getRow, listAll, restoreRow, updateRow, updateRows, type NewRow } from "../data/store";
import { orderPatches } from "../core/order";
import { closeWindow, openNoteWindow } from "../platform/desktop";
import { showToast } from "./toast";

export const LIST_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];
export const NOTE_COLORS = ["yellow", "pink", "green", "blue", "purple", "gray"] as const;

const today = () => toDateStr(new Date());

export function newTask(fields: Partial<NewRow<"tasks">>): NewRow<"tasks"> {
  return {
    list_id: null,
    title: "",
    note: "",
    due_date: null,
    due_time: null,
    priority: 0,
    status: "todo",
    completed_at: null,
    rrule: null,
    today_pinned_on: null,
    remind_minutes: null,
    ...fields,
  };
}

export function addTask(fields: Partial<NewRow<"tasks">>) {
  return createRow("tasks", newTask(fields));
}

// Saves a list's tasks in the order the user dragged them into.
export function reorderTasks(ids: string[]) {
  return updateRows("tasks", orderPatches(ids));
}

export async function toggleTask(t: Task) {
  if (t.status === "done") {
    await updateRow("tasks", t.id, reopenPatch());
    return;
  }
  const patch = completionPatch(t, new Date().toISOString());
  await updateRow("tasks", t.id, patch);
  if (patch.status === "done") {
    showToast(`'${t.title}' 완료`, () => updateRow("tasks", t.id, reopenPatch()));
  } else {
    showToast(`'${t.title}' 다음 반복으로 이동 (${patch.due_date})`, () =>
      updateRow("tasks", t.id, { due_date: t.due_date, today_pinned_on: t.today_pinned_on }),
    );
  }
}

export function moveTaskTo(t: Task, date: string) {
  return updateRow("tasks", t.id, { due_date: date, today_pinned_on: null });
}

export function pickForToday(t: Task) {
  return updateRow("tasks", t.id, { today_pinned_on: today() });
}

export function unpickFromToday(t: Task) {
  return updateRow("tasks", t.id, { today_pinned_on: null });
}

export function moveToTomorrow(t: Task) {
  return moveTaskTo(t, addDays(today(), 1));
}

export async function removeTask(t: Task) {
  await deleteRow("tasks", t.id);
  showToast(`'${t.title}' 삭제됨`, () => restoreRow("tasks", t.id));
}

// ---- events ---------------------------------------------------------------

export function newEvent(fields: Partial<NewRow<"events">>): NewRow<"events"> {
  return {
    title: "",
    location: "",
    note: "",
    all_day: 0,
    start: `${today()}T09:00`,
    end: `${today()}T10:00`,
    color: LIST_COLORS[0],
    rrule: null,
    exdates: "",
    remind_minutes: 10,
    ...fields,
  };
}

export async function removeEvent(ev: CalendarEvent) {
  await deleteRow("events", ev.id);
  showToast(`'${ev.title}' 삭제됨`, () => restoreRow("events", ev.id));
}

// Removes a single occurrence from a repeating series.
export async function removeOccurrence(ev: CalendarEvent, date: string) {
  const exdates = [...ev.exdates.split(",").filter(Boolean), date].join(",");
  await updateRow("events", ev.id, { exdates });
  showToast(`${date} 일정만 삭제됨`, () => updateRow("events", ev.id, { exdates: ev.exdates }));
}

// ---- notes ----------------------------------------------------------------

// New notes cascade from the most recently placed open note so they do not
// cover each other.
async function nextNotePosition(): Promise<{ pos_x: number | null; pos_y: number | null }> {
  const placed = (await listAll("notes"))
    .filter((n) => n.is_open && n.pos_x != null && n.pos_y != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!placed.length) return { pos_x: null, pos_y: null };
  return { pos_x: placed[0].pos_x! + 32, pos_y: placed[0].pos_y! + 32 };
}

export async function createNote(content = "", openOnDesktop = true): Promise<Note> {
  const note = await createRow("notes", {
    content,
    color: "yellow",
    is_open: openOnDesktop ? 1 : 0,
    is_pinned: 1,
    ...(await nextNotePosition()),
    width: 280,
    height: 280,
  });
  if (openOnDesktop) await showNote(note);
  return note;
}

export async function showNote(note: Note) {
  if (!note.is_open) await updateRow("notes", note.id, { is_open: 1 });
  await openNoteWindow(note.id, { x: note.pos_x, y: note.pos_y, width: note.width, height: note.height }, !!note.is_pinned);
}

export async function hideNote(id: string) {
  await updateRow("notes", id, { is_open: 0 });
  await closeWindow(`note-${id}`);
}

export async function removeNote(note: Note) {
  await deleteRow("notes", note.id);
  await closeWindow(`note-${note.id}`);
  showToast("메모 삭제됨", async () => {
    await restoreRow("notes", note.id);
    const restored = await getRow("notes", note.id);
    if (restored?.is_open) await showNote(restored);
  });
}
