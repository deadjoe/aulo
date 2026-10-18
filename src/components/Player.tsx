import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import SongMenu, { type SongActions } from "./SongMenu";
import CoverArt from "./CoverArt";
import { audioUrl, displayTitle, formatTime, type Song } from "../lib/songs";

const songLength = (length: number, song: Song) => length || song.duration || 0;

export function usePlayer(songs: Song[]) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolumeState] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  // Songs the listener asked to hear next, before the library order resumes.
  const [queue, setQueue] = useState<string[]>([]);
  const playable = useMemo(
    () => songs.filter((s) => s.state === "completed" && s.audioPath),
    [songs],
  );
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

  const start = useCallback((song: Song, at = 0) => {
    const el = audio.current;
    const url = audioUrl(song);
    if (!el || !url) return;
    setError("");
    setCurrentId(song.id);
    setTime(0);
    setLength(song.duration ?? 0);
    el.src = url;
    if (at > 0)
      el.addEventListener(
        "loadedmetadata",
        () => {
          el.currentTime = at * el.duration;
        },
        { once: true },
      );
    void el.play().catch(() => setError("This song could not be played."));
  }, []);

  /** Play `song` from a point (0..1), starting it first if needed. */
  const seekTo = useCallback(
    (song: Song, fraction: number) => {
      const el = audio.current;
      if (!el) return;
      if (song.id !== currentId) return start(song, fraction);
      if (Number.isFinite(el.duration)) el.currentTime = fraction * el.duration;
      if (el.paused)
        void el.play().catch(() => setError("This song could not be played."));
    },
    [currentId, start],
  );

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

  // Queued songs first, then the library order after the current song.
  const queuedSongs = useMemo(
    () =>
      queue
        .map((id) => playable.find((s) => s.id === id))
        .filter((s): s is Song => s !== undefined),
    [queue, playable],
  );
  const following = useMemo(() => {
    const index = playable.findIndex((s) => s.id === currentId);
    return playable.slice(index + 1).filter((s) => !queue.includes(s.id));
  }, [playable, currentId, queue]);

  /** Play a song from the queue (or library), taking it out of the queue. */
  const playNext = useCallback(
    (song: Song) => {
      setQueue((q) => q.filter((id) => id !== song.id));
      start(song);
    },
    [start],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!playable.length) return;
      if (direction === 1 && queuedSongs.length)
        return playNext(queuedSongs[0]);
      const index = playable.findIndex((s) => s.id === currentId);
      const next =
        playable[(index + direction + playable.length) % playable.length];
      if (next) start(next);
    },
    [currentId, playable, queuedSongs, playNext, start],
  );

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const ended = () => {
      const next = queuedSongs[0] ?? following[0];
      if (next) playNext(next);
    };
    el.addEventListener("ended", ended);
    return () => el.removeEventListener("ended", ended);
  }, [queuedSongs, following, playNext]);

  /** Play these songs now, in order, replacing what was queued. */
  const playAll = useCallback(
    (songs: Song[]) => {
      if (!songs.length) return;
      start(songs[0]);
      setQueue(songs.slice(1).map((s) => s.id));
    },
    [start],
  );

  /** Songs play after the current one, in the order given. */
  const enqueue = useCallback(
    (songs: Song[]) => {
      if (!songs.length) return;
      if (!currentId) {
        start(songs[0]);
        setQueue((q) => [...q, ...songs.slice(1).map((s) => s.id)]);
        return;
      }
      setQueue((q) => [...q, ...songs.map((s) => s.id)]);
    },
    [currentId, start],
  );

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
    enqueue,
    playAll,
    playNext,
    queuedSongs,
    following,
    clearQueue: () => setQueue([]),
    unqueue: (id: string) => setQueue((q) => q.filter((x) => x !== id)),
    step,
    seek,
    seekTo,
    progress:
      current && songLength(length, current)
        ? time / songLength(length, current)
        : null,
    setVolume: setVolumeState,
    setMuted,
    hasSongs: playable.length > 0,
  };
}

