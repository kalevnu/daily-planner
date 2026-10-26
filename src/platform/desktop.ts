// Thin wrapper over Tauri window, notification, autostart and shortcut APIs.
// Every function degrades to something sensible in a plain browser so the UI
// can be developed and previewed without the desktop shell.
import { isTauri } from "./env";

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
    await existing.setFocus();
    return;
  }
  const hasPos = o.geometry.x != null && o.geometry.y != null && !o.center;
  const win = new WebviewWindow(o.label, {
    url: `index.html#${o.route}`,
    title: o.title,
    width: o.geometry.width,
    height: o.geometry.height,
    minWidth: 180,
    minHeight: 120,
    ...(hasPos ? { x: o.geometry.x!, y: o.geometry.y! } : { center: true }),
    decorations: !o.frameless,
    alwaysOnTop: o.alwaysOnTop ?? false,
    skipTaskbar: o.skipTaskbar ?? false,
    resizable: true,
    focus: true,
  });
  await new Promise<void>((resolve) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => {
      console.warn(`창 열기 실패 ${o.label}`, e.payload);
      resolve();
    });
  });
}

export function openNoteWindow(id: string, geometry: WindowGeometry, pinned: boolean) {
  return openWindow({
    label: `note-${id}`,
    route: `/note/${id}`,
    title: "메모",
    geometry,
    frameless: true,
    alwaysOnTop: pinned,
    skipTaskbar: true,
  });
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

export function openTodaySticky(geometry: WindowGeometry) {
  return openWindow({
    label: "today-sticky",
    route: "/today-sticky",
    title: "오늘 할 일",
    geometry,
    frameless: true,
    alwaysOnTop: true,
    skipTaskbar: true,
  });
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

export async function setCurrentAlwaysOnTop(on: boolean) {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setAlwaysOnTop(on);
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

export const SHORTCUTS = {
  newNote: "CommandOrControl+Alt+N",
  briefing: "CommandOrControl+Alt+T",
};

export async function registerShortcuts(handlers: { newNote: () => void; briefing: () => void }) {
  if (!isTauri) return;
  const gs = await import("@tauri-apps/plugin-global-shortcut");
  await gs.unregisterAll();
  const bind = (keys: string, fn: () => void) =>
    gs.register(keys, (e) => {
      if (e.state === "Pressed") fn();
    }).catch((err) => console.warn(`단축키 등록 실패 ${keys}`, err));
  await bind(SHORTCUTS.newNote, handlers.newNote);
  await bind(SHORTCUTS.briefing, handlers.briefing);
}

// Listens for events the Rust side sends to the main window (tray menu, etc).
export async function onAppEvent(name: string, handler: (payload: string) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>(name, (e) => handler(e.payload));
}
