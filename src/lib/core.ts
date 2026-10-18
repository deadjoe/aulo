// The UI depends on this boundary, not on Gradio routes or engine internals.
// Generation remains gated while the private runtime is being integrated.
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface EngineStatus {
  state: "not_installed" | "unavailable" | "detected";
  message: string;
  generationReady: false;
  engineVersion: string | null;
  device: string | null;
}

export async function inspectEngine(): Promise<EngineStatus> {
  if (!isTauri()) {
    return {
      state: "unavailable",
      message: "Open the desktop app to check the music engine.",
      generationReady: false,
      engineVersion: null,
      device: null,
    };
  }
  return invoke<EngineStatus>("engine_status");
}

export interface CoreCapabilities {
  protocolVersion: 1;
  engineVersion: string;
  generate: boolean;
  plan: boolean;
  cover: boolean;
  edit: boolean;
}
export interface GenerationRequest {
  title: string;
  lyrics: string;
  style: string;
  abc?: string;
}
export interface Job {
  id: string;
  state: "queued" | "running" | "completed" | "cancelled" | "failed";
  workId?: string;
}
export interface CoreClient {
  capabilities(): Promise<CoreCapabilities>;
  generate(request: GenerationRequest): Promise<Job>;
  job(id: string): Promise<Job>;
  cancel(id: string): Promise<void>;
}
export const runtimeStatus = {
  available: false,
  reason: "The music engine is not bundled in this preview.",
} as const;
