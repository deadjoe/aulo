import { useEffect, useRef, useState } from "react";
import {
  CornerDownRight,
  Download,
  FolderOpen,
  ListMinus,
  ListPlus,
  ListVideo,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  RotateCcw,
  Share,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { displayTitle, isActive, type Song } from "../lib/songs";
import { useFloating } from "../lib/floating";
import { useMenuKeys } from "../lib/menuKeys";

export interface SongActions {
  onAnotherVersion: (song: Song) => void;
  onReuse: (song: Song) => void;
  onRename: (song: Song) => void;
  onDownload: (song: Song) => void;
  onReveal: (song: Song) => void;
  /** Opens the system share sheet, pointing from the element that asked. */
  onShare: (song: Song, from: Element) => Promise<void>;
  onPlaylist: (songs: Song[]) => void;
  onQueue: (songs: Song[]) => void;
  onMove: (songs: Song[]) => void;
  onTrash: (songs: Song[]) => void;
  /** Present only while looking at a playlist. */
  onRemoveFromPlaylist?: (songs: Song[]) => void;
}

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const revealLabel =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "Show in File Explorer"
    : "Show in Finder";
export const SHORTCUTS = {
  playlist: isMac ? "⌘P" : "Ctrl+P",
  queue: isMac ? "⌘U" : "Ctrl+U",
  move: isMac ? "⌘S" : "Ctrl+S",
  trash: isMac ? "⌘⌫" : "Ctrl+Del",
};

const finished = (s: Song) => s.state === "completed" && !!s.audioPath;

/**
 * A song's menu. When the song is part of a multi-song selection, the menu
 * acts on all selected songs and offers only what applies to several at once.
 */
export default function SongMenu({
  song,
  targets,
  actions,
  large = false,
  vertical = false,
}: {
  song: Song;
  targets: Song[];
  actions: SongActions;
  large?: boolean;
  /** The player's vertical three dots. */
  vertical?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const floating = useFloating(open, ref);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keys = useMenuKeys(open, setOpen, menu, trigger);
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
  const many = targets.length > 1;
  const playable = targets.filter(finished);
  const removable = targets.filter((s) => !isActive(s));
  const item = (
    label: string,
    icon: React.ReactNode,
    run: () => void,
    shortcut?: string,
    className = "",
  ) => (
    <button
      role="menuitem"
      className={className}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon}
      <span className="menu-label">{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        ref={trigger}
        className={large ? "round-button large" : "round-button"}
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={keys.onTriggerKeyDown}
      >
        {vertical ? <MoreVertical size={18} /> : <MoreHorizontal size={18} />}
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          style={floating}
          ref={menu}
          onKeyDown={keys.onMenuKeyDown}
        >
          {many && (
            <p className="menu-heading">{targets.length} songs selected</p>
          )}
          {!many && (
            <>
              {item("Create another version", <RotateCcw size={16} />, () =>
                actions.onAnotherVersion(song),
              )}
              {item("Reuse settings", <SlidersHorizontal size={16} />, () =>
                actions.onReuse(song),
              )}
              {item("Rename", <Pencil size={16} />, () =>
                actions.onRename(song),
              )}
              <hr />
            </>
          )}
          {playable.length > 0 &&
            item(
              "Add to playlist",
              <ListPlus size={16} />,
              () => actions.onPlaylist(playable),
              SHORTCUTS.playlist,
            )}
          {playable.length > 0 &&
            item(
              "Add to queue",
              <ListVideo size={16} />,
              () => actions.onQueue(playable),
              SHORTCUTS.queue,
            )}
          {item(
            "Move to workspace",
            <CornerDownRight size={16} />,
            () => actions.onMove(targets),
            SHORTCUTS.move,
          )}
          {actions.onRemoveFromPlaylist &&
            item("Remove from playlist", <ListMinus size={16} />, () =>
              actions.onRemoveFromPlaylist!(targets),
            )}
          {!many && finished(song) && (
            <>
              <hr />
              {item("Share", <Share size={16} />, () => {
                const from = ref.current;
                if (from) void actions.onShare(song, from);
              })}
              {item("Download", <Download size={16} />, () =>
                actions.onDownload(song),
              )}
              {item(revealLabel, <FolderOpen size={16} />, () =>
                actions.onReveal(song),
              )}
            </>
          )}
          {removable.length > 0 && (
            <>
              <hr />
              {item(
                "Move to Trash",
                <Trash2 size={16} />,
                () => actions.onTrash(removable),
                SHORTCUTS.trash,
                "danger",
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
