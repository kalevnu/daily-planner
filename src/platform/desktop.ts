// Thin wrapper over Tauri window, notification, autostart and shortcut APIs.
// Every function degrades to something sensible in a plain browser so the UI
// can be developed and previewed without the desktop shell.
import { isTauri } from "./env";
import { SHORTCUT_ACTIONS, type ShortcutAction } from "../core/shortcuts";

export interface WindowGeometry {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

interface OpenOptions {
  label: string;
  route: string;
  title: string;
  geometry: WindowGeometry;
  frameless?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  center?: boolean;
  parent?: string; // owner window; on Windows owned windows share the owner's Alt+Tab entry
  transparent?: boolean;
  focus?: boolean;
  minSize?: boolean; // apply the usual minimum size (default true)
}

// Windows being created, by label. Window creation is asynchronous, so two
// quick calls for the same label (e.g. creating a note and restoring open
// notes at startup) would otherwise both see "no window yet" and open twice.
const opening = new Map<string, Promise<void>>();

function openWindow(o: OpenOptions): Promise<void> {
  if (!isTauri) {
    window.open(`#${o.route}`, o.label, `width=${o.geometry.width},height=${o.geometry.height}`);
    return Promise.resolve();
  }
  const pending = opening.get(o.label);
  if (pending) return pending;
  const p = openTauriWindow(o).finally(() => opening.delete(o.label));
  opening.set(o.label, p);
  return p;
}

async function openTauriWindow(o: OpenOptions): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(o.label);
  if (existing) {
    await existing.show();
    await existing.unminimize();
    if (o.focus !== false) await existing.setFocus();
    return;
  }
  const hasPos = o.geometry.x != null && o.geometry.y != null && !o.center;
  const win = new WebviewWindow(o.label, {
    url: `index.html#${o.route}`,
    title: o.title,
    width: o.geometry.width,
    height: o.geometry.height,
    ...(o.minSize === false ? {} : { minWidth: 180, minHeight: 120 }),
    ...(hasPos ? { x: o.geometry.x!, y: o.geometry.y! } : { center: true }),
    decorations: !o.frameless,
    alwaysOnTop: o.alwaysOnTop ?? false,
    skipTaskbar: o.skipTaskbar ?? false,
    resizable: o.minSize !== false,
    focus: o.focus !== false,
    ...(o.parent ? { parent: o.parent } : {}),
    ...(o.transparent ? { transparent: true, shadow: false } : {}),
  });
  await new Promise<void>((resolve) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => {
      console.warn(`창 열기 실패 ${o.label}`, e.payload);
      resolve();
    });
  });
}

// ---- sticky group ---------------------------------------------------------
// Sticky notes and the "today" sticky are owned by one invisible host window.
// On Windows that makes the whole group a single Alt+Tab / taskbar entry, and
// switching to it brings every sticky to the front together.

export const STICKY_HOST = "sticky-host";
const LAST_STICKY_KEY = "planner:last-sticky";

export const isStickyLabel = (label: string) => label === "today-sticky" || label.startsWith("note-") || label.startsWith("list-");

export function ensureStickyHost() {
  return openWindow({
    label: STICKY_HOST,
    route: "/sticky-host",
    title: "Daily Planner 메모",
    geometry: { x: 0, y: 0, width: 1, height: 1 },
    frameless: true,
    transparent: true,
    focus: false,
    minSize: false,
  });
}

async function openSticky(o: OpenOptions) {
  if (isTauri) await ensureStickyHost();
  return openWindow({ ...o, frameless: true, skipTaskbar: true, parent: STICKY_HOST });
}

export function openNoteWindow(id: string, geometry: WindowGeometry, pinned: boolean) {
  return openSticky({ label: `note-${id}`, route: `/note/${id}`, title: "메모", geometry, alwaysOnTop: pinned });
}

// Called by each sticky so the host knows which one to focus when the group
// is switched to.
export async function rememberStickyFocus(): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  return win.onFocusChanged(({ payload: focused }) => {
    if (focused) localStorage.setItem(LAST_STICKY_KEY, win.label);
  });
}

// Runs inside the host window.
export async function runStickyHost(): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWindow, getAllWindows } = await import("@tauri-apps/api/window");
  const host = getCurrentWindow();
  const stickies = async () => (await getAllWindows()).filter((w) => isStickyLabel(w.label));

  // Switched to via Alt+Tab or the taskbar: hand focus to the last used sticky.
  const off = await host.onFocusChanged(async ({ payload: focused }) => {
    if (!focused) return;
    const all = await stickies();
    const target = all.find((w) => w.label === localStorage.getItem(LAST_STICKY_KEY)) ?? all[0];
    await target?.setFocus();
  });
  // Leave the Alt+Tab list when no sticky is open.
  const timer = setInterval(async () => {
    if ((await stickies()).length === 0 && (await host.isVisible())) await host.hide();
  }, 3000);
  return () => {
    off();
    clearInterval(timer);
  };
}

