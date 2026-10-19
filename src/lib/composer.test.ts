// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  addSection,
  addStyle,
  EMPTY_REQUEST,
  lengthNote,
  loadComposer,
  saveComposer,
  STYLE_IDEAS,
  styleIdeas,
} from "./composer";

afterEach(() => localStorage.clear());

describe("composer helpers", () => {
  it("joins style ideas without stray commas", () => {
    expect(addStyle("", "warm piano")).toBe("warm piano");
    expect(addStyle("lofi, ", "warm piano")).toBe("lofi, warm piano");
  });

  it("offers fresh ideas that skip what the style already says", () => {
    const ideas = styleIdeas(0, "Warm Piano, bossa nova");
    expect(ideas).toHaveLength(6);
    expect(ideas).not.toContain("warm piano");
    expect(ideas).not.toContain("bossa nova");
    expect(styleIdeas(1, "")).not.toEqual(styleIdeas(0, ""));
    expect(styleIdeas(Math.ceil(STYLE_IDEAS.length / 6), "")).toHaveLength(6);
  });

  it("adds song sections on their own lines", () => {
    expect(addSection("", "Verse")).toBe("[Verse]\n");
    expect(addSection("hello\n\n", "Chorus")).toBe("hello\n\n[Chorus]\n");
  });

  it("restores unsent text and ignores anything malformed", () => {
    saveComposer({ ...EMPTY_REQUEST, style: "jazz", weirdness: 80 });
    expect(loadComposer()).toMatchObject({ style: "jazz", weirdness: 80 });
    localStorage.setItem(
      "aulo.composer.v1",
      JSON.stringify({ style: 3, weirdness: 900, vocal: "robot" }),
    );
    expect(loadComposer()).toEqual(EMPTY_REQUEST);
    localStorage.setItem("aulo.composer.v1", "{broken");
    expect(loadComposer()).toEqual(EMPTY_REQUEST);
  });
});

describe("lyrics longer than one song", () => {
  const lines = (n: number) =>
    ["[Verse]", ...Array.from({ length: n }, (_, i) => `line ${i}`)].join("\n");
  it("warns only when the lyrics may run past this computer's limit", () => {
    expect(lengthNote(lines(30), 290)).toBeNull();
    expect(lengthNote(lines(70), 290)).toBe(
      "Songs can be up to about 5 minutes on this computer. These lyrics may be cut off at the end.",
    );
    expect(lengthNote(lines(70), 360)).toBeNull();
    expect(lengthNote(lines(90), 360)).toContain("about 6 minutes");
  });
  it("says nothing before the limit is known", () => {
    expect(lengthNote(lines(200), undefined)).toBeNull();
  });
});
