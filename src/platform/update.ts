// In-app updates: the app asks GitHub Releases for a newer signed build,
// downloads it and runs the installer, so nobody has to fetch a setup file.
import { isTauri } from "./env";

export interface AvailableUpdate {
  version: string;
  notes: string;
  // Downloads and installs; `onProgress` gets 0-100 (or null when the size
  // is unknown). On Windows the installer closes the app and restarts it.
  install: (onProgress: (percent: number | null) => void) => Promise<void>;
}

export async function appVersion(): Promise<string> {
  if (!isTauri) return "dev";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

// Resolves to null when this is the newest version; rejects when the check
// itself fails (no network, no release yet).
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 15000 });
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    install: async (onProgress) => {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          onProgress(total ? Math.min(99, Math.round((got / total) * 100)) : null);
        } else if (e.event === "Finished") onProgress(100);
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
