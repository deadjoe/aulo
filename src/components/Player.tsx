import { useCallback, useEffect, useRef, useState } from "react";
import {
  Heart,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import CoverArt from "./CoverArt";
import { audioUrl, displayTitle, formatTime, type Song } from "../lib/songs";

export function usePlayer(songs: Song[]) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolumeState] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const playable = songs.filter((s) => s.state === "completed" && s.audioPath);
  const current = songs.find((s) => s.id === currentId) ?? null;

  if (!audio.current && typeof Audio !== "undefined")
    audio.current = new Audio();

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const update = () => setTime(el.currentTime);
    const meta = () => setLength(el.duration);
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const failed = () => {
      setPlaying(false);
      setError("This song could not be played.");
    };
    el.addEventListener("timeupdate", update);
    el.addEventListener("loadedmetadata", meta);
    el.addEventListener("play", play);
    el.addEventListener("pause", pause);
    el.addEventListener("error", failed);
    return () => {
      el.removeEventListener("timeupdate", update);
      el.removeEventListener("loadedmetadata", meta);
      el.removeEventListener("play", play);
      el.removeEventListener("pause", pause);
      el.removeEventListener("error", failed);
      el.pause();
    };
  }, []);

  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
  }, [volume, muted]);

  // A song deleted while loaded is unloaded instead of playing on.
  useEffect(() => {
    if (currentId && !current && audio.current) {
      audio.current.pause();
      audio.current.removeAttribute("src");
      setCurrentId(null);
    }
  }, [current, currentId]);

  const start = useCallback((song: Song) => {
    const el = audio.current;
    const url = audioUrl(song);
    if (!el || !url) return;
    setError("");
    setCurrentId(song.id);
    setTime(0);
    setLength(song.duration ?? 0);
    el.src = url;
    void el.play().catch(() => setError("This song could not be played."));
  }, []);

  const toggle = useCallback(
    (song?: Song) => {
      const el = audio.current;
      if (!el) return;
      if (song && song.id !== currentId) return start(song);
      if (!currentId) {
        if (playable[0]) start(playable[0]);
        return;
      }
      if (el.paused)
        void el.play().catch(() => setError("This song could not be played."));
      else el.pause();
    },
    [currentId, playable, start],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!playable.length) return;
      const index = playable.findIndex((s) => s.id === currentId);
      const next =
        playable[(index + direction + playable.length) % playable.length];
      if (next) start(next);
    },
    [currentId, playable, start],
  );

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const ended = () => {
      const index = playable.findIndex((s) => s.id === currentId);
      if (index >= 0 && index < playable.length - 1) start(playable[index + 1]);
    };
    el.addEventListener("ended", ended);
    return () => el.removeEventListener("ended", ended);
  }, [currentId, playable, start]);

  const seek = (seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds;
    setTime(seconds);
  };

  return {
    current,
    playing,
    time,
    length,
    volume,
    muted,
    error,
    toggle,
    step,
    seek,
    setVolume: setVolumeState,
    setMuted,
    hasSongs: playable.length > 0,
  };
}

export default function Player({
  player,
  onFavorite,
}: {
  player: ReturnType<typeof usePlayer>;
  onFavorite: (song: Song) => void;
}) {
  const { current } = player;
  const title = current ? displayTitle(current.request) : "Nothing playing";
  const total = player.length || current?.duration || 0;
  return (
    <footer className="player" aria-label="Player">
      <div className="player-track">
        {current ? (
          <CoverArt id={current.id} style={current.request.style} size="sm" />
        ) : (
          <span className="cover cover-sm cover-empty" aria-hidden="true" />
        )}
        <span>
          <strong>{title}</strong>
          <small>
            {player.error ||
              (current
                ? current.request.style
                : player.hasSongs
                  ? "Pick a song to listen"
                  : "Your songs play here")}
          </small>
        </span>
        {current && (
          <button
            className={`round-button${current.favorite ? " loved" : ""}`}
            aria-label={current.favorite ? `Unlike ${title}` : `Like ${title}`}
            aria-pressed={current.favorite}
            onClick={() => onFavorite(current)}
          >
            <Heart
              size={16}
              fill={current.favorite ? "currentColor" : "none"}
            />
          </button>
        )}
      </div>
      <div className="player-center">
        <div className="transport">
          <button
            className="round-button"
            aria-label="Previous song"
            disabled={!player.hasSongs}
            onClick={() => player.step(-1)}
          >
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button
            className="play-button"
            aria-label={player.playing ? "Pause" : "Play"}
            disabled={!player.hasSongs}
            onClick={() => player.toggle()}
          >
            {player.playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            className="round-button"
            aria-label="Next song"
            disabled={!player.hasSongs}
            onClick={() => player.step(1)}
          >
            <SkipForward size={17} fill="currentColor" />
          </button>
        </div>
        <div className="scrubber">
          <span>{formatTime(current ? player.time : null)}</span>
          <input
            type="range"
            aria-label="Song position"
            min={0}
            max={Math.max(total, 1)}
            step={0.1}
            value={Math.min(player.time, total || 0)}
            disabled={!current}
            style={
              {
                "--fill": `${total ? (player.time / total) * 100 : 0}%`,
              } as React.CSSProperties
            }
            onChange={(e) => player.seek(Number(e.target.value))}
          />
          <span>{formatTime(current ? total : null)}</span>
        </div>
      </div>
      <div className="player-volume">
        <button
          className="round-button"
          aria-label={player.muted ? "Unmute" : "Mute"}
          onClick={() => player.setMuted(!player.muted)}
        >
          {player.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={player.muted ? 0 : player.volume}
          style={
            {
              "--fill": `${(player.muted ? 0 : player.volume) * 100}%`,
            } as React.CSSProperties
          }
          onChange={(e) => {
            player.setMuted(false);
            player.setVolume(Number(e.target.value));
          }}
        />
      </div>
    </footer>
  );
}
