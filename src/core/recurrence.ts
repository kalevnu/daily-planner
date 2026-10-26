import { RRule } from "rrule";
import type { CalendarEvent, Occurrence } from "./types";
import { addDays, datePart, parseLocal, timePart } from "./dates";

// rrule computes in UTC. We feed it "floating" dates (local wall-clock values
// stored in UTC fields) and read them back the same way, so DST and the
// machine's time zone never shift an occurrence.
function floating(dateStr: string): Date {
  const [y, m, d] = datePart(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromFloating(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function build(rule: string, dtstart: string): RRule {
  return new RRule({ ...RRule.parseString(rule), dtstart: floating(dtstart) });
}

// Occurrence dates (YYYY-MM-DD) of a rule within [from, to], inclusive.
export function occurrencesBetween(rule: string, dtstart: string, from: string, to: string): string[] {
  return build(rule, dtstart)
    .between(floating(from), floating(to), true)
    .map(fromFloating);
}

export function occursOn(rule: string, dtstart: string, date: string): boolean {
  return occurrencesBetween(rule, dtstart, date, date).length > 0;
}

// First occurrence strictly after `date`, or null when the series has ended.
export function nextOccurrence(rule: string, dtstart: string, date: string): string | null {
  const next = build(rule, dtstart).after(floating(date), false);
  return next ? fromFloating(next) : null;
}

export interface RepeatPreset {
  label: string;
  rule: string | null;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_KO: Record<string, string> = { MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토", SU: "일" };

// Presets offered in the editors, based on the item's start date.
export function repeatPresets(dateStr: string): RepeatPreset[] {
  const d = parseLocal(dateStr);
  const day = BYDAY[d.getDay()];
  return [
    { label: "반복 안 함", rule: null },
    { label: "매일", rule: "FREQ=DAILY" },
    { label: "평일 (월~금)", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { label: `매주 ${DAY_KO[day]}요일`, rule: `FREQ=WEEKLY;BYDAY=${day}` },
    { label: `매월 ${d.getDate()}일`, rule: `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}` },
    { label: `매년 ${d.getMonth() + 1}월 ${d.getDate()}일`, rule: "FREQ=YEARLY" },
  ];
}

export function weeklyRule(days: string[]): string {
  return `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
}

// Short Korean description, e.g. "매주 월·수".
export function describeRule(rule: string | null): string {
  if (!rule) return "";
  const parts = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]));
  const interval = Number(parts.INTERVAL ?? 1);
  switch (parts.FREQ) {
    case "DAILY":
      return interval > 1 ? `${interval}일마다` : "매일";
    case "WEEKLY": {
      const days = (parts.BYDAY ?? "").split(",").filter(Boolean);
      if (days.length === 5 && !days.includes("SA") && !days.includes("SU")) return "평일";
      const names = days.map((x) => DAY_KO[x]).join("·");
      return `${interval > 1 ? `${interval}주마다` : "매주"} ${names}`.trim();
    }
    case "MONTHLY":
      return parts.BYMONTHDAY ? `매월 ${parts.BYMONTHDAY}일` : "매월";
    case "YEARLY":
      return "매년";
    default:
      return "반복";
  }
}

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
export const WEEKDAY_LABELS = WEEKDAY_CODES.map((c) => DAY_KO[c]);

export function ruleWeekdays(rule: string | null): string[] {
  const m = rule?.match(/BYDAY=([A-Z,]+)/);
  return m ? m[1].split(",") : [];
}

function eventSpanDays(ev: CalendarEvent): number {
  return Math.round((parseLocal(datePart(ev.end)).getTime() - parseLocal(datePart(ev.start)).getTime()) / 86400000);
}

// Concrete occurrences of an event that overlap [from, to] (dates, inclusive).
export function expandEvent(ev: CalendarEvent, from: string, to: string): Occurrence[] {
  const span = eventSpanDays(ev);
  const startTime = timePart(ev.start);
  const endTime = timePart(ev.end);
  const make = (date: string): Occurrence => {
    const endDate = addDays(date, span);
    return {
      event: ev,
      start: startTime ? `${date}T${startTime}` : date,
      end: endTime ? `${endDate}T${endTime}` : endDate,
      key: `${ev.id}:${date}`,
    };
  };

  if (!ev.rrule) {
    const s = datePart(ev.start);
    const e = datePart(ev.end);
    return s <= to && e >= from ? [make(s)] : [];
  }

  const excluded = new Set(ev.exdates.split(",").filter(Boolean));
  // Start earlier by the span so multi-day occurrences that began before `from` are kept.
  return occurrencesBetween(ev.rrule, ev.start, addDays(from, -span), to)
    .filter((d) => !excluded.has(d))
    .map(make);
}

export function expandEvents(events: CalendarEvent[], from: string, to: string): Occurrence[] {
  return events
    .filter((e) => !e.deleted_at)
    .flatMap((e) => expandEvent(e, from, to))
    .sort((a, b) => a.start.localeCompare(b.start));
}
