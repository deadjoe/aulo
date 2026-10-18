import type { SongRequest } from "./songs";

export const STYLE_IDEAS = [
  "dreamy indie pop",
  "warm piano",
  "lo-fi hip hop",
  "cinematic strings",
  "acoustic folk",
  "city pop",
  "synthwave",
  "soulful r&b",
  "bossa nova",
  "upbeat funk",
  "ambient pads",
  "gritty garage rock",
  "jazz trio",
  "anthemic rock",
  "chillwave",
  "afrobeat groove",
  "bedroom pop",
  "orchestral ballad",
  "dark techno",
  "country road trip",
  "gospel choir",
  "trip hop",
  "j-pop sparkle",
  "flamenco guitar",
  "reggae sunshine",
  "slow-burning blues",
  "glitchy electronica",
  "punchy drum and bass",
];

/** A stable, varied handful of ideas that skips what the style already says. */
export function styleIdeas(round: number, style: string, count = 6): string[] {
  const used = style.toLowerCase();
  const fresh = STYLE_IDEAS.filter((idea) => !used.includes(idea));
  const offset = (round * count) % Math.max(fresh.length, 1);
  return [...fresh.slice(offset), ...fresh.slice(0, offset)].slice(0, count);
}

export function addStyle(style: string, idea: string): string {
  const trimmed = style.trim().replace(/,\s*$/, "");
  return trimmed ? `${trimmed}, ${idea}` : idea;
}

export const SECTIONS = ["Verse", "Chorus", "Bridge", "Outro"] as const;
export function addSection(lyrics: string, section: string): string {
  const tag = `[${section}]\n`;
  if (!lyrics.trim()) return tag;
  return `${lyrics.replace(/\s+$/, "")}\n\n${tag}`;
}

export const EMPTY_REQUEST: SongRequest = {
  title: "",
  style: "",
  lyrics: "",
  instrumental: false,
  vocal: "auto",
  weirdness: 50,
  styleInfluence: 50,
};

const KEY = "aulo.composer.v1";
export function loadComposer(): SongRequest {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return EMPTY_REQUEST;
    const v = value as Record<string, unknown>;
    const text = (k: string) =>
      typeof v[k] === "string" ? (v[k] as string) : "";
    const level = (k: string) =>
      typeof v[k] === "number" && v[k] >= 0 && v[k] <= 100
        ? (v[k] as number)
        : 50;
    return {
      title: text("title"),
      style: text("style"),
      lyrics: text("lyrics"),
      instrumental: v.instrumental === true,
      vocal: v.vocal === "female" || v.vocal === "male" ? v.vocal : "auto",
      weirdness: level("weirdness"),
      styleInfluence: level("styleInfluence"),
    };
  } catch {
    return EMPTY_REQUEST;
  }
}
export function saveComposer(request: SongRequest) {
  try {
    localStorage.setItem(KEY, JSON.stringify(request));
  } catch {
    /* The composer still works without remembering unsent text. */
  }
}
