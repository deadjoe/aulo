import { useEffect, useRef } from "react";
import { Maximize2, Redo2, SquarePen, Undo2 } from "lucide-react";
import SavedPopover from "./SavedPopover";
import { saveText, type Saved } from "../lib/saved";
import type { useUndo } from "../lib/useUndo";

type History = ReturnType<typeof useUndo>;

export interface LyricsToolsProps {
  lyrics: string;
  history: History;
  onError: (text: string) => void;
}

/** Start a new draft: the current words go to Saved lyrics first. */
export function newDraft({ lyrics, history, onError }: LyricsToolsProps) {
  if (!lyrics.trim()) return;
  void saveText("lyrics", lyrics).then(
    () => history.replace(""),
    (e: unknown) =>
      onError(
        typeof e === "string"
          ? e
          : "Your lyrics couldn’t be saved. Nothing was cleared.",
      ),
  );
}

function Tools({
  props,
  labelled = false,
}: {
  props: LyricsToolsProps;
  labelled?: boolean;
}) {
  const { lyrics, history, onError } = props;
  const pick = (saved: Saved) => history.replace(saved.text);
  return (
    <>
      {labelled && (
        <SavedPopover kind="lyrics" onPick={pick} onError={onError} showLabel />
      )}
      <button
        type="button"
        className="tool-button"
        aria-label="Undo"
        title="Undo"
        disabled={!history.canUndo}
        onClick={history.undo}
      >
        <Undo2 size={17} />
      </button>
      <button
        type="button"
        className="tool-button"
        aria-label="Redo"
        title="Redo"
        disabled={!history.canRedo}
        onClick={history.redo}
      >
        <Redo2 size={17} />
      </button>
      <button
        type="button"
        className="tool-button"
        aria-label="New draft"
        title="New draft (your current lyrics are saved first)"
        disabled={!lyrics.trim()}
        onClick={() => newDraft(props)}
      >
        <SquarePen size={17} />
      </button>
      {!labelled && (
        <SavedPopover kind="lyrics" onPick={pick} onError={onError} />
      )}
    </>
  );
}

/** The tools at the top of the Lyrics card. */
export function LyricsToolbar({
  onFullScreen,
  ...props
}: LyricsToolsProps & { onFullScreen: () => void }) {
  return (
    <span className="field-tools" aria-label="Lyrics tools" role="toolbar">
      <Tools props={props} />
      <button
        type="button"
        className="tool-button"
        aria-label="Open full screen lyrics editor"
        title="Open full screen lyrics editor"
        onClick={onFullScreen}
      >
        <Maximize2 size={16} />
      </button>
    </span>
  );
}

/** A quiet, full-window place to write lyrics. Done or Escape returns. */
export function FullScreenLyrics({
  onDone,
  ...props
}: LyricsToolsProps & { onDone: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const field = area.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="lyrics-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Lyrics editor"
    >
      <header>
        <span className="field-tools" role="toolbar" aria-label="Lyrics tools">
          <Tools props={props} labelled />
        </span>
        <button type="button" className="done-button" onClick={onDone}>
          Done
        </button>
      </header>
      <textarea
        ref={area}
        aria-label="Lyrics"
        value={props.lyrics}
        placeholder={
          "Write the words you want sung.\n\nTip: label parts like [Verse] and [Chorus] to shape the song."
        }
        onChange={(e) => props.history.type(e.target.value)}
        onKeyDown={props.history.onKeyDown}
      />
    </div>
  );
}
