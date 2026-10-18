import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CornerDownRight, ListPlus, ListVideo, Trash2, X } from "lucide-react";
import CoverArt from "./CoverArt";
import LibraryToolbar from "./LibraryToolbar";
import SongList, { type SongListProps } from "./SongList";
import { SHORTCUTS, type SongActions } from "./SongMenu";
import { isActive, type Song } from "../lib/songs";
import {
  applyView,
  DEFAULT_VIEW,
  groupSongs,
  isFiltered,
  type ViewOptions,
} from "../lib/view";

function loadView(key: string): ViewOptions {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`aulo.view.${key}`) ?? "null",
    );
    // The search text is per visit; sort, layout and filters are remembered.
    if (saved && typeof saved === "object")
      return {
        ...DEFAULT_VIEW,
        sort: saved.sort ?? DEFAULT_VIEW.sort,
        layout: saved.layout ?? DEFAULT_VIEW.layout,
        filters: { ...DEFAULT_VIEW.filters, ...saved.filters },
      };
  } catch {
    /* fall back to the defaults */
  }
  return DEFAULT_VIEW;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName));

/** A searchable, filterable list of songs with multi-select and batch actions. */
export default function LibraryPanel({
  songs,
  header,
  viewKey,
  emptyTitle,
  emptyText,
  emptyAction,
  actions,
  list,
  ordered = false,
}: {
  songs: Song[];
  header: ReactNode;
  viewKey: string;
  emptyTitle: string;
  emptyText: string;
  emptyAction?: ReactNode;
  actions: SongActions;
  /** Keep the given order (for History) instead of sorting. */
  ordered?: boolean;
  list: Omit<
    SongListProps,
    | "groups"
    | "layout"
    | "selected"
    | "onToggleSelect"
    | "actions"
    | "targetsFor"
  >;
}) {
  const [view, setView] = useState<ViewOptions>(() => loadView(viewKey));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => {
    setView(loadView(viewKey));
    setSelected(new Set());
  }, [viewKey]);
  useEffect(() => {
    try {
      localStorage.setItem(`aulo.view.${viewKey}`, JSON.stringify(view));
    } catch {
      /* remembering the view is a convenience */
    }
  }, [view, viewKey]);

  const shown = useMemo(() => applyView(songs, view), [songs, view]);
  const groups = useMemo(
    () => groupSongs(shown, view.sort),
    [shown, view.sort],
  );
  // Songs that disappear (trashed, moved away, filtered out) leave the selection.
  const chosen = shown.filter((s) => selected.has(s.id));
  const chosenIds = new Set(chosen.map((s) => s.id));
  const clear = () => setSelected(new Set());

  function toggle(song: Song, range: boolean) {
    const ids = shown.map((s) => s.id);
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => ids.includes(id)));
      if (range && anchor && ids.includes(anchor)) {
        const [a, b] = [ids.indexOf(anchor), ids.indexOf(song.id)].sort(
          (x, y) => x - y,
        );
        ids.slice(a, b + 1).forEach((id) => next.add(id));
      } else if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
    setAnchor(song.id);
  }

  const finished = chosen.filter((s) => s.state === "completed" && s.audioPath);
  const removable = chosen.filter((s) => !isActive(s));
  const batch = {
    playlist: () => finished.length && actions.onPlaylist(finished),
    queue: () => finished.length && actions.onQueue(finished),
    move: () => chosen.length && actions.onMove(chosen),
    trash: () => {
      if (removable.length) {
        actions.onTrash(removable);
        clear();
      }
    },
  };

  useEffect(() => {
    if (!chosen.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || !(e.metaKey || e.ctrlKey)) {
        if (e.key === "Escape" && !typing(e.target)) clear();
        return;
      }
      const key = e.key.toLowerCase();
      const run =
        key === "p"
          ? batch.playlist
          : key === "u"
            ? batch.queue
            : key === "s"
              ? batch.move
              : key === "backspace" || key === "delete"
                ? batch.trash
                : null;
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="library" aria-label="Songs">
      <header className="library-head">{header}</header>
      {chosen.length > 0 ? (
        <div
          className="selection-bar"
          role="toolbar"
          aria-label="Selected songs"
        >
          <button
            className="icon-button"
            aria-label="Clear selection"
            onClick={clear}
          >
            <X size={17} />
          </button>
          <strong>{chosen.length} selected</strong>
          <span className="selection-actions">
            <button
              className="tool-pill"
              disabled={!finished.length}
              title={SHORTCUTS.playlist}
              onClick={batch.playlist}
            >
              <ListPlus size={15} /> Add to playlist
            </button>
            <button
              className="tool-pill"
              disabled={!finished.length}
              title={SHORTCUTS.queue}
              onClick={batch.queue}
            >
              <ListVideo size={15} /> Add to queue
            </button>
            <button
              className="tool-pill"
              title={SHORTCUTS.move}
              onClick={batch.move}
            >
              <CornerDownRight size={15} /> Move to workspace
            </button>
            <button
              className="tool-pill danger"
              disabled={!removable.length}
              title={SHORTCUTS.trash}
              onClick={batch.trash}
            >
              <Trash2 size={15} /> Move to Trash
            </button>
          </span>
        </div>
      ) : (
        <LibraryToolbar view={view} onChange={setView} sortable={!ordered} />
      )}
      {songs.length === 0 ? (
        <div className="empty-library">
          <CoverArt id="aulo-empty-state" style="dreamy" size="lg" />
          <h2>{emptyTitle}</h2>
          <p>{emptyText}</p>
          {emptyAction}
        </div>
      ) : (
        <>
          {shown.length > 0 && (
            <SongList
              {...list}
              groups={groups}
              layout={view.layout}
              selected={chosenIds}
              onToggleSelect={toggle}
              actions={actions}
              targetsFor={(song) =>
                chosenIds.has(song.id) && chosen.length > 1 ? chosen : [song]
              }
            />
          )}
          <footer className="library-foot">
            <span>
              {shown.length} {shown.length === 1 ? "song" : "songs"}
            </span>
            {isFiltered(view) && (
              <button
                className="secondary small"
                onClick={() =>
                  setView({ ...view, query: "", filters: DEFAULT_VIEW.filters })
                }
              >
                Reset filters
              </button>
            )}
          </footer>
        </>
      )}
    </main>
  );
}
