import { useEffect, useRef, useState, type ReactNode } from "react";
import { Library, Music2, Search, Trash2, X } from "lucide-react";
import { useFloating } from "../lib/floating";
import {
  deleteSaved,
  listSaved,
  savedName,
  savedPreview,
  type Saved,
  type SavedKind,
} from "../lib/saved";
import { ago } from "../lib/view";

const LABELS: Record<
  SavedKind,
  { button: string; search: string; empty: string }
> = {
  lyrics: {
    button: "Saved lyrics",
    search: "Search lyrics",
    empty:
      "Lyrics you save, start over from, or create songs with appear here.",
  },
  styles: {
    button: "Saved styles",
    search: "Search styles",
    empty: "Styles you save or create songs with appear here.",
  },
};

/** The library button for saved lyrics or styles, and its searchable list. */
export default function SavedPopover({
  kind,
  onPick,
  onError,
  showLabel = false,
  trigger,
}: {
  kind: SavedKind;
  onPick: (saved: Saved) => void;
  onError: (text: string) => void;
  /** Show the words next to the icon (the full-screen editor does). */
  showLabel?: boolean;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Saved[] | null>(null);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const floating = useFloating(open, ref, 440);
  const labels = LABELS[kind];

  useEffect(() => {
    if (!open) {
      setQuery("");
      setConfirming(null);
      return;
    }
    let active = true;
    listSaved(kind).then(
      (list) => active && setItems(list),
      () => active && setItems([]),
    );
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      ) {
        if (e instanceof KeyboardEvent) e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close, true);
    return () => {
      active = false;
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close, true);
    };
  }, [open, kind]);

  const term = query.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (s) =>
      !term ||
      s.text.toLowerCase().includes(term) ||
      s.title.toLowerCase().includes(term),
  );

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={showLabel ? "tool-button labelled" : "tool-button"}
        aria-label={labels.button}
        title={labels.button}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {trigger ?? <Library size={17} />}
        {showLabel && <span>{labels.button}</span>}
      </button>
      {open && (
        <div
          className="saved-popover"
          role="dialog"
          aria-label={labels.button}
          style={floating}
        >
          <label className="saved-search">
            <Search size={16} />
            <input
              autoFocus
              aria-label={labels.search}
              placeholder={labels.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <div className="saved-list">
            {items === null ? null : shown.length === 0 ? (
              <p className="saved-empty">
                {term ? "Nothing matches that search." : labels.empty}
              </p>
            ) : (
              shown.map((saved) =>
                confirming === saved.id ? (
                  <div key={saved.id} className="saved-item confirming">
                    <p>
                      Delete “{savedName(saved)}” from{" "}
                      {labels.button.toLowerCase()}?
                    </p>
                    <div>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="danger-button small"
                        onClick={() =>
                          void deleteSaved(kind, saved.id).then(
                            () => {
                              setItems((list) =>
                                (list ?? []).filter((s) => s.id !== saved.id),
                              );
                              setConfirming(null);
                            },
                            (e: unknown) =>
                              onError(
                                typeof e === "string"
                                  ? e
                                  : "That couldn’t be deleted.",
                              ),
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={saved.id} className="saved-item">
                    <button
                      type="button"
                      className="saved-pick"
                      onClick={() => {
                        onPick(saved);
                        setOpen(false);
                      }}
                    >
                      <Music2 size={18} />
                      <span>
                        <strong>{savedName(saved)}</strong>
                        <small>
                          {kind === "lyrics" ? savedPreview(saved) : saved.text}
                        </small>
                        <em>{ago(saved.savedMs)}</em>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${savedName(saved)}`}
                      onClick={() => setConfirming(saved.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
