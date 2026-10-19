// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPanel from "./SettingsPanel";
import * as models from "../lib/models";
import * as settingsApi from "../lib/settings";
import * as songs from "../lib/songs";

vi.mock("./ModelsPanel", () => ({ default: () => <p>Download panel</p> }));
vi.mock("../lib/models", async (importOriginal) => ({
  ...(await importOriginal<typeof models>()),
  desktopModelsAvailable: () => true,
  getModelStatus: vi.fn(),
  verifyModels: vi.fn().mockResolvedValue(undefined),
  removeModels: vi.fn().mockResolvedValue({ keptFolder: null }),
  openModelLicense: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof settingsApi>()),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  storageUsage: vi.fn(),
  engineMemory: vi.fn(),
  releaseEngine: vi.fn().mockResolvedValue(undefined),
  saveReport: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/songs", async (importOriginal) => ({
  ...(await importOriginal<typeof songs>()),
  appVersion: vi.fn().mockResolvedValue("0.8.0 (7db2b63)"),
  deleteSongs: vi.fn((ids: string[]) => Promise.resolve(ids)),
}));

const defaults = settingsApi.DEFAULT_SETTINGS;
const song = (id: string, trashedMs: number | null) =>
  ({ id, trashedMs, request: { title: id } }) as unknown as songs.Song;

function open(section?: Parameters<typeof SettingsPanel>[0]["initialSection"]) {
  const props = {
    songs: [song("a", null), song("b", 5), song("c", 6)],
    onClose: vi.fn(),
    onDeleted: vi.fn(),
    onSettingsChanged: vi.fn(),
    notify: vi.fn(),
    warn: vi.fn(),
  };
  render(<SettingsPanel {...props} initialSection={section} />);
  return props;
}

