import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { displayTitle, type Song } from "./songs";

export type KeepReady = "saveMemory" | "faster";

export interface Settings {
  notifyWhenDone: boolean;
  keepReady: KeepReady;
  emptyTrashAfterDays: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  notifyWhenDone: true,
  keepReady: "saveMemory",
  emptyTrashAfterDays: null,
};

export interface StorageUsage {
  songs: number;
  songsBytes: number;
  trash: number;
  trashBytes: number;
  modelsBytes: number;
  modelsElsewhere: boolean;
  freeBytes: number | null;
}

export interface EngineMemory {
  loaded: boolean;
  busy: boolean;
}

export const getSettings = () =>
  isTauri()
    ? invoke<Settings>("get_settings")
    : Promise.resolve(DEFAULT_SETTINGS);
export const updateSettings = (settings: Settings) =>
  invoke<Settings>("update_settings", { settings });
export const storageUsage = () => invoke<StorageUsage>("storage_usage");
export const engineMemory = () => invoke<EngineMemory>("engine_memory");
export const releaseEngine = () => invoke<void>("release_engine");
/** Aulo opens the save window; false when it was cancelled. */
export const saveReport = () => invoke<boolean>("save_report");

/** Songs Aulo deleted by itself (Trash emptied after the chosen days). */
export function onSongsRemoved(handler: (ids: string[]) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<string[]>("songs-removed", (e) => handler(e.payload));
  return () => void stop.then((unlisten) => unlisten());
}

/** Sizes people read: "1.2 GB", "340 MB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes > 0) return "Less than 1 MB";
  return "None";
}

/**
 * The notice for a song that just finished or failed, or null. Only a change
 * out of being made counts, so reloading the library never notifies again.
 */
export function finishedNotice(
  before: Song | undefined,
  after: Song,
): { title: string; body: string } | null {
  if (!before || (before.state !== "running" && before.state !== "queued"))
    return null;
  const title = displayTitle(after.request);
  if (after.state === "completed")
    return {
      title: "Your song is ready",
      body: `“${title}” is ready to play.`,
    };
  if (after.state === "failed")
    return {
      title: "A song couldn’t be finished",
      body: after.message ?? `“${title}” couldn’t be finished.`,
    };
  return null;
}

/** Ask once, at a moment that makes sense: when a song is started. */
export async function prepareNotifications(settings: Settings) {
  if (!isTauri() || !settings.notifyWhenDone) return;
  const { isPermissionGranted, requestPermission } =
    await import("@tauri-apps/plugin-notification");
  if (!(await isPermissionGranted())) await requestPermission();
}

/** Show a system notification while Aulo is in the background. */
export async function notifyInBackground(notice: {
  title: string;
  body: string;
}) {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  if (await getCurrentWindow().isFocused()) return;
  const { isPermissionGranted, sendNotification } =
    await import("@tauri-apps/plugin-notification");
  if (await isPermissionGranted()) sendNotification(notice);
}
