import { describe, expect, it } from "vitest";
import { mergeLoaded, upsert } from "./useLibrary";
import { statusLabel, type Song } from "./songs";

const song = (id: string, state: Song["state"] = "completed"): Song => ({
  id,
  createdMs: 1,
  request: {
    title: id,
    style: "folk",
    lyrics: "",
    instrumental: true,
    vocal: "auto",
    weirdness: 50,
    styleInfluence: 50,
  },
  favorite: false,
  state,
  stage: null,
  progress: null,
  startedMs: null,
  duration: null,
  audioPath: null,
  message: null,
  workspace: "default",
  trashedMs: null,
});

describe("library updates", () => {
  it("adds new songs first and replaces known ones in place", () => {
    const list = [song("a"), song("b")];
    expect(upsert(list, song("c")).map((s) => s.id)).toEqual(["c", "a", "b"]);
    const changed = upsert(list, { ...song("b"), favorite: true });
    expect(changed.map((s) => s.id)).toEqual(["a", "b"]);
    expect(changed[1].favorite).toBe(true);
    expect(list[1].favorite).toBe(false);
  });

  it("keeps live updates that arrived while the library was loading", () => {
    const loaded = [song("a", "running"), song("b")];
    const arrived = [
      song("a", "running"),
      song("a", "completed"),
      song("new", "queued"),
    ];
    const merged = mergeLoaded(loaded, arrived);
    expect(merged.map((s) => s.id)).toEqual(["new", "a", "b"]);
    expect(merged.find((s) => s.id === "a")?.state).toBe("completed");
  });

  it("describes unfinished songs in plain words only", () => {
    expect(statusLabel(song("a", "queued"))).toBe("Waiting to start…");
    expect(statusLabel({ ...song("a", "running"), stage: "rendering" })).toBe(
      "Creating…",
    );
    expect(statusLabel(song("a", "completed"))).toBe("");
    expect(statusLabel({ ...song("a", "failed"), message: "Try again." })).toBe(
      "Try again.",
    );
  });
});

import { applyView, DEFAULT_VIEW, groupSongs } from "./view";

describe("library view", () => {
  const a = { ...song("a"), createdMs: 1, favorite: true };
  const b = {
    ...song("b"),
    createdMs: 2,
    request: { ...song("b").request, instrumental: false, title: "Zebra" },
  };
  const c = {
    ...song("c"),
    createdMs: 3,
    request: { ...song("c").request, title: "Apple", style: "jazz trio" },
  };
  const all = [a, b, c];

  it("sorts by date, likes and title", () => {
    const ids = (sort: typeof DEFAULT_VIEW.sort) =>
      applyView(all, { ...DEFAULT_VIEW, sort }).map((s) => s.id);
    expect(ids("newest")).toEqual(["c", "b", "a"]);
    expect(ids("oldest")).toEqual(["a", "b", "c"]);
    expect(ids("liked")).toEqual(["a", "c", "b"]);
    expect(ids("title")).toEqual(["a", "c", "b"]);
  });

  it("filters by likes, vocals and search text", () => {
    const view = (filters: Partial<typeof DEFAULT_VIEW.filters>, query = "") =>
      applyView(all, {
        ...DEFAULT_VIEW,
        query,
        filters: { ...DEFAULT_VIEW.filters, ...filters },
      }).map((s) => s.id);
    expect(view({ liked: true })).toEqual(["a"]);
    expect(view({ vocals: true })).toEqual(["b"]);
    expect(view({ instrumental: true })).toEqual(["c", "a"]);
    expect(view({ instrumental: true, vocals: true })).toHaveLength(3);
    expect(view({}, "JAZZ")).toEqual(["c"]);
  });

  it("groups by day only when sorted by date", () => {
    expect(groupSongs(all, "title")).toEqual([["", all]]);
    expect(groupSongs(all, "newest")[0][1]).toHaveLength(3);
  });
});

import { finishedNotice, formatSize } from "./settings";

describe("finished notices", () => {
  it("speaks only when a song stops being made", () => {
    expect(
      finishedNotice(song("a", "running"), song("a", "completed")),
    ).toEqual({ title: "Your song is ready", body: "“a” is ready to play." });
    expect(
      finishedNotice(song("a", "queued"), {
        ...song("a", "failed"),
        message: "The music engine stopped.",
      }),
    ).toEqual({
      title: "A song couldn’t be finished",
      body: "The music engine stopped.",
    });
    // Reloads, likes and renames of finished songs never notify.
    expect(finishedNotice(song("a"), song("a"))).toBeNull();
    expect(finishedNotice(undefined, song("a"))).toBeNull();
    // Stopping a song yourself is not news.
    expect(
      finishedNotice(song("a", "running"), song("a", "cancelled")),
    ).toBeNull();
  });

  it("writes sizes people read", () => {
    expect(formatSize(7_790_000_000)).toBe("7.8 GB");
    expect(formatSize(95_400_000)).toBe("95 MB");
    expect(formatSize(1200)).toBe("Less than 1 MB");
    expect(formatSize(0)).toBe("None");
  });
});