beforeEach(() => {
  vi.mocked(settingsApi.getSettings).mockResolvedValue(defaults);
  vi.mocked(settingsApi.updateSettings).mockImplementation((s) =>
    Promise.resolve(s),
  );
  vi.mocked(settingsApi.engineMemory).mockResolvedValue({
    loaded: false,
    busy: false,
  });
  vi.mocked(settingsApi.storageUsage).mockResolvedValue({
    songs: 1,
    songsBytes: 48_000_000,
    trash: 2,
    trashBytes: 95_000_000,
    modelsBytes: 7_790_000_000,
    modelsElsewhere: false,
    freeBytes: 5_000_000_000,
  });
  vi.mocked(models.getModelStatus).mockResolvedValue({
    phase: "verified",
    operation: null,
    completedBytes: 1,
    totalBytes: 1,
    currentFile: null,
    message: "Music models are ready.",
    modelRoot: "/data/models/yue2",
    modelsVerified: true,
    runtimeState: "not_bundled",
    generationReady: false,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Settings › Creating", () => {
  it("saves a choice at once and puts it back if it can’t be saved", async () => {
    const user = userEvent.setup();
    const props = open();
    const toggle = await screen.findByRole("switch", {
      name: "Tell me when a song is ready",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Start faster" }));
    expect(settingsApi.updateSettings).toHaveBeenCalledWith({
      ...defaults,
      keepReady: "faster",
    });
    expect(props.onSettingsChanged).toHaveBeenCalledWith({
      ...defaults,
      keepReady: "faster",
    });
    expect(screen.getByText(/stays ready until you quit/)).toBeVisible();

    vi.mocked(settingsApi.updateSettings).mockRejectedValueOnce(
      "Aulo couldn’t save your settings.",
    );
    await user.click(toggle);
    expect(await screen.findByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(props.warn).toHaveBeenCalledWith(
      "Aulo couldn’t save your settings.",
    );
  });

  it("offers to free memory only while it is held and no song is being made", async () => {
    vi.mocked(settingsApi.engineMemory).mockResolvedValue({
      loaded: true,
      busy: true,
    });
    open();
    await screen.findByRole("switch");
    expect(
      screen.queryByRole("button", { name: "Free up memory now" }),
    ).not.toBeInTheDocument();
    cleanup();
    vi.mocked(settingsApi.engineMemory).mockResolvedValue({
      loaded: true,
      busy: false,
    });
    const user = userEvent.setup();
    const props = open();
    await user.click(
      await screen.findByRole("button", { name: "Free up memory now" }),
    );
    expect(settingsApi.releaseEngine).toHaveBeenCalledOnce();
    expect(props.notify).toHaveBeenCalledWith("Memory freed.");
  });
});

describe("Settings › Storage", () => {
  it("shows what Aulo uses and empties the Trash only after confirming", async () => {
    const user = userEvent.setup();
    const props = open("storage");
    expect(await screen.findByText("95 MB")).toBeVisible();
    expect(screen.getByText("7.8 GB")).toBeVisible();
    expect(screen.getByText(/Space is running low/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Empty Trash" }));
    expect(songs.deleteSongs).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText("Delete 2 songs for good?")).toBeVisible();
    await user.click(
      within(confirm).getByRole("button", { name: "Empty Trash" }),
    );
    expect(songs.deleteSongs).toHaveBeenCalledWith(["b", "c"]);
    expect(props.onDeleted).toHaveBeenCalledWith(["b", "c"]);
  });

  it("removes only the songs that were really deleted", async () => {
    vi.mocked(songs.deleteSongs).mockResolvedValueOnce(["b"]);
    const user = userEvent.setup();
    const props = open("storage");
    await user.click(
      await screen.findByRole("button", { name: "Empty Trash" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Empty Trash",
      }),
    );
    expect(props.onDeleted).toHaveBeenCalledWith(["b"]);
    expect(props.warn).toHaveBeenCalledWith(
      "1 song couldn’t be deleted. Try again.",
    );
  });

  it("turns on emptying the Trash after 30 days", async () => {
    const user = userEvent.setup();
    open("storage");
    await user.click(
      await screen.findByRole("radio", { name: "After 30 days" }),
    );
    expect(settingsApi.updateSettings).toHaveBeenCalledWith({
      ...defaults,
      emptyTrashAfterDays: 30,
    });
  });
});

describe("Settings › Music models", () => {
  it("checks or removes ready models without leaving Settings", async () => {
    const user = userEvent.setup();
    const props = open("models");
    await user.click(
      await screen.findByRole("button", { name: "Check files" }),
    );
    expect(models.verifyModels).toHaveBeenCalledWith("/data/models/yue2");
    expect(screen.getByText(/non-commercial use only/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(models.removeModels).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    expect(models.removeModels).toHaveBeenCalledOnce();
    expect(props.notify).toHaveBeenCalledWith("The music models were removed.");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("uses the download panel when the models aren’t ready", async () => {
    vi.mocked(models.getModelStatus).mockResolvedValue({
      phase: "not_started",
      operation: null,
      completedBytes: 0,
      totalBytes: 1,
      currentFile: null,
      message: "",
      modelRoot: null,
      modelsVerified: false,
      runtimeState: "not_bundled",
      generationReady: false,
    });
    open("models");
    expect(await screen.findByText("Download panel")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });
});

describe("Settings › Help & About", () => {
  it("saves a problem report where the person chooses", async () => {
    const user = userEvent.setup();
    const props = open("about");
    expect(await screen.findByText("Version 0.8.0 (7db2b63)")).toBeVisible();
    expect(
      screen.getByText(
        /none of your songs, lyrics, styles, titles or your name/,
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save report…" }));
    expect(settingsApi.saveReport).toHaveBeenCalledOnce();
    expect(props.notify).toHaveBeenCalledWith("Problem report saved.");
    // Cancelling the save window says nothing.
    vi.mocked(settingsApi.saveReport).mockResolvedValueOnce(false);
    props.notify.mockClear();
    await user.click(screen.getByRole("button", { name: "Save report…" }));
    expect(settingsApi.saveReport).toHaveBeenCalledTimes(2);
    expect(props.notify).not.toHaveBeenCalled();
  });
});
