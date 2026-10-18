import { useRef, useState } from "react";
import { useFloating } from "../lib/floating";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import CoverArt from "./CoverArt";
import { ago } from "../lib/view";
import type { Song } from "../lib/songs";

export interface CollectionRow {
  id: string;
  name: string;
  songs: Song[];
  createdMs: number;
  archived?: boolean;
  fixed?: boolean;
}

function Collage({ id, songs }: { id: string; songs: Song[] }) {
  const covers = songs.slice(0, 4);
  if (covers.length < 4)
    return (
      <span className="collage single">
        <CoverArt
          id={covers[0]?.id ?? id}
          style={covers[0]?.request.style ?? id}
        />
      </span>
    );
  return (
    <span className="collage" aria-hidden="true">
      {covers.map((s) => (
        <CoverArt key={s.id} id={s.id} style={s.request.style} size="sm" />
      ))}
    </span>
  );
}

function RowMenu({
  row,
  kind,
  onRename,
  onArchive,
  onDelete,
}: {
  row: CollectionRow;
  kind: "workspace" | "playlist";
  onRename: () => void;
  onArchive?: (archived: boolean) => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const floating = useFloating(open, ref, 160);
  return (
    <div
      className="menu-anchor"
      ref={ref}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="round-button"
        aria-label={`More for ${row.name}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu" role="menu" style={floating}>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil size={16} />
            <span className="menu-label">Rename</span>
          </button>
          {onArchive && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onArchive(!row.archived);
              }}
            >
              {row.archived ? (
                <ArchiveRestore size={16} />
              ) : (
                <Archive size={16} />
              )}
              <span className="menu-label">
                {row.archived ? "Restore" : "Archive"}
              </span>
            </button>
          )}
          {onDelete && (
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={16} />
              <span className="menu-label">Delete {kind}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Workspaces or playlists: search, create, rename, archive or delete, open. */
export default function CollectionsView({
  kind,
  rows,
  currentId,
  showArchived,
  onToggleArchived,
  onOpen,
  onCreate,
  onRename,
  onArchive,
  onDelete,
}: {
  kind: "workspace" | "playlist";
  rows: CollectionRow[];
  currentId?: string;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  onOpen: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onArchive?: (id: string, archived: boolean) => void;
  onDelete?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<string | "new" | null>(null);
  const [error, setError] = useState("");
  const visible = rows.filter(
    (r) =>
      (kind !== "workspace" || Boolean(r.archived) === Boolean(showArchived)) &&
      r.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function submit(name: string) {
    setError("");
    try {
      if (naming === "new") await onCreate(name);
      else if (naming) await onRename(naming, name);
      setNaming(null);
    } catch (e) {
      setError(typeof e === "string" ? e : "That name can’t be used.");
    }
  }
  const nameField = (initial: string) => (
    <form
      className="collection-name"
      onSubmit={(e) => {
        e.preventDefault();
        const value = new FormData(e.currentTarget).get("name");
        if (typeof value === "string" && value.trim()) void submit(value);
      }}
    >
      <input
        name="name"
        aria-label={`${kind === "workspace" ? "Workspace" : "Playlist"} name`}
        defaultValue={initial}
        placeholder={kind === "workspace" ? "Workspace name" : "Playlist name"}
        maxLength={60}
        autoFocus
        onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
      />
      <button className="primary small" type="submit">
        {naming === "new" ? "Create" : "Save"}
      </button>
    </form>
  );
  return (
    <div className="collections">
      <div className="library-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label={`Search ${kind}s`}
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {onToggleArchived && (
          <button
            className={`tool-pill${showArchived ? " selected" : ""}`}
            aria-pressed={showArchived}
            onClick={onToggleArchived}
          >
            <Archive size={15} />
            Archived
          </button>
        )}
      </div>
      {error && (
        <p className="error collections-error" role="alert">
          {error}
        </p>
      )}
      <div className="collection-scroll">
        {!showArchived && (
          <div className="collection-row">
            <span className="collection-add">
              <Plus size={22} />
            </span>
            {naming === "new" ? (
              nameField("")
            ) : (
              <button
                className="collection-open"
                onClick={() => setNaming("new")}
              >
                <strong>
                  {kind === "workspace"
                    ? "Create new workspace"
                    : "Create new playlist"}
                </strong>
              </button>
            )}
          </div>
        )}
        {visible.map((row) => {
          const latest = row.songs.reduce(
            (m, s) => Math.max(m, s.createdMs),
            row.createdMs,
          );
          return (
            <div
              key={row.id}
              className={`collection-row${row.id === currentId ? " current" : ""}`}
            >
              <Collage id={row.id} songs={row.songs} />
              {naming === row.id ? (
                nameField(row.name)
              ) : (
                <button
                  className="collection-open"
                  onClick={() => onOpen(row.id)}
                >
                  <strong>{row.name}</strong>
                  <small>
                    {row.songs.length}{" "}
                    {row.songs.length === 1 ? "song" : "songs"}
                    {latest > 0 && ` · ${ago(latest)}`}
                  </small>
                </button>
              )}
              {naming !== row.id && (
                <RowMenu
                  row={row}
                  kind={kind}
                  onRename={() => setNaming(row.id)}
                  onArchive={
                    onArchive && !row.fixed
                      ? (archived) => onArchive(row.id, archived)
                      : undefined
                  }
                  onDelete={
                    onDelete && !row.fixed ? () => onDelete(row.id) : undefined
                  }
                />
              )}
            </div>
          );
        })}
        {visible.length === 0 && (query || showArchived) && (
          <p className="collections-empty">
            {showArchived
              ? "No archived workspaces."
              : "Nothing matches that search."}
          </p>
        )}
      </div>
    </div>
  );
}
