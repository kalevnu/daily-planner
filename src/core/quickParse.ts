import type { Priority, TaskList } from "./types";
import { addDays, parseLocal, toDateStr } from "./dates";

export interface QuickAddResult {
  title: string;
  due_date: string | null;
  due_time: string | null;
  priority: Priority;
  list_id: string | null;
}

const WEEKDAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const pad = (n: number) => String(n).padStart(2, "0");

// Parses a one-line task such as "내일 오후 3시 보고서 제출 !1 #업무".
// Recognised tokens are removed from the title; everything else stays.
export function parseQuickAdd(input: string, today: string, lists: TaskList[] = []): QuickAddResult {
  let text = ` ${input.trim()} `;
  let due_date: string | null = null;
  let due_time: string | null = null;
  let priority: Priority = 0;
  let list_id: string | null = null;

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(re);
    if (m && fn(m) !== false) text = text.replace(m[0], " ");
  };

  // Priority: !1 (highest) .. !3
  take(/\s!([1-3])(?=\s)/, (m) => {
    priority = (4 - Number(m[1])) as Priority;
  });

  // List: #name
  take(/\s#(\S+)(?=\s)/, (m) => {
    const list = lists.find((l) => !l.deleted_at && l.name === m[1]);
    if (!list) return false;
    list_id = list.id;
  });

  // Relative days
  take(/\s(오늘|내일|모레)(?=\s)/, (m) => {
    due_date = addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[m[1]]!);
  });

  // Weekday, optionally "다음주"/"이번주"
  if (!due_date) {
    take(/\s(?:(다음\s?주|이번\s?주)\s)?([월화수목금토일])요일(?=\s)/, (m) => {
      const target = WEEKDAY_INDEX[m[2]];
      const todayDow = parseLocal(today).getDay();
      if (m[1]?.startsWith("다음")) {
        // Same weekday in the week after this one (weeks start on Monday).
        const mondayOffset = (todayDow + 6) % 7;
        const nextMonday = addDays(today, 7 - mondayOffset);
        due_date = addDays(nextMonday, (target + 6) % 7);
      } else {
        due_date = addDays(today, (target - todayDow + 7) % 7);
      }
    });
  }

  // Absolute dates: "10월 30일" or "10/30"
  if (!due_date) {
    take(/\s(\d{1,2})(?:월\s?|\/)(\d{1,2})일?(?=\s)/, (m) => {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return false;
      const year = parseLocal(today).getFullYear();
      let date = toDateStr(new Date(year, month - 1, day));
      if (date < today) date = toDateStr(new Date(year + 1, month - 1, day));
      due_date = date;
    });
  }

  // Times: "15:30", "오후 3시", "오전 9시 30분", "3시반"
  take(/\s(\d{1,2}):(\d{2})(?=\s)/, (m) => {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return false;
    due_time = `${pad(h)}:${pad(min)}`;
  });
  if (!due_time) {
    take(/\s(?:(오전|오후)\s?)?(\d{1,2})시(?:\s?(반|(\d{1,2})분))?(?=\s)/, (m) => {
      let h = Number(m[2]);
      if (h > 24) return false;
      const min = m[3] === "반" ? 30 : Number(m[4] ?? 0);
      if (m[1] === "오후" && h < 12) h += 12;
      else if (m[1] === "오전" && h === 12) h = 0;
      else if (!m[1] && h >= 1 && h <= 6) h += 12; // "3시" during the workday means 15:00
      due_time = `${pad(h % 24)}:${pad(min)}`;
    });
  }

  if (due_time && !due_date) due_date = today;

  return { title: text.replace(/\s+/g, " ").trim(), due_date, due_time, priority, list_id };
}
