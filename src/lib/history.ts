// Recently played songs, newest first; kept on this computer only.
const KEY = "aulo.history.v1";
const LIMIT = 200;

export interface Played {
  id: string;
  playedMs: number;
}

export function loadHistory(): Played[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (p): p is Played =>
            typeof p?.id === "string" && typeof p?.playedMs === "number",
        )
      : [];
  } catch {
    return [];
  }
}

/** Put a song at the top of the history, once. */
export function recordPlay(history: Played[], id: string, now = Date.now()) {
  const next = [{ id, playedMs: now }, ...history.filter((p) => p.id !== id)];
  return next.slice(0, LIMIT);
}

export function saveHistory(history: Played[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(history));
  } catch {
    /* history is a convenience */
  }
}
