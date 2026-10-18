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
    const live = [song("new", "queued"), song("a", "completed")];
    const merged = mergeLoaded(loaded, live);
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
