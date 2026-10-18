// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelsPanel from "./ModelsPanel";
import * as models from "../lib/models";
import { chooseModelFolder } from "../lib/hardware";
vi.mock("../lib/models", async (original) => ({
  ...(await original<typeof import("../lib/models")>()),
  desktopModelsAvailable: vi.fn(() => true),
  getModelPlan: vi.fn(),
  getModelStatus: vi.fn(),
  downloadModels: vi.fn(),
  verifyModels: vi.fn(),
  pauseModels: vi.fn(),
  openModelLicense: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/hardware", () => ({ chooseModelFolder: vi.fn() }));
const plan: models.ModelPlan = {
  label: "Music models",
  totalBytes: 7794565436,
  requiredFreeBytes: 8331436348,
  freeBytes: 100000000000,
  destination: "/aulo/models",
  license: "CC BY-NC 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  fileCount: 17,
};
const initial: models.ModelStatus = {
  phase: "not_started",
  operation: null,
  completedBytes: 0,
  totalBytes: plan.totalBytes,
  currentFile: null,
  message: "Choose models",
  modelRoot: null,
  modelsVerified: false,
  runtimeState: "not_bundled",
  generationReady: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(models.getModelPlan).mockResolvedValue(plan);
  vi.mocked(models.getModelStatus).mockResolvedValue(initial);
  vi.mocked(chooseModelFolder).mockResolvedValue("/existing/models");
});
afterEach(cleanup);
describe("native model preparation", () => {
  it("requires explicit download consent and uses the pinned plan size", async () => {
    const user = userEvent.setup();
    render(<ModelsPanel />);
    const download = await screen.findByRole("button", {
      name: "Download music models",
    });
    expect(download).toBeDisabled();
    expect(screen.getByText("7.79 GB")).toBeVisible();
    await user.click(
      screen.getByRole("link", { name: /CC BY-NC 4.0 license/ }),
    );
    expect(models.openModelLicense).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("checkbox"));
    await user.click(download);
    expect(models.downloadModels).toHaveBeenCalledWith(true);
    expect(
      await screen.findByText(/Open the desktop app to check the music engine/),
    ).toBeVisible();
  });
  it("does not start a download when free space is insufficient", async () => {
    vi.mocked(models.getModelPlan).mockResolvedValue({
      ...plan,
      freeBytes: 100,
    });
    const user = userEvent.setup();
    render(<ModelsPanel />);
    await screen.findByRole("button", { name: "Download music models" });
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Download music models" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("enough free space");
    expect(models.downloadModels).not.toHaveBeenCalled();
  });
  it("verifies a selected folder without marking the engine ready", async () => {
    const user = userEvent.setup();
    render(<ModelsPanel />);
    await screen.findByRole("button", { name: "Download music models" });
    vi.mocked(models.getModelStatus).mockResolvedValue({
      ...initial,
      phase: "verified",
      operation: "verify",
      completedBytes: plan.totalBytes,
      modelsVerified: true,
      modelRoot: "/existing/models",
    });
    await user.click(
      screen.getByRole("button", { name: /Already have the music models/ }),
    );
    expect(models.verifyModels).toHaveBeenCalledWith("/existing/models");
    expect(await screen.findByText("Ready")).toBeVisible();
    expect(
      screen.getByText(/Open the desktop app to check the music engine/),
    ).toBeVisible();
  });
  it("keeps model import errors actionable and retries verification rather than downloading", async () => {
    vi.mocked(models.getModelStatus).mockResolvedValue({
      ...initial,
      phase: "failed",
      operation: "verify",
      modelRoot: "/existing/models",
      message: "A file does not match this model version.",
    });
    const user = userEvent.setup();
    render(<ModelsPanel />);
    await user.click(
      await screen.findByRole("button", { name: "Check the music models" }),
    );
    expect(models.verifyModels).toHaveBeenCalledWith("/existing/models");
    expect(models.downloadModels).not.toHaveBeenCalled();
  });
  it("requests pause and shows the actual persisted paused state", async () => {
    vi.mocked(models.getModelStatus).mockResolvedValue({
      ...initial,
      phase: "downloading",
      operation: "download",
      completedBytes: 1000,
    });
    const user = userEvent.setup();
    render(<ModelsPanel />);
    const pause = await screen.findByRole("button", {
      name: "Pause",
    });
    vi.mocked(models.getModelStatus).mockResolvedValue({
      ...initial,
      phase: "paused",
      operation: "download",
      completedBytes: 1000,
    });
    await user.click(pause);
    expect(models.pauseModels).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("button", { name: "Resume download" }),
    ).toBeVisible();
  });
  it("displays service errors without reporting success", async () => {
    vi.mocked(models.verifyModels).mockRejectedValue(
      "The folder is unavailable.",
    );
    const user = userEvent.setup();
    render(<ModelsPanel />);
    await user.click(
      screen.getByRole("button", { name: /Already have the music models/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The folder is unavailable.",
      ),
    );
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});
