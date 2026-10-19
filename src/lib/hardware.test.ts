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
  it("follows the native plan instead of its own memory rule", () => {
    // A 7.8 GiB Mac counts as 8 GB natively; the interface does not second-guess it.
    expect(assessHardware({ ...mac, memoryGiB: 7.8 }).status).toBe("candidate");
    const small = assessHardware({
      ...mac,
      memoryGiB: 4,
      blocker:
        "Aulo needs a Mac with Apple silicon and at least 8 GB of memory to make music.",
    });
    expect(small).toMatchObject({ status: "limited", profile: null });
    expect(small.description).toContain("at least 8 GB of memory");
  });
  it("asks Windows PCs without a card found to check again", () => {
    const missing = assessHardware({
      ...mac,
      platform: "windows",
      arch: "x86_64",
      blocker:
        "Aulo couldn’t find an NVIDIA graphics card. If this PC has one, update its driver, then check again.",
    });
    expect(missing.status).toBe("unknown");
    expect(missing.description).toContain("then check again");
  });
  it("names a card that is too small", () =>
    expect(
      assessHardware({
        ...mac,
        platform: "windows",
        arch: "x86_64",
        gpu: "GTX 1650",
        gpuMemoryGiB: 4,
        blocker:
          "Aulo needs an NVIDIA graphics card with at least 8 GB of memory to make music.",
      }),
    ).toMatchObject({
      status: "limited",
      title: "This graphics card has too little memory",
    }));
  it("accepts a PC the plan accepts", () =>
    expect(
      assessHardware({
        ...mac,
        platform: "windows",
        arch: "x86_64",
        gpu: "RTX 2070",
        gpuMemoryGiB: 7.99,
      }).status,
    ).toBe("candidate"));
  it("does not promise Linux or Intel Mac support", () => {
    expect(
      assessHardware({ ...mac, platform: "linux", blocker: "No." }).status,
    ).toBe("unsupported");
    expect(assessHardware({ ...mac, platform: "linux" }).status).toBe(
      "unsupported",
    );
  });
});
