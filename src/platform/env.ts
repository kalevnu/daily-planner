// True when running inside the Tauri desktop shell (as opposed to a plain
// browser during UI development).
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
