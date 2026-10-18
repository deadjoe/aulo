import { useEffect, useRef, useState } from "react";
import {
  Heart,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Square,
} from "lucide-react";
import CoverArt from "./CoverArt";
import {
  displayTitle,
  formatTime,
  isActive,
  statusLabel,
  type Song,
} from "../lib/songs";

function dayLabel(ms: number, now = new Date()): string {
  const date = new Date(ms);
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return since ? <>{formatTime((now - since) / 1000)}</> : null;
}

function SongMenu({
  song,
  onReuse,
  onRename,
  onDelete,
}: {
  song: Song;
  onReuse: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const title = displayTitle(song.request);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className="round-button"
        aria-label={`More for ${title}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={run(onReuse)}>
            Reuse these settings
          </button>
          <button role="menuitem" onClick={run(onRename)}>
            Rename
          </button>
          {!isActive(song) && (
            <button role="menuitem" className="danger" onClick={run(onDelete)}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SongList({
  songs,
  heading,
  current,
  playing,
  onPlay,
  onFavorite,
  onCancel,
  onReuse,
  onRename,
  onDelete,
  emptyAction,
}: {
  songs: Song[];
  heading: string;
  current: string | null;
  playing: boolean;
  onPlay: (song: Song) => void;
  onFavorite: (song: Song) => void;
  onCancel: (song: Song) => void;
  onReuse: (song: Song) => void;
  onRename: (song: Song, title: string) => void;
  onDelete: (song: Song) => void;
  emptyAction?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const visible = songs.filter(
    (s) =>
      (!favorites || s.favorite) &&
      `${displayTitle(s.request)} ${s.request.style} ${s.request.lyrics}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const groups: [string, Song[]][] = [];
  for (const song of visible) {
    const label = dayLabel(song.createdMs);
    const group = groups.at(-1);
    if (group?.[0] === label) group[1].push(song);
    else groups.push([label, [song]]);
  }
  return (
    <main className="library" aria-label={heading}>
      <header className="library-bar">
        <h1>{heading}</h1>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search your songs"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={`filter-chip${favorites ? " selected" : ""}`}
          aria-pressed={favorites}
          onClick={() => setFavorites(!favorites)}
        >
          <Heart size={14} fill={favorites ? "currentColor" : "none"} />
          Liked
        </button>
      </header>
      {songs.length === 0 ? (
        <div className="empty-library">
          <CoverArt id="aulo-empty-state" style="dreamy" size="lg" />
          <h2>Your songs will live here</h2>
          <p>Describe a sound, add your words, and press Create.</p>
          {emptyAction}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-library small">
          <h2>{query ? "No songs match that search" : "No liked songs yet"}</h2>
          <p>
            {query
              ? "Try a different title, word, or style."
              : "Tap the heart on a song to keep it here."}
          </p>
          <button
            className="secondary"
            onClick={() => {
              setQuery("");
              setFavorites(false);
            }}
          >
            Show all songs
          </button>
        </div>
      ) : (
        <div className="song-scroll">
          {groups.map(([label, items]) => (
            <section key={label} className="song-group">
              <h2>{label}</h2>
              {items.map((song) => {
                const title = displayTitle(song.request);
                const active = isActive(song);
                const playable = song.state === "completed" && !!song.audioPath;
                const isCurrent = current === song.id;
                return (
                  <article
                    key={song.id}
                    className={`song-row${isCurrent ? " current" : ""}${active ? " active" : ""}`}
                  >
                    <button
                      className="song-cover"
                      disabled={!playable}
                      aria-label={
                        playable
                          ? isCurrent && playing
                            ? `Pause ${title}`
                            : `Play ${title}`
                          : title
                      }
                      onClick={() => onPlay(song)}
                    >
                      <CoverArt
                        id={song.id}
                        style={song.request.style}
                        active={active}
                      />
                      {playable && (
                        <span className="cover-play">
                          {isCurrent && playing ? (
                            <Pause size={20} fill="currentColor" />
                          ) : (
                            <Play size={20} fill="currentColor" />
                          )}
                        </span>
                      )}
                      {song.duration != null && (
                        <span className="duration">
                          {formatTime(song.duration)}
                        </span>
                      )}
                    </button>
                    <div className="song-text">
                      {renaming === song.id ? (
                        <input
                          className="rename"
                          aria-label="New song title"
                          defaultValue={title}
                          maxLength={120}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          onBlur={(e) => {
                            if (renaming !== song.id) return;
                            setRenaming(null);
                            const next = e.currentTarget.value.trim();
                            if (next && next !== title) onRename(song, next);
                          }}
                        />
                      ) : (
                        <strong>{title}</strong>
                      )}
                      <p>{song.request.style}</p>
                      {song.state !== "completed" && (
                        <span className={`song-status state-${song.state}`}>
                          {statusLabel(song)}
                          {song.state === "running" && (
                            <>
                              {" · "}
                              <Elapsed since={song.startedMs} />
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="song-actions">
                      {active ? (
                        <button
                          className="pill-button"
                          onClick={() => onCancel(song)}
                        >
                          <Square size={12} fill="currentColor" />
                          Stop
                        </button>
                      ) : (
                        <button
                          className={`round-button${song.favorite ? " loved" : ""}`}
                          aria-label={
                            song.favorite ? `Unlike ${title}` : `Like ${title}`
                          }
                          aria-pressed={song.favorite}
                          onClick={() => onFavorite(song)}
                        >
                          <Heart
                            size={17}
                            fill={song.favorite ? "currentColor" : "none"}
                          />
                        </button>
                      )}
                      <SongMenu
                        song={song}
                        onReuse={() => onReuse(song)}
                        onRename={() => setRenaming(song.id)}
                        onDelete={() => onDelete(song)}
                      />
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
