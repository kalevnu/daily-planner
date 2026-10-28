import { describe, expect, it } from "vitest";
import { buildToday } from "../src/core/today";
import {
  ACADEMIC_COLOR,
  academicId,
  decodePage,
  extractRows,
  parseAcademicHtml,
  parseAcademicRows,
  parsePeriod,
  planAcademicSync,
  toEventFields,
  type AcademicItem,
} from "../src/core/academic";
import { ACADEMIC_SNAPSHOT, ACADEMIC_SNAPSHOT_YEAR } from "../src/data/academicSnapshot";
import type { CalendarEvent } from "../src/core/types";

const base = { created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", deleted_at: null };
const asEvent = (i: AcademicItem, p: Partial<CalendarEvent> = {}): CalendarEvent => ({ ...base, id: academicId(i), ...toEventFields(i), ...p });

describe("parsePeriod", () => {
  it("reads one date or a range, carrying the year", () => {
    expect(parsePeriod("2026년 1월 7일(수) ~ 1월 14일(수)", 2025)).toEqual({ start: "2026-01-07", end: "2026-01-14", year: 2026 });
    expect(parsePeriod("3월 21일(토)", 2026)).toEqual({ start: "2026-03-21", end: "2026-03-21", year: 2026 });
  });
  it("crosses into the next year", () => {
    expect(parsePeriod("12월 23일(수) ~ 2027년 2월 28일(일)", 2026)).toEqual({ start: "2026-12-23", end: "2027-02-28", year: 2026 });
    expect(parsePeriod("12월 28일 ~ 1월 3일", 2026)).toMatchObject({ start: "2026-12-28", end: "2027-01-03" });
  });
  it("ignores cells without a date", () => {
    expect(parsePeriod("기 간", 2026)).toBeNull();
  });
});

describe("bundled 2026 calendar", () => {
  const items = parseAcademicRows(ACADEMIC_SNAPSHOT, ACADEMIC_SNAPSHOT_YEAR);

  it("has every row of the page", () => {
    expect(items).toHaveLength(90);
    expect(new Set(items.map(academicId)).size).toBe(90);
    for (const i of items) expect(i.start <= i.end).toBe(true);
  });

  it("puts each item on the right dates", () => {
    const find = (title: string, start?: string) => items.find((i) => i.title === title && (!start || i.start === start))!;
    expect(find("2025학년도 전기 졸업사정")).toMatchObject({ start: "2026-01-07", end: "2026-01-14", note: "대학원" });
    expect(find("2026학년도 2학기 개강")).toMatchObject({ start: "2026-09-01", end: "2026-09-01" });
    expect(find("하계방학")).toMatchObject({ start: "2026-06-24", end: "2026-08-31" });
    expect(find("동계방학")).toMatchObject({ start: "2026-12-23", end: "2027-02-28" });
    // After the winter break row the page switches to 2027 explicitly...
    expect(find("석·박사 학위청구논문 온라인 파일 제출마감", "2026-12-28")).toBeTruthy();
    expect(find("2027학년도 1학기 휴∙복학 신청기간")).toMatchObject({ start: "2027-01-04", end: "2027-01-15" });
    // ...and the rows after it stay in 2027.
    expect(find("2026학년도 전기 졸업사정")).toMatchObject({ start: "2027-01-07", end: "2027-01-14" });
    expect(items[items.length - 1]).toMatchObject({ title: "2027년 2월 대학원 학위수여식", start: "2027-02-19" });
  });
});

describe("page HTML", () => {
  // Same markup as the live page: header row of <th>, dates in <td> or
  // <th scope="row">, split over <b>s, &nbsp; padding, an old table in a comment.
  const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head><body>
    <p>2026학년도 학사일정(2026.01~2026.12)</p>
    <table class="acadTbl"><thead><tr style="background: rgb(255, 255, 204);">
      <th style="text-align: center;">기&nbsp;간</th><th>내&nbsp;용</th><th>비&nbsp;고</th></tr></thead>
    <tbody><tr>
      <td style="text-align: center;">
        <b>2026년 1월 7일(수) ~&nbsp;</b><b>1월 14일(수)&nbsp;</b>
      </td>
      <td style="vertical-align: middle;">2025학년도 전기 졸업사정</td>
      <td>대학원</td>
    </tr><tr>
      <th class="yellowBG" scope="row" style="x"><b>2월 9일(월) ~ 2월 13일(금)</b></th>
      <td>2026학년도 1학기 외국어시험 접수<br>
      </td>
      <td>HY-in</td>
    </tr><tr><td>12월 23일(수) ~<br>2027년 2월 28일(일)</td><td>동계방학</td><td>&nbsp;</td></tr>
    <tr><td>1월 4일(월)</td><td>R&amp;D &#8231; 안내</td><td></td></tr>
    </tbody></table>
    <!-- <table><tr><th>2025년 3월 2일</th><td>지난 학기 개강</td><td></td></tr></table> -->
    </body></html>`;

  it("reads the rows as text", () => {
    expect(extractRows(html)).toEqual([
      ["기 간", "내 용", "비 고"],
      ["2026년 1월 7일(수) ~ 1월 14일(수)", "2025학년도 전기 졸업사정", "대학원"],
      ["2월 9일(월) ~ 2월 13일(금)", "2026학년도 1학기 외국어시험 접수", "HY-in"],
      ["12월 23일(수) ~ 2027년 2월 28일(일)", "동계방학", ""],
      ["1월 4일(월)", "R&D ‧ 안내", ""],
    ]);
  });

  it("parses into items", () => {
    expect(parseAcademicHtml(html)).toEqual([
      { title: "2025학년도 전기 졸업사정", note: "대학원", start: "2026-01-07", end: "2026-01-14" },
      { title: "2026학년도 1학기 외국어시험 접수", note: "HY-in", start: "2026-02-09", end: "2026-02-13" },
      { title: "동계방학", note: "", start: "2026-12-23", end: "2027-02-28" },
      // Rows carry the year of the previous row's start, as the page does.
      { title: "R&D ‧ 안내", note: "", start: "2026-01-04", end: "2026-01-04" },
    ]);
  });

  it("decodes EUC-KR", () => {
    const head = new TextEncoder().encode('<meta charset="euc-kr">');
    const bytes = new Uint8Array([...head, 0xc7, 0xd0, 0xbb, 0xe7]); // 학사
    expect(decodePage(bytes.buffer, null)).toBe('<meta charset="euc-kr">학사');
    expect(decodePage(bytes.buffer, "text/html; charset=EUC-KR")).toContain("학사");
  });
});

describe("planAcademicSync", () => {
  const items = parseAcademicRows(ACADEMIC_SNAPSHOT, ACADEMIC_SNAPSHOT_YEAR);

  it("adds everything the first time, nothing the second", () => {
    const first = planAcademicSync([], items);
    expect(first.create).toHaveLength(90);
    expect(first.create[0].fields).toMatchObject({ all_day: 1, color: ACADEMIC_COLOR, rrule: null });
    const existing = first.create.map(({ id, fields }) => ({ ...base, id, ...fields }));
    expect(planAcademicSync(existing, items)).toEqual({ create: [], remove: [], unchanged: 90 });
  });

  it("keeps what the user deleted deleted, and their edits", () => {
    const existing = items.map((i, n) => asEvent(i, n === 0 ? { deleted_at: "2026-10-28T00:00:00Z" } : n === 1 ? { remind_minutes: 60 } : {}));
    const plan = planAcademicSync(existing, items);
    expect(plan.create).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("drops items the page no longer lists, but not older years", () => {
    const old = asEvent({ title: "2025학년도 2학기 종강", note: "", start: "2025-12-19", end: "2025-12-19" });
    const moved = { ...items[5], start: "2026-02-05" };
    const existing = [old, ...items.map((i) => asEvent(i))];
    const plan = planAcademicSync(existing, [...items.slice(0, 5), moved, ...items.slice(6)]);
    expect(plan.create.map((c) => c.fields.start)).toEqual(["2026-02-05"]);
    expect(plan.remove).toEqual([academicId(items[5])]);
  });

  it("leaves the user's own events alone", () => {
    const mine = { ...asEvent(items[0]), id: "user-event" };
    expect(planAcademicSync([mine], []).remove).toEqual([]);
  });
});

describe("today list", () => {
  const items = parseAcademicRows(ACADEMIC_SNAPSHOT, ACADEMIC_SNAPSHOT_YEAR);
  const events = items.map((i) => asEvent(i));
  const titles = (day: string) => buildToday([], events, day).events.map((o) => o.event.title);

  it("shows short periods every day", () => {
    expect(titles("2026-08-20")).toContain("2026학년도 2학기 수강신청");
    expect(titles("2026-08-20")).toContain("2026년 8월 대학원 학위수여식");
  });

  it("shows long periods only on their first and last day", () => {
    expect(titles("2026-10-28")).not.toContain("석·박사 학위청구논문 제목수정");
    expect(titles("2026-09-02")).toContain("석·박사 학위청구논문 제목수정");
    expect(titles("2026-12-11")).toContain("석·박사 학위청구논문 제목수정");
    expect(titles("2026-07-15")).not.toContain("하계방학");
  });

  it("leaves the user's own long events alone", () => {
    const trip = { ...events[0], id: "trip", title: "출장", start: "2026-10-01", end: "2026-10-31" };
    expect(buildToday([], [trip], "2026-10-28").events).toHaveLength(1);
  });
});
