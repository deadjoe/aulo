import { useEffect, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  ListPlus,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { displayTitle, isActive, type Song } from "../lib/songs";

export interface SongActions {
  onAnotherVersion: (song: Song) => void;
  onReuse: (song: Song) => void;
  onRename: (song: Song) => void;
  onDownload: (song: Song) => void;
  onReveal: (song: Song) => void;
  onQueue: (song: Song) => void;
  onTrash: (song: Song) => void;
}

const revealLabel =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "Show in File Explorer"
    : "Show in Finder";

export default function SongMenu({
  song,
  actions,
  large = false,
}: {
  song: Song;
  actions: SongActions;
  large?: boolean;
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
  const finished = song.state === "completed" && !!song.audioPath;
  const item = (
    label: string,
    icon: React.ReactNode,
    action: (song: Song) => void,
    className = "",
  ) => (
    <button
      role="menuitem"
      className={className}
      onClick={() => {
        setOpen(false);
        action(song);
      }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className={large ? "round-button large" : "round-button"}
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {item(
            "Create another version",
            <RotateCcw size={16} />,
            actions.onAnotherVersion,
          )}
          {item(
            "Reuse settings",
            <SlidersHorizontal size={16} />,
            actions.onReuse,
          )}
          {item("Rename", <Pencil size={16} />, actions.onRename)}
          {finished && <hr />}
          {finished &&
            item("Download", <Download size={16} />, actions.onDownload)}
          {finished &&
            item(revealLabel, <FolderOpen size={16} />, actions.onReveal)}
          {finished &&
            item("Add to queue", <ListPlus size={16} />, actions.onQueue)}
          {!isActive(song) && <hr />}
          {!isActive(song) &&
            item(
              "Move to Trash",
              <Trash2 size={16} />,
              actions.onTrash,
              "danger",
            )}
        </div>
      )}
    </div>
  );
}
