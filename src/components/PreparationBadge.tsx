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
      let busy = false;
      try {
        const next = await getModelStatus();
        busy = modelOperationActive(next);
        if (!stopped) {
          setStatus(next);
          setUnavailable(false);
        }
      } catch {
        if (!stopped) setUnavailable(true);
      }
      // Quick updates during a download; a slow check otherwise.
      if (!stopped) timer = setTimeout(() => void poll(), busy ? 1500 : 10000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  // Only visible while something about the music models needs the person.
  if (status?.modelsVerified && !modelOperationActive(status)) return null;
  let text = "Set up the music models";
  if (unavailable) text = "Check the music models";
  else if (modelOperationActive(status))
    text = `Downloading music models · ${Math.min(100, Math.floor((status!.completedBytes / Math.max(status!.totalBytes, 1)) * 100))}%`;
  else if (status?.phase === "paused") text = "Music models paused";
  else if (status?.phase === "failed") text = "Music models need attention";
  else if (status?.phase === "unverified") text = "Check the music models";
  return (
    <button className="setup-badge" onClick={onOpen}>
      <span />
      {text}
    </button>
  );
}
