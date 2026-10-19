import { useEffect, useState } from "react";
import { creatingText, type Song } from "../lib/songs";

/** A song's status words; while it is being made, a clock that moves every second. */
export default function SongStatus({ song }: { song: Song }) {
  const running = song.state === "running" && song.startedMs != null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return <>{creatingText(song, now)}</>;
}
