import { useEffect, useRef, useState } from "react";
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
  // Only songs scrolled into view are read, so a large library stays light.
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (visible || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void peaksFor(id).then((p) => active && setPeaks(p));
    return () => {
      active = false;
    };
  }, [id, visible]);
  if (!peaks?.length)
    return (
      <div
        ref={(node) => {
          ref.current = node;
        }}
        className="waveform waveform-empty"
        aria-hidden="true"
      />
    );
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
