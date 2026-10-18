export interface Draft {
  id: string;
  title: string;
  lyrics: string;
  style: string;
  created: string;
  favorite: boolean;
}
const KEY = "aulo.drafts.v1";
export function parseDrafts(raw: string | null): Draft[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (d): d is Draft =>
        d !== null &&
        typeof d === "object" &&
        ["id", "title", "lyrics", "style", "created"].every(
          (k) => typeof d[k] === "string",
        ) &&
        typeof d.favorite === "boolean",
    );
  } catch {
    return [];
  }
}
export function loadDrafts(): Draft[] {
  try {
    return parseDrafts(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}
export function saveDrafts(drafts: Draft[]): void {
  localStorage.setItem(KEY, JSON.stringify(drafts));
}
