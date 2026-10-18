import { useEffect, useState } from "react";
import { songWaveform } from "../lib/songs";

// Peaks never change for a finished song, so they are fetched once per session.
const cache = new Map<string, Promise<number[]>>();
function peaksFor(id: string) {
  let pending = cache.get(id);
  if (!pending) {
    pending = songWaveform(id).catch(() => {
      cache.delete(id);
      return [];
    });
    cache.set(id, pending);
  }
  return pending;
}

/** A finished song's real waveform; click anywhere to play from there. */
export default function Waveform({
  id,
  progress,
  onSeek,
}: {
  id: string;
  progress: number | null;
  onSeek: (fraction: number) => void;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let active = true;
    void peaksFor(id).then((p) => active && setPeaks(p));
    return () => {
      active = false;
    };
  }, [id]);
  if (!peaks?.length)
    return <div className="waveform waveform-empty" aria-hidden="true" />;
  return (
    <button
      className="waveform"
      aria-label="Play from this point"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
      }}
    >
      {peaks.map((peak, i) => (
        <span
          key={i}
          className={
            progress != null && i / peaks.length < progress ? "played" : ""
          }
          style={{ height: `${Math.max(8, peak * 100)}%` }}
        />
      ))}
    </button>
  );
}
