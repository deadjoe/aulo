// The UI's view of the native song service (src-tauri/src/songs.rs).
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Vocal = "auto" | "female" | "male";
export interface SongRequest {
  title: string;
  style: string;
  lyrics: string;
  instrumental: boolean;
  vocal: Vocal;
  weirdness: number;
  styleInfluence: number;
}
export type SongState =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type Stage =
  "preparing" | "writing" | "performing" | "rendering" | "mixing" | "saving";
export interface Song {
  id: string;
  createdMs: number;
  request: SongRequest;
  favorite: boolean;
  state: SongState;
  stage: Stage | null;
  progress: { completed: number; total: number } | null;
  startedMs: number | null;
  duration: number | null;
  audioPath: string | null;
  message: string | null;
}
export interface CreationStatus {
  ready: boolean;
  blocker: "models" | "engine" | "unsupported" | "ready" | "preview";
  message: string;
}

export const desktop = () => isTauri();

export async function creationStatus(): Promise<CreationStatus> {
  if (!isTauri())
    return {
      ready: false,
      blocker: "preview",
      message: "Open the Aulo desktop app to create songs.",
    };
  return invoke<CreationStatus>("creation_status");
}
export const listSongs = () =>
  isTauri() ? invoke<Song[]>("list_songs") : Promise.resolve([] as Song[]);
export const createSong = (request: SongRequest) =>
  invoke<Song>("create_song", { request });
export const cancelSong = (id: string) => invoke<void>("cancel_song", { id });
export const updateSong = (
  id: string,
  changes: { title?: string; favorite?: boolean },
) => invoke<void>("update_song", { id, ...changes });
export const deleteSong = (id: string) => invoke<void>("delete_song", { id });
export function onSongUpdated(handler: (song: Song) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<Song>("song-updated", (event) => handler(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}
export const audioUrl = (song: Song) =>
  song.audioPath ? convertFileSrc(song.audioPath) : null;

export const isActive = (song: Song) =>
  song.state === "queued" || song.state === "running";

const STAGE_LABELS: Record<Stage, string> = {
  preparing: "Warming up the studio",
  writing: "Writing the melody",
  performing: "Performing your song",
  rendering: "Recording",
  mixing: "Mixing",
  saving: "Finishing touches",
};
export function statusLabel(song: Song): string {
  if (song.state === "queued") return "Waiting for its turn";
  if (song.state === "running") {
    const label = STAGE_LABELS[song.stage ?? "preparing"];
    const p = song.progress;
    return p
      ? `${label} · ${Math.round((p.completed / p.total) * 100)}%`
      : label;
  }
  if (song.state === "cancelled") return "Stopped";
  if (song.state === "interrupted" || song.state === "failed")
    return song.message ?? "This song could not be finished.";
  return "";
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–:––";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A title for songs created without one: the first sung line, or the sound. */
export function displayTitle(request: SongRequest): string {
  if (request.title.trim()) return request.title.trim();
  const line = request.instrumental
    ? ""
    : request.lyrics
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("["));
  const source = line || request.style.split(",")[0]?.trim() || "Untitled";
  const words = source.replace(/[^\p{L}\p{N}' ]/gu, "").split(/\s+/);
  const short = words.slice(0, 5).join(" ");
  return short.charAt(0).toUpperCase() + short.slice(1) || "Untitled";
}
