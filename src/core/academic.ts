import type { CalendarEvent } from "./types";
import { diffDays } from "./dates";

// Hanyang University graduate school academic calendar. The page is one
// table (기간 | 내용 | 비고) whose dates name the year only when it changes,
// e.g. "2026년 1월 7일(수) ~ 1월 14일(수)" and later "12월 23일(수) ~ 2027년 2월 28일(일)".

export const ACADEMIC_URL = "http://www.grad.hanyang.ac.kr/m/academics/calendar.php";
export const ACADEMIC_ID_PREFIX = "hyu-grad:";
export const ACADEMIC_COLOR = "#0e4a84"; // Hanyang blue

export interface AcademicItem {
  title: string;
  note: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
}

export type AcademicRow = [period: string, title: string, note: string];

const pad = (n: number) => String(n).padStart(2, "0");
const DATE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;

// Dates in one 기간 cell. A date without a year takes the year in effect,
// and an end month before the start month rolls into the next year.
export function parsePeriod(text: string, year: number): { start: string; end: string; year: number } | null {
  const dates = [...text.matchAll(DATE)].slice(0, 2);
  if (!dates.length) return null;
  let y = year;
  const out: { y: number; m: number; d: number }[] = [];
  for (const [, yy, mm, dd] of dates) {
    const m = Number(mm);
    if (yy) y = Number(yy);
    else if (out.length && m < out[0].m && y === out[0].y) y += 1;
    out.push({ y, m, d: Number(dd) });
  }
  const str = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  const start = str(out[0]);
  const end = str(out[out.length - 1]);
  // Rows carry the year of their start date forward.
  return { start, end: end < start ? start : end, year: out[0].y };
}

export function parseAcademicRows(rows: AcademicRow[], startYear = new Date().getFullYear()): AcademicItem[] {
  // The first row of the page names its year; fall back to the caller's.
  let year = startYear;
  const items: AcademicItem[] = [];
  const seen = new Set<string>();
  for (const [period, title, note] of rows) {
    if (!title) continue;
    const p = parsePeriod(period, year);
    if (!p) continue;
    year = p.year;
    const item = { title, note, start: p.start, end: p.end };
    const id = academicId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(item);
  }
  return items;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·" };

function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Table rows as plain text. Regex based so it runs the same in the app and
// in tests (no DOM needed). Most rows put the date in a <th scope="row">, and
// the page keeps an old table inside a comment, which must not count.
export function extractRows(html: string): AcademicRow[] {
  const rows: AcademicRow[] = [];
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const [, tr] of live.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr.matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => cellText(c[2]));
    if (cells.length >= 2) rows.push([cells[0], cells[1], cells[2] ?? ""]);
  }
  return rows;
}

export function parseAcademicHtml(html: string): AcademicItem[] {
  const year = Number(html.match(/(\d{4})학년도\s*학사일정/)?.[1]) || new Date().getFullYear();
  return parseAcademicRows(extractRows(html), year);
}

// The page arrives in EUC-KR; honour whatever charset it declares.
export function decodePage(bytes: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const charset = (contentType?.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// Stable per item, so fetching again recognises what is already there.
export function academicId(item: AcademicItem): string {
  return `${ACADEMIC_ID_PREFIX}${item.start}:${item.end}:${hash(item.title)}`;
}

export const isAcademic = (e: { id: string }) => e.id.startsWith(ACADEMIC_ID_PREFIX);

// Periods longer than this (논문 심사, 방학) show on the day list only when they
// start and end, so they do not fill every morning for months.
export const ACADEMIC_LONG_DAYS = 7;

export function academicOnDay(e: CalendarEvent, day: string): boolean {
  if (!isAcademic(e)) return true;
  if (diffDays(e.start, e.end) + 1 <= ACADEMIC_LONG_DAYS) return true;
  return day === e.start || day === e.end;
}

export type AcademicEventFields = Omit<CalendarEvent, "id" | "created_at" | "updated_at" | "deleted_at">;

export function toEventFields(item: AcademicItem): AcademicEventFields {
  return {
    title: item.title,
    location: "",
    note: item.note,
    all_day: 1,
    start: item.start,
    end: item.end,
    color: ACADEMIC_COLOR,
    rrule: null,
    exdates: "",
    remind_minutes: null,
  };
}

export interface AcademicPlan {
  create: { id: string; fields: AcademicEventFields }[];
  remove: string[]; // ids no longer on the page
  unchanged: number;
}

// What to change so the calendar matches the page. `existing` includes
// deleted rows: an item the user deleted stays deleted, and their edits to
// an item (a reminder, a colour) are kept because its id does not change.
// Only dates the page still covers are cleaned up, so last year's items stay
// once the page moves on to a new year.
export function planAcademicSync(existing: CalendarEvent[], items: AcademicItem[]): AcademicPlan {
  const mine = new Map(existing.filter(isAcademic).map((e) => [e.id, e]));
  const wanted = new Map(items.map((i) => [academicId(i), i]));
  const plan: AcademicPlan = { create: [], remove: [], unchanged: 0 };
  for (const [id, item] of wanted) {
    if (mine.has(id)) plan.unchanged++;
    else plan.create.push({ id, fields: toEventFields(item) });
  }
  const from = items.reduce((min, i) => (i.start < min ? i.start : min), "9999-12-31");
  for (const [id, e] of mine) if (!wanted.has(id) && !e.deleted_at && e.start >= from) plan.remove.push(id);
  return plan;
}
