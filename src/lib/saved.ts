import { invoke, isTauri } from "@tauri-apps/api/core";

export type SavedKind = "lyrics" | "styles";

export interface Saved {
  id: string;
  /** A song title; empty means "name it by its first line". */
  title: string;
  text: string;
  savedMs: number;
}

// Outside the desktop app (previews and tests) the lists live in memory.
const memory: Record<SavedKind, Saved[]> = { lyrics: [], styles: [] };

export const listSaved = (kind: SavedKind) =>
  isTauri()
    ? invoke<Saved[]>("list_saved", { kind })
    : Promise.resolve([...memory[kind]]);

export function saveText(kind: SavedKind, text: string, title = "") {
  if (isTauri()) return invoke<Saved>("save_text", { kind, title, text });
  const trimmed = text.trim();
  const existing = memory[kind].find((s) => s.text === trimmed);
  const entry: Saved = existing
    ? { ...existing, savedMs: Date.now() }
    : { id: crypto.randomUUID(), title, text: trimmed, savedMs: Date.now() };
  memory[kind] = [entry, ...memory[kind].filter((s) => s !== existing)];
  return Promise.resolve(entry);
}

export function deleteSaved(kind: SavedKind, id: string) {
  if (isTauri()) return invoke<void>("delete_saved", { kind, id });
  memory[kind] = memory[kind].filter((s) => s.id !== id);
  return Promise.resolve();
}

/** What a saved entry is called: its title, or its first line of words. */
export function savedName(saved: Saved): string {
  if (saved.title.trim()) return saved.title.trim();
  const words = saved.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^\[.*\]$/.test(line));
  return words ?? saved.text.trim().split("\n")[0] ?? "";
}

/** The lines to preview under the name: lyrics without section labels. */
export function savedPreview(saved: Saved): string {
  return saved.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\[.*\]$/.test(line))
    .slice(0, 2)
    .join("\n");
}
