import type { CalendarEvent, Occurrence, Task } from "./types";
import { addDays, formatTimeKo, parseLocal, timePart, toDateStr } from "./dates";
import { expandEvents, nextOccurrence } from "./recurrence";

export interface TodaySummary {
  events: Occurrence[];
  tasks: Task[]; // due today or picked for today
  overdue: Task[];
  doneToday: Task[];
  upcoming: Task[]; // due in the next 7 days
}

export function compareTasks(a: Task, b: Task): number {
  return (
    (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
    (a.due_time ?? "99").localeCompare(b.due_time ?? "99") ||
    b.priority - a.priority ||
    a.created_at.localeCompare(b.created_at)
  );
}

export function isOnToday(t: Task, today: string): boolean {
  return t.due_date === today || t.today_pinned_on === today;
}

export function buildToday(allTasks: Task[], allEvents: CalendarEvent[], today: string): TodaySummary {
  const tasks = allTasks.filter((t) => !t.deleted_at);
  const todo = tasks.filter((t) => t.status === "todo");
  const weekEnd = addDays(today, 7);

  const events = expandEvents(allEvents, today, today).sort(
    (a, b) => Number(b.event.all_day) - Number(a.event.all_day) || a.start.localeCompare(b.start),
  );

  return {
    events,
    tasks: todo.filter((t) => isOnToday(t, today)).sort(compareTasks),
    overdue: todo.filter((t) => t.due_date && t.due_date < today && t.today_pinned_on !== today).sort(compareTasks),
    doneToday: tasks.filter((t) => t.status === "done" && t.completed_at && localDateOf(t.completed_at) === today),
    upcoming: todo
      .filter((t) => t.due_date && t.due_date > today && t.due_date <= weekEnd && t.today_pinned_on !== today)
      .sort(compareTasks),
  };
}

function localDateOf(iso: string): string {
  return toDateStr(new Date(iso));
}

// The change to apply when a task is checked off. A repeating task moves to
// its next occurrence instead of being marked done.
export function completionPatch(task: Task, nowIso: string): Partial<Task> {
  if (task.rrule && task.due_date) {
    const next = nextOccurrence(task.rrule, task.due_date, task.due_date);
    if (next) return { due_date: next, today_pinned_on: null };
  }
  return { status: "done", completed_at: nowIso };
}

export function reopenPatch(): Partial<Task> {
  return { status: "todo", completed_at: null };
}

export interface Reminder {
  key: string; // unique per item occurrence, used to fire only once
  title: string;
  body: string;
  at: Date;
}

const ALL_DAY_REMINDER_TIME = "09:00";

// Reminders whose time falls in (now - windowMinutes, now].
export function dueReminders(tasks: Task[], events: CalendarEvent[], now: Date, windowMinutes = 10): Reminder[] {
  const out: Reminder[] = [];
  const minAt = now.getTime() - windowMinutes * 60000;
  const inWindow = (at: Date) => at.getTime() > minAt && at.getTime() <= now.getTime();

  for (const t of tasks) {
    if (t.deleted_at || t.status !== "todo" || t.remind_minutes == null || !t.due_date || !t.due_time) continue;
    const at = new Date(parseLocal(`${t.due_date}T${t.due_time}`).getTime() - t.remind_minutes * 60000);
    if (inWindow(at)) {
      out.push({ key: `task:${t.id}:${t.due_date}`, title: t.title, body: reminderBody(t.remind_minutes, t.due_time), at });
    }
  }

  const today = toDateStr(now);
  const withReminder = events.filter((e) => e.remind_minutes != null);
  // A reminder can fire up to a few days before the occurrence.
  for (const occ of expandEvents(withReminder, addDays(today, -1), addDays(today, 7))) {
    const time = timePart(occ.start) ?? ALL_DAY_REMINDER_TIME;
    const at = new Date(parseLocal(`${occ.start.slice(0, 10)}T${time}`).getTime() - occ.event.remind_minutes! * 60000);
    if (inWindow(at)) {
      out.push({
        key: `event:${occ.key}`,
        title: occ.event.title,
        body: occ.event.all_day ? "오늘 종일 일정" : reminderBody(occ.event.remind_minutes!, time),
        at,
      });
    }
  }
  return out;
}

function reminderBody(minutes: number, time: string): string {
  const label = formatTimeKo(time);
  if (minutes === 0) return `지금 (${label})`;
  if (minutes < 60) return `${minutes}분 후 (${label})`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 후 (${label})`;
  return `${Math.round(minutes / 60)}시간 후 (${label})`;
}

export const REMINDER_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "알림 없음", minutes: null },
  { label: "정각", minutes: 0 },
  { label: "5분 전", minutes: 5 },
  { label: "10분 전", minutes: 10 },
  { label: "30분 전", minutes: 30 },
  { label: "1시간 전", minutes: 60 },
  { label: "1일 전", minutes: 1440 },
];
