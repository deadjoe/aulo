// The UI depends on this boundary, not on Gradio routes or engine internals.
// Implement with a versioned local service backed by YUE2 // GROOVE.
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
