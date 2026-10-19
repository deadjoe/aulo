import { useCallback, useRef, useState } from "react";

/** Typing within this long counts as one step to undo. */
const GROUP_MS = 800;
const LIMIT = 100;

/**
 * Undo and redo for one text field whose value lives elsewhere. Typing is
 * grouped into steps; `replace` (a loaded draft, a cleared field) is always a
 * step of its own.
 */
export function useUndo(value: string, apply: (next: string) => void) {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastTyped = useRef(0);
  const [, render] = useState(0);
  const current = useRef(value);
  current.current = value;

  const record = useCallback(
    (next: string, typing: boolean) => {
      if (next === current.current) return;
      const now = Date.now();
      if (!typing || now - lastTyped.current > GROUP_MS) {
        past.current.push(current.current);
        if (past.current.length > LIMIT) past.current.shift();
      }
      lastTyped.current = typing ? now : 0;
      future.current = [];
      apply(next);
      render((n) => n + 1);
    },
    [apply],
  );
  const type = useCallback((next: string) => record(next, true), [record]);
  const replace = useCallback((next: string) => record(next, false), [record]);
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous === undefined) return;
    future.current.push(current.current);
    lastTyped.current = 0;
    apply(previous);
    render((n) => n + 1);
  }, [apply]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(current.current);
    lastTyped.current = 0;
    apply(next);
    render((n) => n + 1);
  }, [apply]);
  return {
    type,
    replace,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    /** ⌘Z / ⌘⇧Z (Ctrl+Z / Ctrl+Y on Windows) in the field use this history. */
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y" && e.ctrlKey) {
        e.preventDefault();
        redo();
      }
    },
  };
}
