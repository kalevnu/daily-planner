// Keeps the 한양대 대학원 학사일정 in the calendar: the copy bundled with the
// app on first run, then the live page, fetched again once a week or from
// 설정 > 학사일정.
import { ACADEMIC_URL, decodePage, parseAcademicHtml, parseAcademicRows, planAcademicSync, type AcademicItem } from "../core/academic";
import { isTauri } from "../platform/env";
import { ACADEMIC_SNAPSHOT, ACADEMIC_SNAPSHOT_YEAR } from "./academicSnapshot";
import { createRow, deleteRow, getSetting, listWithDeleted, setSetting } from "./store";

export const ACADEMIC_SYNCED_KEY = "academic_synced_at"; // ISO time of the last successful page fetch
const ACADEMIC_SEEDED_KEY = "academic_seeded";
export const ACADEMIC_HIDDEN_KEY = "academic_hidden"; // "1" hides them in the calendar
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export interface AcademicResult {
  total: number;
  added: number;
  removed: number;
}

async function apply(items: AcademicItem[]): Promise<AcademicResult> {
  const plan = planAcademicSync(await listWithDeleted("events"), items);
  for (const { id, fields } of plan.create) await createRow("events", fields, id);
  for (const id of plan.remove) await deleteRow("events", id);
  return { total: items.length, added: plan.create.length, removed: plan.remove.length };
}

export async function fetchAcademicItems(): Promise<AcademicItem[]> {
  // The page sends no CORS headers, so the request goes through the Rust side.
  const { fetch } = await import("@tauri-apps/plugin-http");
  const res = await fetch(ACADEMIC_URL, { method: "GET", connectTimeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseAcademicHtml(decodePage(await res.arrayBuffer(), res.headers.get("content-type")));
  // A redesigned page that parses to (almost) nothing must not wipe the calendar.
  if (items.length < 10) throw new Error(`학사일정 표를 찾지 못했어요 (${items.length}개)`);
  return items;
}

// Fetches the page and brings the calendar in line with it.
export async function refreshAcademic(): Promise<AcademicResult> {
  const result = await apply(await fetchAcademicItems());
  await setSetting(ACADEMIC_SYNCED_KEY, new Date().toISOString());
  return result;
}

// On start: the bundled copy the first time, then the live page when the
// last fetch is a week old. Failures are quiet; the next start tries again.
export async function keepAcademicFresh(): Promise<void> {
  if (!(await getSetting(ACADEMIC_SEEDED_KEY))) {
    await setSetting(ACADEMIC_SEEDED_KEY, new Date().toISOString());
    await apply(parseAcademicRows(ACADEMIC_SNAPSHOT, ACADEMIC_SNAPSHOT_YEAR));
  }
  if (!isTauri) return;
  const last = await getSetting(ACADEMIC_SYNCED_KEY);
  if (last && Date.now() - Date.parse(last) < REFRESH_EVERY_MS) return;
  try {
    await refreshAcademic();
  } catch {
    // Offline or the page moved; the calendar keeps what it has.
  }
}
