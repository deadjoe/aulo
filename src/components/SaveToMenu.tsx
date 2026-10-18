import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";

export interface SaveToOption {
  id: string;
  name: string;
  songs: number;
}

/** "Save to" with a pop-up that searches workspaces or creates one by name. */
export default function SaveToMenu({
  options,
  selected,
  onSelect,
  onCreate,
}: {
  options: SaveToOption[];
  selected: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === selected) ?? options[0];
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
  useEffect(() => {
    if (!open) {
      setQuery("");
      setError("");
    }
  }, [open]);
  const term = query.trim().toLowerCase();
  const matches = options.filter((o) => o.name.toLowerCase().includes(term));
  const exact = options.some((o) => o.name.toLowerCase() === term);
  async function create() {
    if (!query.trim()) return;
    setError("");
    try {
      await onCreate(query);
      setOpen(false);
    } catch (e) {
      setError(typeof e === "string" ? e : "That name can’t be used.");
    }
  }
  return (
    <div className="save-to" ref={ref}>
      <FolderOpen size={17} />
      <span>Save to</span>
      <button
        className="tool-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {current?.name}
      </button>
      {open && (
        <div
          className="save-menu"
          role="dialog"
          aria-label="Choose a workspace"
        >
          <form
            className="save-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches.length === 1 && term) {
                onSelect(matches[0].id);
                setOpen(false);
              } else if (!exact) void create();
            }}
          >
            <input
              autoFocus
              aria-label="Search or create a workspace"
              placeholder="Search or create…"
              maxLength={60}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={
                query.trim() ? `Create “${query.trim()}”` : "Create a workspace"
              }
              disabled={!query.trim() || exact}
              onClick={() => void create()}
            >
              <Plus size={18} />
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="save-options" role="listbox">
            {matches.map((option) => (
              <button
                key={option.id}
                role="option"
                aria-selected={option.id === current?.id}
                className={option.id === current?.id ? "selected" : ""}
                onClick={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
              >
                {option.name}
                <small>
                  {option.songs} {option.songs === 1 ? "song" : "songs"}
                </small>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="save-empty">
                Press Enter or + to create “{query.trim()}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
