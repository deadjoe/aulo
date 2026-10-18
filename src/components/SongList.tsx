import { useState } from "react";
import { Heart, Pause, Play, RotateCcw, Search, Square } from "lucide-react";
import CoverArt from "./CoverArt";
import SongMenu, { type SongActions } from "./SongMenu";
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

export function SongCover({
  song,
  playing,
  current,
  onPlay,
  size = "md",
}: {
  song: Song;
  playing: boolean;
  current: boolean;
  onPlay: (song: Song) => void;
  size?: "md" | "lg";
}) {
  const title = displayTitle(song.request);
  const active = isActive(song);
  const playable = song.state === "completed" && !!song.audioPath;
  return (
    <button
      className={`song-cover cover-button-${size}`}
      disabled={!playable}
      aria-label={
        playable
          ? current && playing
            ? `Pause ${title}`
            : `Play ${title}`
          : title
      }
      onClick={() => onPlay(song)}
    >
      <CoverArt id={song.id} style={song.request.style} size={size} />
      {playable && (
        <span className="cover-play">
          {current && playing ? (
            <Pause size={size === "lg" ? 34 : 20} fill="currentColor" />
          ) : (
            <Play size={size === "lg" ? 34 : 20} fill="currentColor" />
          )}
        </span>
      )}
      {active && (
        <span
          className={`cover-spinner${song.state === "queued" ? " waiting" : ""}`}
          role="img"
          aria-label={statusLabel(song)}
        />
      )}
      {song.duration != null && size === "md" && (
        <span className="duration">{formatTime(song.duration)}</span>
      )}
    </button>
  );
}

export default function SongList({
  songs,
  heading,
  current,
  playing,
  renaming,
  onRenamed,
  onPlay,
  onOpen,
  onFavorite,
  onCancel,
  onRetry,
  actions,
  emptyAction,
}: {
  songs: Song[];
  heading: string;
  current: string | null;
  playing: boolean;
  renaming: string | null;
  onRenamed: (song: Song, title: string | null) => void;
  onPlay: (song: Song) => void;
  onOpen: (song: Song) => void;
  onFavorite: (song: Song) => void;
  onCancel: (song: Song) => void;
  onRetry: (song: Song) => void;
  actions: SongActions;
  emptyAction?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(false);
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
                const unfinished =
                  song.state === "failed" || song.state === "interrupted";
                return (
                  <article
                    key={song.id}
                    className={`song-row${current === song.id ? " current" : ""}`}
                  >
                    <SongCover
                      song={song}
                      playing={playing}
                      current={current === song.id}
                      onPlay={onPlay}
                    />
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
                            if (e.key === "Escape") onRenamed(song, null);
                          }}
                          onBlur={(e) => {
                            const next = e.currentTarget.value.trim();
                            onRenamed(
                              song,
                              next && next !== title ? next : null,
                            );
                          }}
                        />
                      ) : (
                        <button
                          className="song-title"
                          onClick={() => onOpen(song)}
                        >
                          {title}
                        </button>
                      )}
                      <p>{song.request.style}</p>
                      {song.state !== "completed" && (
                        <span className={`song-status state-${song.state}`}>
                          {statusLabel(song)}
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
                      ) : unfinished ? (
                        <button
                          className="pill-button"
                          onClick={() => onRetry(song)}
                        >
                          <RotateCcw size={14} />
                          Try again
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
                      <SongMenu song={song} actions={actions} />
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
