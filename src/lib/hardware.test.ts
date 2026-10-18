import { describe, expect, it } from "vitest";
import { assessHardware, type Hardware } from "./hardware";
const mac: Hardware = {
  platform: "macos",
  arch: "aarch64",
  chip: "Apple M4",
  memoryGiB: 32,
  freeDiskGiB: 100,
  gpu: null,
  gpuMemoryGiB: null,
  dataPath: "/models",
};
describe("hardware eligibility", () => {
  it("does not invent hardware in browser mode", () =>
    expect(assessHardware(null).status).toBe("unknown"));
  it("distinguishes a candidate from installed runtime readiness", () =>
    expect(assessHardware(mac)).toMatchObject({
      status: "candidate",
      profile: "apple-silicon",
    }));
  it("does not recommend an unsupported low-memory Mac", () =>
    expect(assessHardware({ ...mac, memoryGiB: 16 }).profile).toBeNull());
  it("does not silently fall back to CPU on Windows", () =>
    expect(
      assessHardware({ ...mac, platform: "windows", arch: "x86_64" }).status,
    ).toBe("unknown"));
  it("accepts marketed 8 GB NVIDIA cards while keeping validation provisional", () =>
    expect(
      assessHardware({
        ...mac,
        platform: "windows",
        arch: "x86_64",
        gpu: "RTX 2070",
        gpuMemoryGiB: 7.99,
      }).status,
    ).toBe("candidate"));
  it("rejects cards below the initial memory target", () =>
    expect(
      assessHardware({
        ...mac,
        platform: "windows",
        arch: "x86_64",
        gpu: "GTX 1650",
        gpuMemoryGiB: 4,
      }).status,
    ).toBe("limited"));
  it("does not promise Linux or Intel Mac support", () => {
    expect(assessHardware({ ...mac, platform: "linux" }).status).toBe(
      "unsupported",
    );
    expect(assessHardware({ ...mac, arch: "x86_64" }).status).toBe(
      "unsupported",
    );
  });
});