function VolumeControl({
  volume,
  muted,
  onVolume,
  onMute,
}: {
  volume: number;
  muted: boolean;
  onVolume: (value: number) => void;
  onMute: (muted: boolean) => void;
}) {
  const level = muted ? 0 : volume;
  const set = (value: number) => {
    onMute(false);
    onVolume(Math.min(1, Math.max(0, value)));
  };
  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    set(1 - (e.clientY - box.top) / box.height);
  };
  return (
    <div className="volume">
      <div className="volume-pop">
        <div
          className="volume-track"
          role="slider"
          tabIndex={0}
          aria-label="Volume"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowRight")
              set(level + 0.05);
            if (e.key === "ArrowDown" || e.key === "ArrowLeft")
              set(level - 0.05);
          }}
        >
          <span style={{ height: `${level * 100}%` }} />
        </div>
      </div>
      <button
        className="round-button"
        aria-label={muted ? "Unmute" : "Mute"}
        data-tip={muted ? "Unmute" : "Mute"}
        onClick={() => onMute(!muted)}
      >
        {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
    </div>
  );
}

function QueueRow({
  song,
  onPlay,
  onRemove,
}: {
  song: Song;
  onPlay?: () => void;
  onRemove?: () => void;
}) {
  const row = (
    <>
      <CoverArt id={song.id} style={song.request.style} size="sm" />
      <span className="queue-text">
        <strong>{displayTitle(song.request)}</strong>
        <small>{song.request.style}</small>
      </span>
    </>
  );
  return (
    <div className="queue-row">
      {onPlay ? (
        <button className="queue-play" onClick={onPlay}>
          {row}
        </button>
      ) : (
        <div className="queue-play">{row}</div>
      )}
      {onRemove && (
        <button
          className="round-button"
          aria-label={`Remove ${displayTitle(song.request)} from the queue`}
          onClick={onRemove}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function QueuePanel({
  player,
  onClose,
}: {
  player: ReturnType<typeof usePlayer>;
  onClose: () => void;
}) {
  const { current, queuedSongs, following } = player;
  return (
    <section className="queue" aria-label="Queue">
      <header>
        <h2>Queue</h2>
        <button
          className="icon-button"
          aria-label="Close queue"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="queue-scroll">
        <h3>Now playing</h3>
        {current ? (
          <QueueRow song={current} />
        ) : (
          <p className="queue-empty">Nothing is playing.</p>
        )}
        <div className="queue-heading">
          <h3>Next up</h3>
          {queuedSongs.length > 0 && (
            <button className="text-button" onClick={player.clearQueue}>
              Clear
            </button>
          )}
        </div>
        {queuedSongs.map((song) => (
          <QueueRow
            key={`q-${song.id}`}
            song={song}
            onPlay={() => player.playNext(song)}
            onRemove={() => player.unqueue(song.id)}
          />
        ))}
        {following.map((song) => (
          <QueueRow
            key={song.id}
            song={song}
            onPlay={() => player.playNext(song)}
          />
        ))}
        {queuedSongs.length + following.length === 0 && (
          <p className="queue-empty">
            Choose “Add to queue” on any song to play it next.
          </p>
        )}
      </div>
    </section>
  );
}

export default function Player({
  player,
  actions,
  onOpen,
}: {
  player: ReturnType<typeof usePlayer>;
  actions: SongActions;
  onOpen: (song: Song) => void;
}) {
  const { current } = player;
  const [queueOpen, setQueueOpen] = useState(false);
  const title = current ? displayTitle(current.request) : "Nothing playing";
  const total = player.length || current?.duration || 0;
  return (
    <footer className="player" aria-label="Player">
      {queueOpen && (
        <QueuePanel player={player} onClose={() => setQueueOpen(false)} />
      )}
      <div className="player-track">
        {current ? (
          <CoverArt id={current.id} style={current.request.style} size="sm" />
        ) : (
          <span className="cover cover-sm cover-empty" aria-hidden="true" />
        )}
        <span>
          {current ? (
            <button className="player-title" onClick={() => onOpen(current)}>
              {title}
            </button>
          ) : (
            <strong>{title}</strong>
          )}
          <small>
            {player.error ||
              (current
                ? current.request.style
                : player.hasSongs
                  ? "Pick a song to listen"
                  : "Your songs play here")}
          </small>
        </span>
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
      <div className="player-tools">
        <button
          className={`round-button${queueOpen ? " toggled" : ""}`}
          aria-label="Queue"
          aria-expanded={queueOpen}
          data-tip="Queue"
          onClick={() => setQueueOpen(!queueOpen)}
        >
          <ListMusic size={18} />
        </button>
        {current ? (
          <SongMenu
            song={current}
            targets={[current]}
            actions={actions}
            vertical
          />
        ) : (
          <button className="round-button" aria-label="More" disabled>
            <MoreVertical size={18} />
          </button>
        )}
        <VolumeControl
          volume={player.volume}
          muted={player.muted}
          onVolume={player.setVolume}
          onMute={player.setMuted}
        />
      </div>
    </footer>
  );
}
