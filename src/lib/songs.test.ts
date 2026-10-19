import { describe, expect, it } from "vitest";
import { creatingText, type Song } from "./songs";

const song = (fields: Partial<Song>): Song => ({
  id: "a",
  createdMs: 0,
  request: {
    title: "",
    style: "folk",
    lyrics: "a line",
    instrumental: false,
    vocal: "auto",
    weirdness: 50,
    styleInfluence: 50,
  },
  favorite: false,
  state: "running",
  stage: "performing",
  progress: null,
  startedMs: 1_000_000,
  duration: null,
  audioPath: null,
  message: null,
  workspace: "default",
  trashedMs: null,
  ...fields,
});

describe("the words under a song being made", () => {
  it("shows a moving clock and how long is usually left", () => {
    const making = song({ expectedMs: 240_000 });
    expect(creatingText(making, 1_000_000 + 65_000)).toBe(
      "Creating… 1:05 · About 3 min left",
    );
    expect(creatingText(making, 1_000_000 + 200_000)).toBe(
      "Creating… 3:20 · Almost done",
    );
    expect(creatingText(making, 1_000_000 + 300_000)).toBe(
      "Creating… 5:00 · Taking a little longer than usual",
    );
  });
  it("says the first song takes longer when this computer has made none", () => {
    expect(creatingText(song({}), 1_000_000 + 5_000)).toBe(
      "Creating… 0:05 · The first song takes longer while Aulo gets ready",
    );
  });
  it("keeps the plain words for songs not being made", () => {
    expect(creatingText(song({ state: "queued", startedMs: null }), 0)).toBe(
      "Waiting to start…",
    );
    expect(
      creatingText(song({ state: "failed", message: "Shorten them." }), 0),
    ).toBe("Shorten them.");
  });
});
