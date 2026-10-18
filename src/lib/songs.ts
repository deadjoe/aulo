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
  workspace: string;
}
export const DEFAULT_WORKSPACE = "default";
export interface Workspace {
  id: string;
  name: string;
  createdMs: number;
  archived: boolean;
}
export interface Playlist {
  id: string;
  name: string;
  createdMs: number;
  songIds: string[];
}
export interface Collections {
  workspaces: Workspace[];
  playlists: Playlist[];
}
export const EMPTY_COLLECTIONS: Collections = {
  workspaces: [
    {
      id: DEFAULT_WORKSPACE,
      name: "My Workspace",
      createdMs: 0,
      archived: false,
    },
  ],
  playlists: [],
};
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
export const createSong = (request: SongRequest, workspace: string) =>
  invoke<Song>("create_song", { request, workspace });
export const cancelSong = (id: string) => invoke<void>("cancel_song", { id });
export const updateSong = (
  id: string,
  changes: { title?: string; favorite?: boolean },
) => invoke<void>("update_song", { id, ...changes });
export const trashSongs = (ids: string[]) =>
  invoke<string[]>("trash_songs", { ids });
export const listCollections = () =>
  isTauri()
    ? invoke<Collections>("list_collections")
    : Promise.resolve(EMPTY_COLLECTIONS);
export function onCollectionsUpdated(handler: (c: Collections) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<Collections>("collections-updated", (e) =>
    handler(e.payload),
  );
  return () => void stop.then((unlisten) => unlisten());
}
export const createWorkspace = (name: string) =>
  invoke<Workspace>("create_workspace", { name });
export const renameWorkspace = (id: string, name: string) =>
  invoke<void>("rename_workspace", { id, name });
export const archiveWorkspace = (id: string, archived: boolean) =>
  invoke<void>("archive_workspace", { id, archived });
export const moveSongs = (ids: string[], workspace: string) =>
  invoke<void>("move_songs", { ids, workspace });
export const createPlaylist = (name: string, songs: string[]) =>
  invoke<Playlist>("create_playlist", { name, songs });
export const renamePlaylist = (id: string, name: string) =>
  invoke<void>("rename_playlist", { id, name });
export const deletePlaylist = (id: string) =>
  invoke<void>("delete_playlist", { id });
export const addToPlaylist = (id: string, songs: string[]) =>
  invoke<number>("add_to_playlist", { id, songs });
export const removeFromPlaylist = (id: string, songs: string[]) =>
  invoke<void>("remove_from_playlist", { id, songs });
export const songWaveform = (id: string) =>
  invoke<number[]>("song_waveform", { id });
export type AudioFormat = "m4a" | "mp3" | "wav" | "flac";
export const exportSong = (
  id: string,
  format: AudioFormat,
  destination: string,
) => invoke<void>("export_song", { id, format, destination });
export const revealSong = (id: string) => invoke<void>("reveal_song", { id });
export const revealLibrary = () => invoke<void>("reveal_library");
export const appVersion = async () => {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
};
export function onSongUpdated(handler: (song: Song) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<Song>("song-updated", (event) => handler(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}
export const audioUrl = (song: Song) =>
  song.audioPath ? convertFileSrc(song.audioPath) : null;

export const isActive = (song: Song) =>
  song.state === "queued" || song.state === "running";

/** Plain status words for songs that are not finished; finished songs need none. */
export function statusLabel(song: Song): string {
  if (song.state === "queued") return "Waiting to start…";
  if (song.state === "running") return "Creating…";
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
