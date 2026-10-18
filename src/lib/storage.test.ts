import { describe, expect, it } from "vitest";
import { parseDrafts } from "./storage";
describe("local draft recovery", () => {
  it("recovers safely from invalid or obsolete storage", () => {
    for (const value of [null, "", "broken", "{}", "null", '[null,1,"x"]'])
      expect(parseDrafts(value)).toEqual([]);
  });
  it("retains valid drafts without trusting malformed entries", () => {
    const draft = {
      id: "1",
      title: "Sunday",
      lyrics: "",
      style: "Piano",
      created: "2026-10-18",
      favorite: false,
    };
    expect(parseDrafts(JSON.stringify([draft, { id: "2" }]))).toEqual([draft]);
  });
});
