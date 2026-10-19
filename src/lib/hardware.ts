import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Hardware {
  platform: string;
  arch: string;
  chip: string;
  memoryGiB: number;
  freeDiskGiB: number | null;
  gpu: string | null;
  gpuMemoryGiB: number | null;
  dataPath: string;
  /** Why this computer cannot make songs, from the native engine plan. */
  blocker?: string | null;
}
export interface Assessment {
  status: "candidate" | "limited" | "unsupported" | "unknown";
  title: string;
  description: string;
  profile: "apple-silicon" | "windows-nvidia" | null;
}

// Eligibility is a setup recommendation, never proof that the runtime works. Whether
// this computer can make songs is decided by the native side (src-tauri/src/plan.rs) and
// arrives as `blocker`; nothing here repeats that rule.
export function assessHardware(h: Hardware | null): Assessment {
  if (!h)
    return {
      status: "unknown",
      title: "Aulo checks this in the app",
      description:
        "Open the Aulo app to see whether this computer can make music.",
      profile: null,
    };
  const mac = h.platform === "macos" && h.arch === "aarch64";
  const pc = h.platform === "windows" && h.arch === "x86_64";
  if (h.blocker) {
    const lookAround = `${h.blocker} You can still look around.`;
    if (pc && !h.gpu)
      return {
        status: "unknown",
        title: "Aulo couldn’t find an NVIDIA graphics card",
        description: h.blocker,
        profile: null,
      };
    if (pc || mac)
      return {
        status: "limited",
        title: pc
          ? "This graphics card has too little memory"
          : "This Mac has less memory than Aulo needs",
        description: lookAround,
        profile: null,
      };
    return {
      status: "unsupported",
      title: "Aulo can’t make music on this computer yet",
      description: lookAround,
      profile: null,
    };
  }
  if (mac)
    return {
      status: "candidate",
      title: "Your Mac looks ready for Aulo",
      description: "It has the chip and memory Aulo needs to make music.",
      profile: "apple-silicon",
    };
  if (pc)
    return {
      status: "candidate",
      title: "Your PC looks ready for Aulo",
      description:
        "It has an NVIDIA graphics card with enough memory to make music.",
      profile: "windows-nvidia",
    };
  return {
    status: "unsupported",
    title: "Aulo can’t make music on this computer yet",
    description:
      "Aulo works on Macs with Apple silicon and on Windows PCs with an NVIDIA graphics card. You can still look around.",
    profile: null,
  };
}

export async function detectHardware(): Promise<Hardware | null> {
  if (!isTauri()) return null;
  return invoke<Hardware>("inspect_hardware");
}

export async function chooseModelFolder(): Promise<string | null> {
  if (!isTauri())
    throw new Error("Folder selection is available in the desktop app.");
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    directory: true,
    multiple: false,
    title: "Choose the folder with your music models",
  });
}
