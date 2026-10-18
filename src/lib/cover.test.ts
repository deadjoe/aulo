import { describe, expect, it } from "vitest";
import { coverKind, coverSvg } from "./cover";

describe("covers", () => {
  it("picks a composition from the style", () => {
    expect(coverKind("a", "Dark Synthwave, 120 bpm").composition).toBe("grid");
    expect(coverKind("a", "warm acoustic folk").composition).toBe("hills");
    expect(coverKind("a", "dreamy lo-fi beats").composition).toBe("mist");
    expect(coverKind("a", "jazz piano trio").composition).toBe("rings");
    expect(coverKind("a", "punk rock anthem").composition).toBe("shards");
    expect(coverKind("a", "disco funk").composition).toBe("confetti");
    expect(coverKind("a", "epic cinematic orchestral").composition).toBe(
      "peaks",
    );
    expect(coverKind("a", "reggae summer").composition).toBe("sunburst");
    expect(coverKind("a", "boom bap hip hop").composition).toBe("blocks");
    // Specific genres win over broad words they contain.
    expect(coverKind("a", "dream pop").composition).toBe("mist");
    expect(coverKind("a", "pop rap").composition).toBe("blocks");
  });

  it("is the same picture every time and differs between songs", () => {
    expect(coverSvg("song-1", "folk")).toBe(coverSvg("song-1", "folk"));
    expect(coverSvg("song-1", "folk")).not.toBe(coverSvg("song-2", "folk"));
    // Unknown styles still vary from song to song.
    const kinds = new Set(
      Array.from(
        { length: 40 },
        (_, i) => coverKind(`x${i}`, "glass harp").composition,
      ),
    );
    expect(kinds.size).toBeGreaterThan(4);
  });

  it("never carries the words people wrote into the markup", () => {
    const svg = coverSvg(
      "song-1",
      'folk <script>alert(1)</script> " onload="x',
      'k"><img src=x>',
    );
    expect(svg).not.toMatch(/script|onload|<img|alert/);
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"',
      ),
    ).toBe(true);
    expect(svg.match(/<svg/g)).toHaveLength(1);
  });

  it("keeps drawing ids apart when the same cover is shown twice", () => {
    const one = coverSvg("song-1", "synthwave", "first");
    const two = coverSvg("song-1", "synthwave", "second");
    expect(one).toContain('id="firsts"');
    expect(two).toContain('id="seconds"');
    expect(two).not.toContain("first");
  });
});
