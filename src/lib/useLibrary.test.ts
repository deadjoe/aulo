// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as songs from "./songs";
import { useLibrary } from "./useLibrary";

const updates: ((song: songs.Song) => void)[] = [];
vi.mock("./songs", async (importOriginal) => {
  const actual = await importOriginal<typeof songs>();
  return {
    ...actual,
    listSongs: vi.fn(),
    listCollections: vi.fn().mockResolvedValue(actual.EMPTY_COLLECTIONS),
    onSongUpdated: vi.fn((handler: (song: songs.Song) => void) => {
      updates.push(handler);
      return () => undefined;
    }),
    onCollectionsUpdated: vi.fn(() => () => undefined),
  };
});

const song = (state: songs.Song["state"]): songs.Song => ({
  id: "a",
  createdMs: 1,
  request: {
    title: "A",
    style: "folk",
    lyrics: "",
    instrumental: true,
    vocal: "auto",
    weirdness: 50,
    styleInfluence: 50,
  },
  favorite: false,
  state,
  stage: null,
  progress: null,
  startedMs: null,
  duration: null,
  audioPath: null,
  message: null,
  workspace: "default",
  trashedMs: null,
});

describe("useLibrary", () => {
  beforeEach(() => {
    vi.mocked(songs.listSongs).mockReset();
    updates.length = 0;
  });

  it("tells about a finished song once, and never about songs already done", async () => {
    vi.mocked(songs.listSongs).mockResolvedValueOnce([song("running")]);
    const onFinished = vi.fn();
    const { result } = renderHook(() =>
      useLibrary(true, () => undefined, onFinished),
    );
    await waitFor(() => expect(result.current.songs[0]?.state).toBe("running"));
    act(() => updates.at(-1)!(song("completed")));
    act(() => updates.at(-1)!(song("completed")));
    expect(onFinished).toHaveBeenCalledOnce();
    expect(onFinished.mock.calls[0][0].title).toBe("Your song is ready");
  });

  it("shows what the disk says after coming back from setup", async () => {
    vi.mocked(songs.listSongs).mockResolvedValueOnce([song("running")]);
    const { result, rerender } = renderHook(
      ({ enabled }) => useLibrary(enabled, () => undefined),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.songs[0]?.state).toBe("running"));
    // The song finishes while setup is open, so no update reaches the library.
    rerender({ enabled: false });
    vi.mocked(songs.listSongs).mockResolvedValueOnce([song("completed")]);
    await act(async () => rerender({ enabled: true }));
    await waitFor(() =>
      expect(result.current.songs[0]?.state).toBe("completed"),
    );
  });
});
