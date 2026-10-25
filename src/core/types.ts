// Shared data model. Every row carries the sync columns (id, created_at,
// updated_at, deleted_at) so cloud sync can be added later without a rewrite.
// Dates are local wall-clock strings: "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm".

export interface SyncFields {
  id: string;
  created_at: string; // ISO timestamp (UTC)
  updated_at: string; // ISO timestamp (UTC), last write wins on sync
  deleted_at: string | null; // soft delete so deletions can propagate
}

export interface TaskList extends SyncFields {
  name: string;
  color: string;
  sort_order: number;
}

export type Priority = 0 | 1 | 2 | 3; // 0 = none, 3 = highest

export interface Task extends SyncFields {
  list_id: string | null;
  title: string;
  note: string;
  due_date: string | null; // YYYY-MM-DD
  due_time: string | null; // HH:mm
  priority: Priority;
  status: "todo" | "done";
  completed_at: string | null;
  rrule: string | null; // e.g. "FREQ=WEEKLY;BYDAY=MO"; due_date is the next occurrence
  today_pinned_on: string | null; // YYYY-MM-DD the task was picked for "today"
  remind_minutes: number | null; // minutes before due_date+due_time
}

export interface CalendarEvent extends SyncFields {
  title: string;
  location: string;
  note: string;
  all_day: number; // 1 = all-day (start/end are YYYY-MM-DD, end inclusive)
  start: string; // YYYY-MM-DD or YYYY-MM-DDTHH:mm
  end: string; // YYYY-MM-DD or YYYY-MM-DDTHH:mm
  color: string;
  rrule: string | null;
  exdates: string; // comma separated occurrence dates (YYYY-MM-DD) removed from the series
  remind_minutes: number | null;
}

export interface Note extends SyncFields {
  content: string; // plain text, "- [ ]" / "- [x]" lines render as checkboxes
  color: string;
  is_open: number; // 1 = shown as a sticky window on the desktop
  is_pinned: number; // 1 = always on top
  pos_x: number | null;
  pos_y: number | null;
  width: number;
  height: number;
}

export interface Setting extends SyncFields {
  value: string;
}

export interface Tables {
  lists: TaskList;
  tasks: Task;
  events: CalendarEvent;
  notes: Note;
  settings: Setting;
}

export type TableName = keyof Tables;

// One concrete occurrence of a (possibly recurring) event.
export interface Occurrence {
  event: CalendarEvent;
  start: string;
  end: string;
  key: string; // event id + occurrence date, unique per occurrence
}
