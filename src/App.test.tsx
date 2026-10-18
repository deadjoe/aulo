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
    trashSong: vi.fn().mockResolvedValue(undefined),
    exportSong: vi.fn().mockResolvedValue(undefined),
    revealSong: vi.fn().mockResolvedValue(undefined),
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
      "Download",
      "Show in Finder",
      "Add to queue",
      "Move to Trash",
    ]);
    await user.click(
      within(menu).getByRole("menuitem", { name: "Move to Trash" }),
    );
    expect(songs.trashSong).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
    );
    expect(await screen.findByText("Moved to the Trash.")).toBeVisible();
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
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "My workspace" })).toBeVisible();
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

  it("titles untitled songs from their first sung line", () => {
    expect(songs.displayTitle(song().request)).toBe(
      "Morning light on the window",
    );
    expect(songs.displayTitle({ ...song().request, instrumental: true })).toBe(
      "Dreamy indie pop",
    );
  });

  it("shows settings without technical controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog");
    for (const title of ["Music models", "Music engine", "Your songs"])
      expect(within(dialog).getByText(title)).toBeVisible();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps agent integration explicitly unconnected and closes dialogs with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "AI connection" }));
    expect(screen.getByText(/Nothing is connected yet/)).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI connection" })).toHaveFocus();
  });
});
