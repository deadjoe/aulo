// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import SetupWizard from "./components/SetupWizard";
import * as songs from "./lib/songs";
import type { Song } from "./lib/songs";

vi.mock("./lib/hardware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/hardware")>()),
  detectHardware: vi.fn().mockResolvedValue(null),
  chooseModelFolder: vi.fn().mockResolvedValue("/existing/models"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue("/Users/me/Music/Sunday.wav"),
  open: vi.fn(),
}));
vi.mock("./lib/songs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/songs")>();
  return {
    ...actual,
    creationStatus: vi.fn(actual.creationStatus),
    listSongs: vi.fn(actual.listSongs),
    createSong: vi.fn(),
    cancelSong: vi.fn().mockResolvedValue(undefined),
    updateSong: vi.fn().mockResolvedValue(undefined),
    trashSongs: vi.fn((ids: string[]) => Promise.resolve(ids)),
    deleteSongs: vi.fn((ids: string[]) => Promise.resolve(ids)),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    listCollections: vi.fn(actual.listCollections),
    moveSongs: vi.fn().mockResolvedValue(undefined),
    addToPlaylist: vi.fn().mockResolvedValue(1),
    createWorkspace: vi.fn(),
    createPlaylist: vi.fn(),
    exportSong: vi.fn().mockResolvedValue(undefined),
    revealSong: vi.fn().mockResolvedValue(undefined),
    shareSong: vi.fn().mockResolvedValue(undefined),
    audioUrl: vi.fn(() => "blob:audio"),
  };
});

