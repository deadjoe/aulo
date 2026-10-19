import { invoke, isTauri } from "@tauri-apps/api/core";
export interface ModelPlan {
  label: string;
  totalBytes: number;
  requiredFreeBytes: number;
  freeBytes: number | null;
  destination: string;
  license: string;
  licenseUrl: string;
  fileCount: number;
}
export type ModelPhase =
  | "not_started"
  | "checking"
  | "verifying"
  | "downloading"
  | "retrying"
  | "paused"
  | "unverified"
  | "verified"
  | "failed"
  | "removing";
export interface ModelStatus {
  phase: ModelPhase;
  operation: "download" | "verify" | null;
  completedBytes: number;
  totalBytes: number;
  currentFile: string | null;
  message: string;
  modelRoot: string | null;
  modelsVerified: boolean;
  runtimeState: "not_bundled";
  generationReady: false;
}
export const desktopModelsAvailable = () => isTauri();
export const getModelPlan = () => invoke<ModelPlan>("model_plan");
export const getModelStatus = () => invoke<ModelStatus>("model_status");
export const downloadModels = (termsAccepted: boolean) =>
  invoke<void>("download_models", { termsAccepted });
export const verifyModels = (folder: string) =>
  invoke<void>("verify_models", { folder });
export const pauseModels = () => invoke<void>("pause_models");
export const modelOperationActive = (s: ModelStatus | null) =>
  !!s && ["checking", "verifying", "downloading", "retrying"].includes(s.phase);
export function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export interface Sample {
  at: number;
  bytes: number;
}

/**
 * Download speed and time left from recent progress samples (oldest first), over about
 * the last 20 seconds. Null until there is enough to say anything honest.
 */
export function downloadPace(
  samples: Sample[],
  total: number,
): { bytesPerSecond: number; secondsLeft: number } | null {
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last && last.at - s.at <= 20_000);
  if (!first || !last || last.at - first.at < 3_000) return null;
  const bytesPerSecond =
    ((last.bytes - first.bytes) * 1000) / (last.at - first.at);
  if (bytesPerSecond <= 0) return null;
  return {
    bytesPerSecond,
    secondsLeft: Math.max(0, total - last.bytes) / bytesPerSecond,
  };
}

/** "12.4 MB/s · About 9 min left" */
export function paceText(pace: {
  bytesPerSecond: number;
  secondsLeft: number;
}) {
  const speed = `${(pace.bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
  const minutes = Math.ceil(pace.secondsLeft / 60);
  const left =
    pace.secondsLeft < 60
      ? "Less than a minute left"
      : minutes < 90
        ? `About ${minutes} min left`
        : `About ${Math.round(minutes / 60)} h left`;
  return `${speed} · ${left}`;
}

export const openModelLicense = () => invoke<void>("open_model_license");
/** Settings › Remove music models. A folder of the person's own is kept. */
export const removeModels = () =>
  invoke<{ keptFolder: string | null }>("remove_models");
