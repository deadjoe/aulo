// The UI depends on this boundary, not on Gradio routes or engine internals.
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface EngineStatus {
  state: "not_installed" | "unavailable" | "unsupported" | "ready";
  message: string;
  generationReady: boolean;
  engineVersion: string | null;
  device: string | null;
  backend: string | null;
}

export async function inspectEngine(): Promise<EngineStatus> {
  if (!isTauri()) {
    return {
      state: "unavailable",
      message: "Open the desktop app to check the music engine.",
      generationReady: false,
      engineVersion: null,
      device: null,
      backend: null,
    };
  }
  return invoke<EngineStatus>("engine_status");
}
