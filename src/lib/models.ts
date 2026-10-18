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
  | "failed";
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

export const openModelLicense = () => invoke<void>("open_model_license");
