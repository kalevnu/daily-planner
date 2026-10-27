import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../src/core/quickParse";
import { tidyMarkdown } from "../src/core/markdown";
import { describeRule, expandEvent, nextOccurrence, occursOn } from "../src/core/recurrence";
import { shortDueKo } from "../src/core/dates";
import { buildToday, completionPatch, dueReminders } from "../src/core/today";
import type { CalendarEvent, Task, TaskList } from "../src/core/types";

const base = { created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", deleted_at: null };

const task = (p: Partial<Task>): Task => ({
  ...base,
  id: Math.random().toString(),
  list_id: null,
  title: "t",
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

const event = (p: Partial<CalendarEvent>): CalendarEvent => ({
  ...base,
  id: Math.random().toString(),
  title: "e",
  location: "",
  note: "",
  all_day: 0,
  start: "2026-10-26T10:00",
  end: "2026-10-26T11:00",
  color: "#3b82f6",
  rrule: null,
  exdates: "",
  remind_minutes: null,
  ...p,
});

// 2026-10-25 is a Sunday.
const TODAY = "2026-10-25";

describe("parseQuickAdd", () => {
  const lists: TaskList[] = [{ ...base, id: "work", name: "업무", color: "#000", sort_order: 0 }];

  it("parses relative day, pm time, priority and list", () => {
    expect(parseQuickAdd("내일 오후 3시 보고서 제출 !1 #업무", TODAY, lists)).toEqual({
      title: "보고서 제출",
      due_date: "2026-10-26",
      due_time: "15:00",
      priority: 3,
      list_id: "work",
    });
  });

  it("treats a bare small hour as afternoon and defaults the date to today", () => {
    const r = parseQuickAdd("3시반 회의", TODAY);
    expect(r).toMatchObject({ title: "회의", due_date: TODAY, due_time: "15:30" });
  });

  it("parses weekdays and next week", () => {
    expect(parseQuickAdd("금요일 정산", TODAY).due_date).toBe("2026-10-30");
    expect(parseQuickAdd("다음주 월요일 주간회의", TODAY).due_date).toBe("2026-10-26");
    // From a Wednesday, "다음주 월요일" is the Monday after this week.
    expect(parseQuickAdd("다음주 월요일 주간회의", "2026-10-28").due_date).toBe("2026-11-02");
  });

  it("parses absolute dates and rolls past dates into next year", () => {
    expect(parseQuickAdd("11월 3일 병원", TODAY).due_date).toBe("2026-11-03");
    expect(parseQuickAdd("1/5 신년회", TODAY).due_date).toBe("2027-01-05");
  });

  it("takes a glued particle with the date or time", () => {
    expect(parseQuickAdd("10월 31일까지 생성형 AI 계정활용 현황 작성", TODAY)).toMatchObject({
      title: "생성형 AI 계정활용 현황 작성",
      due_date: "2026-10-31",
    });
    expect(parseQuickAdd("10월 31일 까지 생성형 AI 계정활용 현황 작성", TODAY).title).toBe("생성형 AI 계정활용 현황 작성");
    expect(parseQuickAdd("내일까지 보고서", TODAY)).toMatchObject({ title: "보고서", due_date: "2026-10-26" });
    expect(parseQuickAdd("3시에 회의", TODAY)).toMatchObject({ title: "회의", due_time: "15:00" });
    expect(parseQuickAdd("보고서 금요일부터 작성", TODAY)).toMatchObject({ title: "보고서 작성", due_date: "2026-10-30" });
  });

  it("parses 오전/오후 with HH:MM and 금주", () => {
    expect(parseQuickAdd("금주 일요일 오전 12:59분까지 로봇공학논문연구 Mid-presentation", "2026-10-26")).toMatchObject({
      title: "로봇공학논문연구 Mid-presentation",
      due_date: "2026-11-01",
      due_time: "00:59",
    });
    expect(parseQuickAdd("오후 1:30 회의", TODAY).due_time).toBe("13:30");
  });

  it("keeps unknown list tags and plain text", () => {
    expect(parseQuickAdd("우유 사기 #장보기", TODAY)).toMatchObject({ title: "우유 사기 #장보기", due_date: null, list_id: null });
  });
});

describe("recurrence", () => {
  it("finds the next weekly occurrence", () => {
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO,WE", "2026-10-26", "2026-10-26")).toBe("2026-10-28");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO,WE", "2026-10-26", "2026-10-28")).toBe("2026-11-02");
  });

  it("checks occurrence on a date", () => {
    expect(occursOn("FREQ=MONTHLY;BYMONTHDAY=25", "2026-01-25", TODAY)).toBe(true);
    expect(occursOn("FREQ=MONTHLY;BYMONTHDAY=25", "2026-01-25", "2026-10-24")).toBe(false);
  });

  it("describes rules in Korean", () => {
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("평일");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("매주 월·수");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=10")).toBe("매월 10일");
  });

  it("expands a recurring timed event and honours exdates", () => {
    const ev = event({ rrule: "FREQ=WEEKLY;BYDAY=MO", exdates: "2026-11-02" });
    const occ = expandEvent(ev, "2026-10-26", "2026-11-15");
    expect(occ.map((o) => o.start)).toEqual(["2026-10-26T10:00", "2026-11-09T10:00"]);
    expect(occ[0].end).toBe("2026-10-26T11:00");
  });

  it("keeps a multi-day period that started before the range", () => {
    const trip = event({ all_day: 1, start: "2026-10-23", end: "2026-10-27" });
    expect(expandEvent(trip, TODAY, TODAY)).toHaveLength(1);
    const yearly = event({ all_day: 1, start: "2025-10-24", end: "2025-10-26", rrule: "FREQ=YEARLY" });
    expect(expandEvent(yearly, TODAY, TODAY).map((o) => o.start)).toEqual(["2026-10-24"]);
  });
});

describe("today summary", () => {
  it("splits tasks into today, overdue, upcoming and done", () => {
    const tasks = [
      task({ title: "today", due_date: TODAY }),
      task({ title: "picked", due_date: "2026-10-30", today_pinned_on: TODAY }),
      task({ title: "late", due_date: "2026-10-20" }),
      task({ title: "soon", due_date: "2026-10-28" }),
      task({ title: "far", due_date: "2026-12-01" }),
      task({ title: "done", status: "done", completed_at: new Date().toISOString() }),
      task({ title: "deleted", due_date: TODAY, deleted_at: "x" }),
    ];
    const s = buildToday(tasks, [event({ start: `${TODAY}T09:00`, end: `${TODAY}T10:00` })], TODAY);
    expect(s.tasks.map((t) => t.title)).toEqual(["today", "picked"]);
    expect(s.overdue.map((t) => t.title)).toEqual(["late"]);
    expect(s.upcoming.map((t) => t.title)).toEqual(["soon"]);
    expect(s.events).toHaveLength(1);
  });

  it("moves a repeating task to its next date instead of finishing it", () => {
    const weekly = task({ due_date: "2026-10-26", rrule: "FREQ=WEEKLY;BYDAY=MO", today_pinned_on: "2026-10-26" });
    expect(completionPatch(weekly, "now")).toEqual({ due_date: "2026-11-02", today_pinned_on: null });
    expect(completionPatch(task({}), "now")).toEqual({ status: "done", completed_at: "now" });
  });
});

describe("reminders", () => {
  it("fires task and event reminders inside the window only", () => {
    const now = new Date(2026, 9, 26, 9, 50);
    const tasks = [
      task({ title: "report", due_date: "2026-10-26", due_time: "10:00", remind_minutes: 10 }),
      task({ title: "later", due_date: "2026-10-26", due_time: "12:00", remind_minutes: 10 }),
    ];
    const events = [event({ title: "standup", rrule: "FREQ=DAILY", start: "2026-10-01T09:55", end: "2026-10-01T10:05", remind_minutes: 5 })];
    const due = dueReminders(tasks, events, now);
    expect(due.map((r) => r.title).sort()).toEqual(["report", "standup"]);
    expect(due.find((r) => r.title === "report")!.body).toBe("10분 후 (오전 10:00)");
  });
});

describe("tidyMarkdown", () => {
  it("tightens lists and turns hard breaks into newlines", () => {
    expect(tidyMarkdown("hi\n\n- [x] one\n\n- [ ] two\n\n점심\\\n저녁\n")).toBe("hi\n\n- [x] one\n- [ ] two\n\n점심\n저녁");
    expect(tidyMarkdown("# t\n\n1. a\n2. b")).toBe("# t\n\n1. a\n2. b");
  });
});

describe("shortDueKo", () => {
  const today = "2026-10-26"; // a Monday
  it("names the nearest days", () => {
    expect(shortDueKo("2026-10-26", today)).toBe("오늘");
    expect(shortDueKo("2026-10-27", today)).toBe("내일");
    expect(shortDueKo("2026-10-25", today)).toBe("어제");
    expect(shortDueKo("2026-10-20", today)).toBe("6일 지남");
  });
  it("shows weekday first within the week, date first after", () => {
    expect(shortDueKo("2026-10-28", today)).toBe("수 10/28");
    expect(shortDueKo("2026-11-01", today)).toBe("일 11/1");
    expect(shortDueKo("2026-11-02", today)).toBe("11/2 (월)");
    expect(shortDueKo("2027-01-05", today)).toBe("1/5 (화)");
  });
});
