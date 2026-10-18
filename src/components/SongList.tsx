import { Check, Heart, Pause, Play, RotateCcw, Square } from "lucide-react";
import CoverArt from "./CoverArt";
import SongMenu, { type SongActions } from "./SongMenu";
import Waveform from "./Waveform";
import {
  displayTitle,
  formatTime,
  isActive,
  statusLabel,
  type Song,
} from "../lib/songs";
import type { Layout } from "../lib/view";

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

export interface SongListProps {
  groups: [string, Song[]][];
  layout: Layout;
  current: string | null;
  playing: boolean;
  /** How far the current song has played, 0..1. */
  progress: number | null;
  selected: Set<string>;
  renaming: string | null;
  onToggleSelect: (song: Song, range: boolean) => void;
  onRenamed: (song: Song, title: string | null) => void;
  onPlay: (song: Song) => void;
  onSeek: (song: Song, fraction: number) => void;
  onOpen: (song: Song) => void;
  onFavorite: (song: Song) => void;
  onCancel: (song: Song) => void;
  onRetry: (song: Song) => void;
  actions: SongActions;
  targetsFor: (song: Song) => Song[];
}

function SelectBox({
  song,
  selected,
  onToggle,
}: {
  song: Song;
  selected: boolean;
  onToggle: (song: Song, range: boolean) => void;
}) {
  return (
    <button
      className={`select-box${selected ? " checked" : ""}`}
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select ${displayTitle(song.request)}`}
      onClick={(e) => onToggle(song, e.shiftKey)}
    >
      {selected && <Check size={13} strokeWidth={3} />}
    </button>
  );
}

export default function SongList(props: SongListProps) {
  const {
    groups,
    layout,
    current,
    playing,
    progress,
    selected,
    renaming,
    onToggleSelect,
    onRenamed,
    onPlay,
    onSeek,
    onOpen,
    onFavorite,
    onCancel,
    onRetry,
    actions,
    targetsFor,
  } = props;
  const selecting = selected.size > 0;

  const title = (song: Song) =>
    renaming === song.id ? (
      <input
        className="rename"
        aria-label="New song title"
        defaultValue={displayTitle(song.request)}
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
            next && next !== displayTitle(song.request) ? next : null,
          );
        }}
      />
    ) : (
      <button className="song-title" onClick={() => onOpen(song)}>
        {displayTitle(song.request)}
      </button>
    );

  const trailing = (song: Song) => {
    const name = displayTitle(song.request);
    const unfinished = song.state === "failed" || song.state === "interrupted";
    return (
      <div className="song-actions">
        {isActive(song) ? (
          <button className="pill-button" onClick={() => onCancel(song)}>
            <Square size={12} fill="currentColor" />
            Stop
          </button>
        ) : unfinished ? (
          <button className="pill-button" onClick={() => onRetry(song)}>
            <RotateCcw size={14} />
            Try again
          </button>
        ) : (
          <button
            className={`round-button${song.favorite ? " loved" : ""}`}
            aria-label={song.favorite ? `Unlike ${name}` : `Like ${name}`}
            aria-pressed={song.favorite}
            onClick={() => onFavorite(song)}
          >
            <Heart size={17} fill={song.favorite ? "currentColor" : "none"} />
          </button>
        )}
        <SongMenu song={song} targets={targetsFor(song)} actions={actions} />
      </div>
    );
  };

  if (layout === "grid")
    return (
      <div className="song-scroll">
        {groups.map(([label, songs]) => (
          <section key={label || "all"} className="song-group">
            {label && <h2>{label}</h2>}
            <div className="song-grid">
              {songs.map((song) => (
                <article
                  key={song.id}
                  className={`song-card${current === song.id ? " current" : ""}${selected.has(song.id) ? " selected" : ""}`}
                >
                  <div className="card-cover">
                    <SongCover
                      song={song}
                      playing={playing}
                      current={current === song.id}
                      onPlay={onPlay}
                    />
                    <SelectBox
                      song={song}
                      selected={selected.has(song.id)}
                      onToggle={onToggleSelect}
                    />
                  </div>
                  <div className="card-text">
                    {title(song)}
                    <p>
                      {song.state === "completed"
                        ? song.request.style
                        : statusLabel(song)}
                    </p>
                  </div>
                  {trailing(song)}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    );

  return (
    <div className={`song-scroll${selecting ? " selecting" : ""}`}>
      {groups.map(([label, songs]) => (
        <section key={label || "all"} className="song-group">
          {label && <h2>{label}</h2>}
          {songs.map((song) => {
            const isCurrent = current === song.id;
            const playable = song.state === "completed" && !!song.audioPath;
            return (
              <article
                key={song.id}
                className={`song-row${isCurrent ? " current" : ""}${selected.has(song.id) ? " selected" : ""}`}
              >
                <SelectBox
                  song={song}
                  selected={selected.has(song.id)}
                  onToggle={onToggleSelect}
                />
                <SongCover
                  song={song}
                  playing={playing}
                  current={isCurrent}
                  onPlay={onPlay}
                />
                <div className="song-text">
                  {title(song)}
                  {layout === "waveform" && playable ? (
                    <Waveform
                      id={song.id}
                      progress={isCurrent ? progress : null}
                      onSeek={(fraction) => onSeek(song, fraction)}
                    />
                  ) : (
                    <p>{song.request.style}</p>
                  )}
                  {song.state !== "completed" && (
                    <span className={`song-status state-${song.state}`}>
                      {statusLabel(song)}
                    </span>
                  )}
                </div>
                {trailing(song)}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
