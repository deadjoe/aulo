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
}
export interface Assessment {
  status: "candidate" | "limited" | "unsupported" | "unknown";
  title: string;
  description: string;
  profile: "apple-silicon" | "windows-nvidia" | null;
}

// Eligibility is a setup recommendation, never proof that the runtime works.
export function assessHardware(h: Hardware | null): Assessment {
  if (!h)
    return {
      status: "unknown",
      title: "Aulo checks this in the app",
      description:
        "Open the Aulo app to see whether this computer can make music.",
      profile: null,
    };
  if (h.platform === "macos" && h.arch === "aarch64") {
    // The same rule as src-tauri/src/plan.rs: 8 GB is enough, with shorter songs.
    if (Math.round(h.memoryGiB) < 8)
      return {
        status: "limited",
        title: "This Mac has less memory than Aulo needs",
        description:
          "Aulo needs a Mac with Apple silicon and at least 8 GB of memory to make music. You can still look around.",
        profile: null,
      };
    return {
      status: "candidate",
      title: "Your Mac looks ready for Aulo",
      description: "It has the chip and memory Aulo needs to make music.",
      profile: "apple-silicon",
    };
  }
  if (h.platform === "windows" && h.arch === "x86_64") {
    if (!h.gpu || h.gpuMemoryGiB === null)
      return {
        status: "unknown",
        title: "Aulo couldn’t find an NVIDIA graphics card",
        description:
          "On Windows, Aulo makes music with an NVIDIA graphics card. If this PC has one, update its driver and check again.",
        profile: null,
      };
    if (h.gpuMemoryGiB < 7.5)
      return {
        status: "limited",
        title: "This graphics card has too little memory",
        description:
          "Aulo needs an NVIDIA graphics card with at least 8 GB of memory. You can still look around.",
        profile: null,
      };
    return {
      status: "candidate",
      title: "Your PC looks ready for Aulo",
      description:
        "It has an NVIDIA graphics card with enough memory to make music.",
      profile: "windows-nvidia",
    };
  }
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
