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
      title: "A quick check in the desktop app",
      description:
        "Your browser cannot reliably inspect your graphics card or available memory. The desktop app checks these automatically.",
      profile: null,
    };
  if (h.platform === "macos" && h.arch === "aarch64") {
    if (h.memoryGiB < 31)
      return {
        status: "limited",
        title: "This Mac needs more memory",
        description:
          "The current music engine targets Apple Silicon Macs with 32 GB of memory or more. You can still explore the workspace.",
        profile: null,
      };
    return {
      status: "candidate",
      title: "A promising home for your music",
      description:
        "Your Apple Silicon Mac meets the initial memory recommendation. A runtime check is still required before creating music.",
      profile: "apple-silicon",
    };
  }
  if (h.platform === "windows" && h.arch === "x86_64") {
    if (!h.gpu || h.gpuMemoryGiB === null)
      return {
        status: "unknown",
        title: "We could not verify your graphics card",
        description:
          "Aulo currently targets NVIDIA graphics on Windows. Detection may require an installed NVIDIA driver. You can retry or explore the workspace.",
        profile: null,
      };
    if (h.gpuMemoryGiB < 7.5)
      return {
        status: "limited",
        title: "More graphics memory is needed",
        description:
          "The initial Windows target needs an NVIDIA GPU with at least 8 GB of graphics memory. Support still needs validation on your device.",
        profile: null,
      };
    return {
      status: "candidate",
      title: "Your graphics card looks suitable",
      description:
        "We found an NVIDIA GPU with enough memory for the initial Windows target. Windows runtime validation is still pending.",
      profile: "windows-nvidia",
    };
  }
  return {
    status: "unsupported",
    title: "This computer is not supported yet",
    description:
      "The first release targets Apple Silicon Macs and Windows PCs with NVIDIA graphics. The workspace preview is still available.",
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
    title: "Choose a model folder",
  });
}
