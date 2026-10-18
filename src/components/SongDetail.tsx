import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Heart,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { SongCover } from "./SongList";
import SongMenu, { type SongActions } from "./SongMenu";
import {
  displayTitle,
  formatTime,
  isActive,
  statusLabel,
  type Song,
} from "../lib/songs";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="round-button"
      aria-label={copied ? "Copied" : label}
      title={label}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

export default function SongDetail({
  song,
  playing,
  current,
  renaming,
  onRenamed,
  onBack,
  onPlay,
  onFavorite,
  actions,
}: {
  song: Song;
  playing: boolean;
  current: boolean;
  renaming: boolean;
  onRenamed: (song: Song, title: string | null) => void;
  onBack: () => void;
  onPlay: (song: Song) => void;
  onFavorite: (song: Song) => void;
  actions: SongActions;
}) {
  const title = displayTitle(song.request);
  const finished = song.state === "completed" && !!song.audioPath;
  const created = new Date(song.createdMs).toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
  const lyrics = song.request.instrumental ? "" : song.request.lyrics.trim();
  return (
    <main className="song-detail" aria-label={title}>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back
      </button>
      <div className="detail-hero">
        <SongCover
          song={song}
          playing={playing}
          current={current}
          onPlay={onPlay}
          size="lg"
        />
        <div className="detail-info">
          {renaming ? (
            <input
              className="rename detail-rename"
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
                onRenamed(song, next && next !== title ? next : null);
              }}
            />
          ) : (
            <h1>{title}</h1>
          )}
          <div className="detail-style">
            <p>{song.request.style}</p>
            <CopyButton text={song.request.style} label="Copy styles" />
          </div>
          <p className="detail-meta">
            {created}
            {song.duration != null && <> · {formatTime(song.duration)}</>}
            {song.request.instrumental && <> · Instrumental</>}
          </p>
          {!finished && (
            <p className={`song-status state-${song.state}`}>
              {statusLabel(song)}
            </p>
          )}
          <div className="detail-actions">
            <button
              className="play-pill"
              disabled={!finished}
              onClick={() => onPlay(song)}
            >
              {current && playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {current && playing ? "Pause" : "Play"}
            </button>
            {!isActive(song) && (
              <button
                className={`round-button large${song.favorite ? " loved" : ""}`}
                aria-label={song.favorite ? `Unlike ${title}` : `Like ${title}`}
                aria-pressed={song.favorite}
                onClick={() => onFavorite(song)}
              >
                <Heart
                  size={18}
                  fill={song.favorite ? "currentColor" : "none"}
                />
              </button>
            )}
            <button
              className="round-button large"
              aria-label="Create another version"
              title="Create another version"
              onClick={() => actions.onAnotherVersion(song)}
            >
              <RotateCcw size={18} />
            </button>
            {finished && (
              <button
                className="round-button large"
                aria-label="Download"
                title="Download"
                onClick={() => actions.onDownload(song)}
              >
                <Download size={18} />
              </button>
            )}
            <SongMenu song={song} targets={[song]} actions={actions} large />
          </div>
        </div>
      </div>
      <section className="detail-lyrics">
        <header>
          <h2>Lyrics</h2>
          {lyrics && <CopyButton text={lyrics} label="Copy lyrics" />}
        </header>
        {lyrics ? (
          <div className="lyrics">
            {lyrics.split("\n").map((line, i) => {
              const section = /^\s*\[(.+)\]\s*$/.exec(line)?.[1];
              return section ? (
                <span key={i} className="lyrics-section">
                  {section}
                </span>
              ) : (
                <span key={i} className={line.trim() ? "" : "lyrics-gap"}>
                  {line}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="lyrics-empty">This song is an instrumental.</p>
        )}
      </section>
    </main>
  );
}
