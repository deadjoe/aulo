import { useEffect, useState } from "react";
import {
  desktopModelsAvailable,
  getModelStatus,
  modelOperationActive,
  type ModelStatus,
} from "../lib/models";
export default function PreparationBadge({ onOpen }: { onOpen: () => void }) {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!desktopModelsAvailable()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getModelStatus();
        if (!stopped) {
          setStatus(next);
          setUnavailable(false);
        }
      } catch {
        if (!stopped) setUnavailable(true);
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  let text = "Music models not set up";
  if (unavailable) text = "Preparation status unavailable";
  else if (modelOperationActive(status))
    text = `Preparing models · ${Math.min(100, Math.floor((status!.completedBytes / Math.max(status!.totalBytes, 1)) * 100))}%`;
  else if (status?.phase === "paused") text = "Model preparation paused";
  else if (status?.phase === "failed")
    text = "Model preparation needs attention";
  else if (status?.modelsVerified) text = "Music models ready";
  else if (status?.phase === "unverified") text = "Saved models need a check";
  return (
    <button
      className={`setup-badge${status?.modelsVerified ? " ready" : ""}`}
      onClick={onOpen}
    >
      <span />
      {text}
    </button>
  );
}
