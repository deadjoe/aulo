import { ArchiveRestore, Trash2 } from "lucide-react";
import CoverArt from "./CoverArt";
import { displayTitle, formatTime, type Song } from "../lib/songs";
import { ago } from "../lib/view";

/** Songs in Aulo's Trash: restore them, or delete them for good. */
export default function TrashView({
  songs,
  onRestore,
  onDelete,
}: {
  songs: Song[];
  onRestore: (songs: Song[]) => void;
  onDelete: (songs: Song[]) => void;
}) {
  const ordered = [...songs].sort(
    (a, b) => (b.trashedMs ?? 0) - (a.trashedMs ?? 0),
  );
  return (
    <div className="trash">
      <div className="library-toolbar">
        <p className="trash-note">
          Songs here can be restored. Deleting them removes them from Aulo.
        </p>
        {songs.length > 0 && (
          <>
            <button className="tool-pill" onClick={() => onRestore(ordered)}>
              <ArchiveRestore size={15} /> Restore all
            </button>
            <button
              className="tool-pill danger"
              onClick={() => onDelete(ordered)}
            >
              <Trash2 size={15} /> Empty Trash
            </button>
          </>
        )}
      </div>
      {songs.length === 0 ? (
        <div className="empty-library small">
          <h2>The Trash is empty</h2>
          <p>Songs you move to the Trash wait here until you delete them.</p>
        </div>
      ) : (
        <div className="song-scroll">
          {ordered.map((song) => (
            <article key={song.id} className="song-row trash-row">
              <span />
              <span className="song-cover">
                <CoverArt id={song.id} style={song.request.style} />
                {song.duration != null && (
                  <span className="duration">{formatTime(song.duration)}</span>
                )}
              </span>
              <div className="song-text">
                <strong className="song-title">
                  {displayTitle(song.request)}
                </strong>
                <p>
                  Moved to the Trash {song.trashedMs ? ago(song.trashedMs) : ""}
                </p>
              </div>
              <div className="song-actions">
                <button
                  className="pill-button"
                  onClick={() => onRestore([song])}
                >
                  <ArchiveRestore size={14} /> Restore
                </button>
                <button
                  className="round-button"
                  aria-label={`Delete ${displayTitle(song.request)}`}
                  title="Delete"
                  onClick={() => onDelete([song])}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
