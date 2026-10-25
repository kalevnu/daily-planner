// Local date helpers. All app dates are local wall-clock strings, so these
// never go through UTC conversion.

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDateTimeStr(d: Date): string {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Parses "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as a local time.
export function parseLocal(s: string): Date {
  const [date, time = "00:00"] = s.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function addDays(dateStr: string, days: number): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function datePart(s: string): string {
  return s.slice(0, 10);
}

export function timePart(s: string): string | null {
  return s.length > 10 ? s.slice(11, 16) : null;
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseLocal(datePart(to)).getTime() - parseLocal(datePart(from)).getTime()) / 86400000);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function weekdayKo(dateStr: string): string {
  return WEEKDAYS[parseLocal(dateStr).getDay()];
}

// "10월 25일 (토)"
export function formatDateKo(dateStr: string): string {
  const d = parseLocal(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

// "오후 3:05"
export function formatTimeKo(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${pad(m)}`;
}

// Relative label for a due date compared with today.
export function relativeDayKo(dateStr: string, today: string): string {
  const diff = diffDays(today, dateStr);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  if (diff < 0) return `${-diff}일 지남`;
  if (diff < 7) return `${weekdayKo(dateStr)}요일`;
  return formatDateKo(dateStr);
}
