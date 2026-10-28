// Work that runs for the life of the app inside the (often hidden) main
// window: first-run setup, restoring desktop windows, the morning briefing,
// reminders, global shortcuts and tray actions.
import { toDateStr } from "./core/dates";
import { dueReminders } from "./core/today";
import { createRow, getSetting, listAll, setSetting } from "./data/store";
import { keepAcademicFresh } from "./data/academic";
import { isTauri } from "./platform/env";
import { notify, onAppEvent, openBriefing, registerShortcuts, showMainWindow } from "./platform/desktop";
import { checkForUpdate } from "./platform/update";
import { showToast } from "./ui/toast";
import { LIST_COLORS, createNote, showNote } from "./ui/actions";
import { TODAY_STICKY_OPEN_KEY, listStickyState, showListSticky, showTodaySticky } from "./ui/windows";

export const BRIEFING_ENABLED_KEY = "briefing_enabled";
const LAST_BRIEFING_KEY = "last_briefing_date";
const FIRED_KEY = "fired_reminders";
// The briefing for a new day is not shown before this hour, so a PC left on
// overnight does not pop it up at midnight.
const BRIEFING_EARLIEST_HOUR = 5;

const WELCOME_NOTE = `환영해요! 이건 스티커 메모예요.
- [ ] 메모를 클릭해서 내용 고치기
- [ ] 위쪽 막대를 끌어서 원하는 곳에 두기
- [ ] Ctrl+Alt+N 으로 어디서든 새 메모
- [ ] Ctrl+Alt+T 로 오늘 브리핑 다시 보기`;

async function firstRunSetup() {
  if (await getSetting("initialized")) return;
  // Mark first, so a reload during setup cannot create the defaults twice.
  await setSetting("initialized", new Date().toISOString());
  await createRow("lists", { name: "업무", color: LIST_COLORS[0], sort_order: 0 });
  await createRow("lists", { name: "개인", color: LIST_COLORS[1], sort_order: 1 });
  await createNote(WELCOME_NOTE, isTauri);
}

async function restoreWindows() {
  for (const note of await listAll("notes")) {
    if (note.is_open) await showNote(note);
  }
  if ((await getSetting(TODAY_STICKY_OPEN_KEY)) === "1") await showTodaySticky();
  for (const id of [...(await listAll("lists")).map((l) => l.id), null]) {
    if ((await listStickyState(id)).open) await showListSticky(id);
  }
}

export async function maybeShowBriefing(force = false) {
  const now = new Date();
  const today = toDateStr(now);
  if (!force) {
    if ((await getSetting(BRIEFING_ENABLED_KEY)) === "0") return;
    if ((await getSetting(LAST_BRIEFING_KEY)) === today) return;
    if (now.getHours() < BRIEFING_EARLIEST_HOUR) return;
  }
  await setSetting(LAST_BRIEFING_KEY, today);
  await openBriefing();
}

let fired: string[] | null = null;

async function checkReminders() {
  fired ??= JSON.parse((await getSetting(FIRED_KEY)) ?? "[]") as string[];
  const due = dueReminders(await listAll("tasks"), await listAll("events"), new Date());
  const fresh = due.filter((r) => !fired!.includes(r.key));
  if (!fresh.length) return;
  for (const r of fresh) await notify(r.title, r.body);
  fired = [...fired, ...fresh.map((r) => r.key)].slice(-300);
  await setSetting(FIRED_KEY, JSON.stringify(fired));
}

const UPDATE_NOTIFIED_KEY = "update_notified_version";
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

// Quietly looks for a new version and says so once per version; installing
// is up to the user (설정 > 업데이트, or the toast).
async function checkUpdates() {
  try {
    const update = await checkForUpdate();
    if (!update || (await getSetting(UPDATE_NOTIFIED_KEY)) === update.version) return;
    await setSetting(UPDATE_NOTIFIED_KEY, update.version);
    showToast(`새 버전 ${update.version}이 나왔어요`, () => update.install(() => {}), "지금 업데이트", 30000);
    await notify("Daily Planner 새 버전", `${update.version} 버전을 설정 > 업데이트에서 설치할 수 있어요.`);
  } catch {
    // No network or no release yet; try again later.
  }
}

let started = false;

export async function startBackground() {
  if (started) return;
  started = true;
  await firstRunSetup();
  keepAcademicFresh();

  // Reminders work in the browser preview too.
  checkReminders();
  setInterval(checkReminders, 30000);

  if (!isTauri) return;

  await restoreWindows();
  await registerShortcuts({
    newNote: () => createNote("", true),
    briefing: () => maybeShowBriefing(true),
  });
  await onAppEvent("tray", (action) => {
    if (action === "briefing") maybeShowBriefing(true);
    if (action === "today-sticky") showTodaySticky();
    if (action === "new-note") createNote("", true);
    if (action === "open") showMainWindow();
  });

  await maybeShowBriefing();
  setInterval(() => maybeShowBriefing(), 60000);

  setTimeout(checkUpdates, 15000);
  setInterval(checkUpdates, UPDATE_CHECK_INTERVAL);
}
