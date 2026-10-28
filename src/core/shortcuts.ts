// Global shortcut bindings: what the user may bind, how a key press turns
// into a binding string the desktop shell understands, and how one is shown.

export const SHORTCUT_ACTIONS = ["newNote", "briefing"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type Shortcuts = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  newNote: "CommandOrControl+Alt+N",
  briefing: "CommandOrControl+Alt+D",
};

export const SHORTCUT_TITLES: Record<ShortcutAction, string> = {
  newNote: "새 스티커 메모",
  briefing: "오늘 브리핑 열기",
};

export const shortcutSettingKey = (action: ShortcutAction) => `shortcut_${action}`;

// What a key event needs to provide; a subset of KeyboardEvent so tests can
// pass plain objects.
export interface KeyPress {
  code: string; // physical key, e.g. "KeyD" (unaffected by the Korean IME)
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

// The binding for a key press, or null when it cannot be a global shortcut:
// no main key yet (only modifiers held), a key we do not bind, or no Ctrl /
// Alt / Win to keep it from firing while typing.
export function bindingFromKeyPress(e: KeyPress): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else if (e.code === "Space") key = "Space";
  if (!key) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  const mods = [e.ctrlKey && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  return [...mods, key].join("+");
}

// "CommandOrControl+Alt+D" -> "Ctrl + Alt + D"
export function shortcutLabel(binding: string): string {
  return binding
    .split("+")
    .map((part) => ({ CommandOrControl: "Ctrl", Super: "Win" })[part] ?? part)
    .join(" + ");
}