export async function closeWindow(label: string) {
  if (!isTauri) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await (await WebviewWindow.getByLabel(label))?.close();
}

export function openBriefing() {
  return openWindow({
    label: "briefing",
    route: "/briefing",
    title: "오늘 브리핑",
    geometry: { x: null, y: null, width: 560, height: 720 },
    alwaysOnTop: true,
    center: true,
  });
}

export function openTodaySticky(geometry: WindowGeometry, pinned: boolean) {
  return openSticky({ label: "today-sticky", route: "/today-sticky", title: "오늘 할 일", geometry, alwaysOnTop: pinned });
}

// One list's open tasks as a sticky. `id` is the list id, or "none" for tasks without a list.
export function openListSticky(id: string, title: string, geometry: WindowGeometry, pinned: boolean) {
  return openSticky({ label: `list-${id}`, route: `/list-sticky/${id}`, title, geometry, alwaysOnTop: pinned });
}

export async function showMainWindow(route?: string) {
  if (!isTauri) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  const main = await WebviewWindow.getByLabel("main");
  await main?.show();
  await main?.unminimize();
  await main?.setFocus();
  if (route) await emitTo("main", "navigate", route);
}

// ---- current window helpers (used inside sticky windows) -----------------

export async function currentLabel(): Promise<string> {
  if (!isTauri) return "browser";
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

export async function closeCurrent() {
  if (!isTauri) return window.close();
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

// Pinning goes through our own command instead of setAlwaysOnTop: on
// Windows, when one window gives up "always on top", every window sharing
// its owner (all stickies share the host) loses it too, and the toolkit
// skips a repeat setAlwaysOnTop(true) because it believes nothing changed.
export async function setCurrentPinned(on: boolean) {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_topmost", { on });
}

const PIN_EVENT = "sticky-pin-changed";

// Tells the other stickies that a pin changed, so each puts its own back.
export async function announcePinChange() {
  if (!isTauri) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(PIN_EVENT);
}

export async function keepPinned(isPinned: () => boolean): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(PIN_EVENT, () => {
    if (isPinned()) setCurrentPinned(true);
  });
}

// Calls `save` with the window's logical geometry after it is moved or resized.
export async function trackGeometry(save: (g: WindowGeometry) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const scale = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(scale);
      const size = (await win.innerSize()).toLogical(scale);
      save({ x: Math.round(pos.x), y: Math.round(pos.y), width: Math.round(size.width), height: Math.round(size.height) });
    }, 400);
  };
  const offMove = await win.onMoved(report);
  const offResize = await win.onResized(report);
  report(); // record where a newly opened (centered) window landed
  return () => {
    offMove();
    offResize();
  };
}

// ---- notifications --------------------------------------------------------

let permission: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!isTauri) {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  }
  const n = await import("@tauri-apps/plugin-notification");
  if (await n.isPermissionGranted()) return true;
  return (await n.requestPermission()) === "granted";
}

export async function notify(title: string, body: string) {
  permission ??= ensurePermission();
  if (!(await permission)) return;
  if (!isTauri) {
    new Notification(title, { body });
    return;
  }
  const { sendNotification } = await import("@tauri-apps/plugin-notification");
  sendNotification({ title, body });
}

// ---- autostart ------------------------------------------------------------

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri) return false;
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setAutostart(on: boolean) {
  if (!isTauri) return;
  const a = await import("@tauri-apps/plugin-autostart");
  if (on) await a.enable();
  else await a.disable();
}

// ---- global shortcuts -----------------------------------------------------

// Registers every binding anew (earlier ones are dropped) and returns the
// actions whose keys could not be taken, e.g. because another program holds them.
export async function registerShortcuts(
  bindings: Record<ShortcutAction, string>,
  handlers: Record<ShortcutAction, () => void>,
): Promise<Partial<Record<ShortcutAction, string>>> {
  const failed: Partial<Record<ShortcutAction, string>> = {};
  if (!isTauri) return failed;
  const gs = await import("@tauri-apps/plugin-global-shortcut");
  await gs.unregisterAll();
  for (const action of SHORTCUT_ACTIONS) {
    try {
      await gs.register(bindings[action], (e) => {
        if (e.state === "Pressed") handlers[action]();
      });
    } catch (err) {
      console.warn(`단축키 등록 실패 ${bindings[action]}`, err);
      failed[action] = String(err);
    }
  }
  return failed;
}

// Listens for events the Rust side sends to the main window (tray menu, etc).
export async function onAppEvent(name: string, handler: (payload: string) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>(name, (e) => handler(e.payload));
}
