import { describe, expect, it } from "vitest";
import { downloadPace, paceText } from "./models";

describe("download speed and time left", () => {
  it("waits for a few seconds of progress before saying anything", () => {
    expect(downloadPace([], 100)).toBeNull();
    expect(
      downloadPace(
        [
          { at: 0, bytes: 0 },
          { at: 2_000, bytes: 10_000_000 },
        ],
        100,
      ),
    ).toBeNull();
  });
  it("uses the last 20 seconds", () => {
    const pace = downloadPace(
      [
        { at: 0, bytes: 0 }, // older than 20 s before the last sample: ignored
        { at: 10_000, bytes: 50_000_000 },
        { at: 30_000, bytes: 250_000_000 },
      ],
      4_340_000_000,
    )!;
    expect(pace.bytesPerSecond).toBe(10_000_000);
    expect(paceText(pace)).toBe("10.0 MB/s · About 7 min left");
  });
  it("says nothing while nothing moves", () => {
    expect(
      downloadPace(
        [
          { at: 0, bytes: 5 },
          { at: 10_000, bytes: 5 },
        ],
        100,
      ),
    ).toBeNull();
  });
  it("speaks in hours for slow links and under a minute at the end", () => {
    expect(paceText({ bytesPerSecond: 500_000, secondsLeft: 8_000 })).toBe(
      "0.5 MB/s · About 2 h left",
    );
    expect(paceText({ bytesPerSecond: 9_000_000, secondsLeft: 20 })).toBe(
      "9.0 MB/s · Less than a minute left",
    );
  });
});