const song = (overrides: Partial<Song> = {}): Song => ({
  id: "0123456789abcdef0123456789abcdef",
  createdMs: Date.now(),
  request: {
    title: "",
    style: "dreamy indie pop",
    lyrics: "[Verse]\nMorning light on the window",
    instrumental: false,
    vocal: "auto",
    weirdness: 50,
    styleInfluence: 50,
  },
  favorite: false,
  state: "completed",
  stage: null,
  progress: null,
  startedMs: null,
  duration: 154,
  audioPath: "/library/x/audio.flac",
  message: null,
  workspace: "default",
  trashedMs: null,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aulo.explored.v1", "true");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("first-run setup", () => {
  it("keeps browser hardware unknown and does not offer native model actions", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const explore = vi.fn();
    render(<SetupWizard onExplore={explore} />);
    await user.click(screen.getByRole("button", { name: /Get started/ }));
    expect(
      await screen.findByRole("heading", {
        name: "Aulo checks this in the app",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByText("Not downloaded")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Download music models/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/YUE2|GROOVE|engine/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Look around first" }));
    expect(explore).toHaveBeenCalledOnce();
  });
});

describe("create panel", () => {
  it("never offers creation outside the desktop app", async () => {
    render(<App />);
    expect(
      await screen.findByText("Open the Aulo desktop app to create songs."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Create song" })).toBeDisabled();
    expect(screen.getByText("Your songs will live here")).toBeVisible();
  });

  it("keeps the simple mode simple and remembers unsent text", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.type(screen.getByLabelText("Song description"), "warm piano");
    expect(screen.getByLabelText("Lyrics")).toBeVisible();
    await user.click(screen.getByRole("switch", { name: "Instrumental" }));
    expect(screen.queryByLabelText("Lyrics")).not.toBeInTheDocument();
    expect(screen.getByText(/can still add a little humming/)).toBeVisible();
    expect(screen.queryByText(/ABC|seed|CFG/i)).not.toBeInTheDocument();
    view.unmount();
    render(<App />);
    expect(screen.getByLabelText("Song description")).toHaveValue("warm piano");
  });

  it("offers style ideas, sections and creative controls in advanced mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    const chip = screen.getAllByRole("button", { name: /dreamy indie pop/ })[0];
    await user.click(chip);
    expect(screen.getByLabelText("Styles")).toHaveValue("dreamy indie pop");
    await user.click(screen.getByRole("button", { name: "+ Chorus" }));
    expect(screen.getByLabelText("Lyrics")).toHaveValue("[Chorus]\n");
    expect(screen.getByRole("radio", { name: "Female" })).toBeVisible();
    expect(screen.getByLabelText("Weirdness")).toHaveValue("50");
    expect(screen.getByLabelText("Style influence")).toHaveValue("50");
  });

  it("starts a song only when Aulo is ready", async () => {
    vi.mocked(songs.creationStatus).mockResolvedValue({
      ready: true,
      blocker: "ready",
      message: "Ready to create.",
    });
    vi.mocked(songs.createSong).mockResolvedValue(
      song({ state: "queued", duration: null, audioPath: null }),
    );
    const user = userEvent.setup();
    render(<App />);
    const create = screen.getByRole("button", { name: "Create song" });
    await user.type(screen.getByLabelText("Song description"), "lofi");
    expect(create).toBeDisabled();
    expect(
      screen.getByText("Add lyrics, or switch on Instrumental."),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Lyrics"), "Morning light");
    await user.click(create);
    expect(songs.createSong).toHaveBeenCalledWith(
      expect.objectContaining({ style: "lofi", lyrics: "Morning light" }),
      "default",
    );
    expect(
      await screen.findByRole("img", { name: "Waiting to start…" }),
    ).toBeVisible();
    expect(screen.queryByText(/Creating “/)).not.toBeInTheDocument();
  });
});

describe("library", () => {
  it("shows plain progress, stops a running song, and offers the song menu", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({
        id: "fedcba9876543210fedcba9876543210",
        state: "running",
        stage: "rendering",
        progress: { completed: 8, total: 32 },
        startedMs: Date.now(),
        duration: null,
        audioPath: null,
      }),
      song({ request: { ...song().request, title: "Sunday" } }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Creating…")).toBeVisible();
    expect(
      screen.queryByText(/Recording|Performing|%/),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(songs.cancelSong).toHaveBeenCalledWith(
      "fedcba9876543210fedcba9876543210",
    );
    expect(screen.getByText("Today")).toBeVisible();
    expect(screen.getByText("2:34")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Like Sunday" }));
    expect(songs.updateSong).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
      { favorite: true },
    );
    await user.click(screen.getByRole("button", { name: "More for Sunday" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Create another version",
      "Reuse settings",
      "Rename",
      "Add to playlistCtrl+P",
      "Add to queueCtrl+U",
      "Move to workspaceCtrl+S",
      "Share",
      "Download",
      "Show in Finder",
      "Move to TrashCtrl+Del",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "Share" }));
    expect(songs.shareSong).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
      "Sunday",
      expect.objectContaining({ x: expect.any(Number) }),
    );
    await user.click(screen.getByRole("button", { name: "More for Sunday" }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: /Move to Trash/,
      }),
    );
    const confirm = screen.getByRole("dialog");
    expect(
      within(confirm).getByText(/restore songs from the Trash/),
    ).toBeVisible();
    await user.click(
      within(confirm).getByRole("button", { name: "Move to Trash" }),
    );
    expect(songs.trashSongs).toHaveBeenCalledWith([
      "0123456789abcdef0123456789abcdef",
    ]);
    expect(
      await screen.findByText("Moved “Sunday” to the Trash."),
    ).toBeVisible();
  });

  it("opens a song's details with its lyrics and makes another version", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
    ]);
    vi.mocked(songs.createSong).mockResolvedValue(
      song({
        id: "fedcba9876543210fedcba9876543210",
        state: "queued",
        duration: null,
        audioPath: null,
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Sunday" }));
    expect(screen.getByRole("heading", { name: "Sunday" })).toBeVisible();
    expect(screen.getByText(/Morning light on the window/)).toBeVisible();
    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create another version" }),
    );
    expect(songs.createSong).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sunday", style: "dreamy indie pop" }),
      "default",
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Workspaces" })).toBeVisible();
  });

  it("downloads in the chosen format and remembers it", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "More for Sunday" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Download" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((r) => r.querySelector("strong")?.textContent),
    ).toEqual(["MP3", "WAV", "FLAC"]);
    await user.click(within(dialog).getByRole("radio", { name: /WAV/ }));
    await user.click(within(dialog).getByRole("button", { name: "Download" }));
    expect(songs.exportSong).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
      "wav",
      "/Users/me/Music/Sunday.wav",
    );
    expect(await screen.findByText("Downloaded.")).toBeVisible();
    expect(localStorage.getItem("aulo.download-format.v1")).toBe("wav");
  });

  it("selects several songs and acts on all of them", async () => {
    const two = song({
      id: "fedcba9876543210fedcba9876543210",
      request: { ...song().request, title: "Monday" },
    });
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
      two,
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("checkbox", { name: "Select Sunday" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Select Monday" }));
    const bar = screen.getByRole("toolbar", { name: "Selected songs" });
    expect(within(bar).getByText("2 selected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "More for Monday" }));
    expect(screen.getByText("2 songs selected")).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: /Rename/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More for Monday" }));
    await user.keyboard("{Control>}{Delete}{/Control}");
    expect(songs.trashSongs).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Move to Trash",
      }),
    );
    expect(songs.trashSongs).toHaveBeenCalledWith([
      "0123456789abcdef0123456789abcdef",
      "fedcba9876543210fedcba9876543210",
    ]);
    expect(
      await screen.findByText("Moved 2 songs to the Trash."),
    ).toBeVisible();
  });

  it("says so when only some songs reach the Trash", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
      song({
        id: "fedcba9876543210fedcba9876543210",
        request: { ...song().request, title: "Monday" },
      }),
    ]);
    vi.mocked(songs.trashSongs).mockResolvedValueOnce([
      "0123456789abcdef0123456789abcdef",
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("checkbox", { name: "Select Sunday" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Select Monday" }));
    await user.click(screen.getByRole("button", { name: "More for Monday" }));
    await user.click(screen.getByRole("menuitem", { name: /Move to Trash/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Move to Trash",
      }),
    );
    expect(
      await screen.findByText(
        "Moved “Sunday” to the Trash. 1 song couldn’t be moved; try again.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Moved 2 songs to the Trash.")).toBeNull();
  });

  it("moves songs to another workspace and filters the list", async () => {
    vi.mocked(songs.listCollections).mockResolvedValue({
      workspaces: [
        { id: "default", name: "My Workspace", createdMs: 0, archived: false },
        { id: "rock", name: "Rock", createdMs: 1, archived: false },
      ],
      playlists: [],
    });
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
      song({
        id: "fedcba9876543210fedcba9876543210",
        favorite: true,
        request: { ...song().request, title: "Monday", instrumental: true },
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("navigation", { name: "Workspace" }),
    ).toHaveTextContent("My Workspace");
    await user.click(screen.getByRole("button", { name: /^Liked$/ }));
    expect(screen.queryByText("Sunday")).not.toBeInTheDocument();
    expect(screen.getByText("1 song")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("2 songs")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "More for Sunday" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Move to workspace/ }),
    );
    await user.click(screen.getByRole("button", { name: /Rock/ }));
    expect(songs.moveSongs).toHaveBeenCalledWith(
      ["0123456789abcdef0123456789abcdef"],
      "rock",
    );
    await user.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByText("Create new workspace")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Rock/ }));
    expect(screen.getByText("Rock is empty")).toBeVisible();
  });

  it("restores songs from the Trash and asks before deleting them", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
      song({
        id: "fedcba9876543210fedcba9876543210",
        trashedMs: Date.now() - 60_000,
        request: { ...song().request, title: "Gone" },
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Library/ }));
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Trash \(1\)/ }));
    expect(screen.getByText("Gone")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(songs.trashSongs).toHaveBeenCalledWith(
      ["fedcba9876543210fedcba9876543210"],
      false,
    );
    await user.click(screen.getByRole("button", { name: "Delete Gone" }));
    expect(songs.deleteSongs).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(songs.deleteSongs).toHaveBeenCalledWith([
      "fedcba9876543210fedcba9876543210",
    ]);
  });

  it("asks before deleting a workspace and keeps its songs", async () => {
    vi.mocked(songs.listCollections).mockResolvedValue({
      workspaces: [
        { id: "default", name: "My Workspace", createdMs: 0, archived: false },
        { id: "rock", name: "Rock", createdMs: 1, archived: false },
      ],
      playlists: [],
    });
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({
        workspace: "rock",
        request: { ...song().request, title: "Loud" },
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Workspaces" }));
    await user.click(screen.getByRole("button", { name: "More for Rock" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Delete workspace/ }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/1 song will move to My Workspace/),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete workspace" }),
    );
    expect(songs.deleteWorkspace).toHaveBeenCalledWith("rock");
  });

  it("opens the queue and mutes from the player", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({ request: { ...song().request, title: "Sunday" } }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Sunday");
    await user.click(screen.getByRole("button", { name: "Queue" }));
    const queue = screen.getByRole("region", { name: "Queue" });
    expect(within(queue).getByText("Nothing is playing.")).toBeVisible();
    expect(within(queue).getByText("Next up")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.getByRole("button", { name: "Unmute" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("shows every created song in History, newest first", async () => {
    vi.mocked(songs.listSongs).mockResolvedValue([
      song({
        createdMs: 1000,
        request: { ...song().request, title: "Oldest" },
      }),
      song({
        id: "fedcba9876543210fedcba9876543210",
        createdMs: 3000,
        state: "failed",
        duration: null,
        audioPath: null,
        message: "This song could not be finished.",
        request: { ...song().request, title: "Newest" },
      }),
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Library/ }));
    await user.click(screen.getByRole("tab", { name: "History" }));
    const titles = screen
      .getAllByRole("button")
      .filter((b) => b.className === "song-title")
      .map((b) => b.textContent);
    expect(titles).toEqual(["Newest", "Oldest"]);
  });

  it("titles untitled songs from their first sung line", () => {
    expect(songs.displayTitle(song().request)).toBe(
      "Morning light on the window",
    );
    expect(songs.displayTitle({ ...song().request, instrumental: true })).toBe(
      "Dreamy indie pop",
    );
  });

  it("opens settings from the sidebar or the keyboard, with the AI assistant inside", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen.queryByRole("button", { name: /AI connection/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog");
    const sections = within(dialog).getByRole("navigation", {
      name: "Settings sections",
    });
    expect(
      within(sections)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Creating",
      "Storage",
      "Music models",
      "AI assistant",
      "Help & About",
    ]);
    expect(within(dialog).queryByText(/engine/i)).not.toBeInTheDocument();
    await user.click(
      within(sections).getByRole("button", { name: "AI assistant" }),
    );
    expect(
      within(dialog).getByText(/Nothing is connected to Aulo/),
    ).toBeVisible();
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    await user.keyboard("{Control>},{/Control}");
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("save to", () => {
  it("searches workspaces and creates one by name", async () => {
    vi.mocked(songs.listCollections).mockResolvedValue({
      workspaces: [
        { id: "default", name: "My Workspace", createdMs: 0, archived: false },
        { id: "rock", name: "Rock", createdMs: 1, archived: false },
      ],
      playlists: [],
    });
    vi.mocked(songs.createWorkspace).mockResolvedValue({
      id: "jazz",
      name: "Jazz",
      createdMs: 2,
      archived: false,
    });
    const user = userEvent.setup();
    render(<App />);
    const pill = await screen.findByRole("button", { name: "My Workspace" });
    await user.click(pill);
    const search = screen.getByRole("textbox", {
      name: "Search or create a workspace",
    });
    await user.type(search, "ro");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Rock0 songs",
    ]);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Rock" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Rock" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search or create a workspace" }),
      "Jazz{Enter}",
    );
    expect(songs.createWorkspace).toHaveBeenCalledWith("Jazz");
  });
});
