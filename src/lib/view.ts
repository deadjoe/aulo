import { displayTitle, type Song } from "./songs";

export type Sort = "newest" | "oldest" | "liked" | "title";
export type Layout = "list" | "waveform" | "grid";
export interface Filters {
  liked: boolean;
  instrumental: boolean;
  vocals: boolean;
}
export interface ViewOptions {
  query: string;
  filters: Filters;
  sort: Sort;
  layout: Layout;
}
export const DEFAULT_VIEW: ViewOptions = {
  query: "",
  filters: { liked: false, instrumental: false, vocals: false },
  sort: "newest",
  layout: "list",
};
export const SORT_LABELS: Record<Sort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  liked: "Liked first",
  title: "Title",
};
export const LAYOUT_LABELS: Record<Layout, string> = {
  list: "List",
  waveform: "Waveform",
  grid: "Grid",
};

export const activeFilterCount = (f: Filters) =>
  Number(f.liked) + Number(f.instrumental) + Number(f.vocals);

export const isFiltered = (v: ViewOptions) =>
  v.query.trim() !== "" || activeFilterCount(v.filters) > 0;

/** The songs to show, in order. Instrumental and vocals together mean either. */
export function applyView(songs: Song[], v: ViewOptions): Song[] {
  const query = v.query.trim().toLowerCase();
  const { liked, instrumental, vocals } = v.filters;
  const shown = songs.filter((s) => {
    if (liked && !s.favorite) return false;
    if (instrumental !== vocals) {
      if (instrumental && !s.request.instrumental) return false;
      if (vocals && s.request.instrumental) return false;
    }
    if (!query) return true;
    return `${displayTitle(s.request)} ${s.request.style} ${s.request.lyrics}`
      .toLowerCase()
      .includes(query);
  });
  const byDate = (a: Song, b: Song) => b.createdMs - a.createdMs;
  const sorters: Record<Sort, (a: Song, b: Song) => number> = {
    newest: byDate,
    oldest: (a, b) => a.createdMs - b.createdMs,
    liked: (a, b) => Number(b.favorite) - Number(a.favorite) || byDate(a, b),
    title: (a, b) =>
      displayTitle(a.request).localeCompare(displayTitle(b.request)) ||
      byDate(a, b),
  };
  return [...shown].sort(sorters[v.sort]);
}

export function dayLabel(ms: number, now = new Date()): string {
  const date = new Date(ms);
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Date headings only make sense when songs are ordered by date. */
export function groupSongs(songs: Song[], sort: Sort): [string, Song[]][] {
  if (sort !== "newest" && sort !== "oldest") return [["", songs]];
  const groups: [string, Song[]][] = [];
  for (const song of songs) {
    const label = dayLabel(song.createdMs);
    const last = groups.at(-1);
    if (last?.[0] === label) last[1].push(song);
    else groups.push([label, [song]]);
  }
  return groups;
}

/** "2h ago", "3d ago", "5mo ago" for workspace and playlist summaries. */
export function ago(ms: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
