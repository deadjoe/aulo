import { useCallback, useEffect, useState } from "react";
import {
  createSong,
  EMPTY_COLLECTIONS,
  listCollections,
  listSongs,
  onCollectionsUpdated,
  onSongUpdated,
  type Collections,
  type Song,
  type SongRequest,
} from "./songs";

/** Insert or replace one song, keeping the list newest first. */
export function upsert(list: Song[], song: Song): Song[] {
  const index = list.findIndex((s) => s.id === song.id);
  if (index < 0) return [song, ...list];
  const next = [...list];
  next[index] = song;
  return next;
}

/**
 * Merge the stored library with updates that arrived while it was loading:
 * a live update is newer than what the library read from disk.
 */
export function mergeLoaded(loaded: Song[], live: Song[]): Song[] {
  return live.reduceRight(upsert, loaded);
}

/** The person's songs, kept current by the native song service. */
export function useLibrary(enabled: boolean, onError: (text: string) => void) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [collections, setCollections] =
    useState<Collections>(EMPTY_COLLECTIONS);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const stopCollections = onCollectionsUpdated(setCollections);
    listCollections().then(
      (c) => active && setCollections(c),
      () => undefined,
    );
    const stop = onSongUpdated((song) =>
      setSongs((list) => upsert(list, song)),
    );
    listSongs().then(
      (loaded) => active && setSongs((live) => mergeLoaded(loaded, live)),
      () =>
        active &&
        onError("Your songs couldn’t be loaded. Reopen Aulo to try again."),
    );
    return () => {
      active = false;
      stop();
      stopCollections();
    };
    // onError is only a notification sink, so it does not restart the subscription.
  }, [enabled]);

  const start = useCallback(async (request: SongRequest, workspace: string) => {
    const song = await createSong(request, workspace);
    setSongs((list) => upsert(list, song));
    return song;
  }, []);
  const remove = useCallback(
    (ids: string[]) =>
      setSongs((list) => list.filter((s) => !ids.includes(s.id))),
    [],
  );
  return { songs, collections, start, remove };
}

/** A short message that leaves on its own, optionally with a way to undo. */
export function useMessage() {
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), undo ? 6000 : 4500);
    return () => window.clearTimeout(timer);
  }, [message, undo]);
  const notify = useCallback(
    (text: string, undoAction: (() => void) | null = null) => {
      setMessage(text);
      setUndo(() => undoAction);
    },
    [],
  );
  const dismiss = useCallback(() => setMessage(""), []);
  return { message, undo: message ? undo : null, notify, dismiss };
}
