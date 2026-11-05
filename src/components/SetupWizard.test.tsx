// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SetupWizard from "./SetupWizard";
import { creationStatus } from "../lib/songs";
import { getModelStatus, type ModelStatus } from "../lib/models";

vi.mock("./ModelsPanel", () => ({
  default: () => <p>Models panel</p>,
}));
vi.mock("../lib/models", () => ({
  desktopModelsAvailable: () => true,
  getModelStatus: vi.fn().mockResolvedValue({ modelsVerified: true }),
}));
vi.mock("../lib/songs", () => ({ creationStatus: vi.fn() }));

afterEach(cleanup);

describe("the last setup step", () => {
  it("never says all set while the engine is still starting, nor that the computer can't", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: false,
      blocker: "engine",
      message: "The music engine could not start.",
    });
    render(<SetupWizard onExplore={() => undefined} initialStep={2} />);
    expect(
      await screen.findByRole("heading", { name: "Getting ready…" }),
    ).toBeVisible();
    expect(screen.getByText(/starting its music engine/)).toBeVisible();
    expect(
      screen.queryByText("Aulo can’t make songs here yet"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("You’re all set")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start creating/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Look around first" }),
    ).toBeEnabled();
  });

  it("says when the computer rules creating out, even with the models ready", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: false,
      blocker: "unsupported",
      message:
        "Aulo needs a Mac with Apple silicon and at least 8 GB of memory to make music.",
    });
    render(<SetupWizard onExplore={() => undefined} initialStep={2} />);
    expect(
      await screen.findByRole("heading", {
        name: "Aulo can’t make songs here yet",
      }),
    ).toBeVisible();
    expect(screen.getByText(/at least 8 GB of memory/)).toBeVisible();
    // A download here could be the wrong set of models.
    expect(screen.queryByText("Models panel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start creating/ }),
    ).not.toBeInTheDocument();
  });

  it("offers Start creating only when everything is ready", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: true,
      blocker: "ready",
      message: "Ready to create.",
    });
    render(<SetupWizard onExplore={() => undefined} initialStep={2} />);
    expect(
      await screen.findByRole("heading", { name: "You’re all set" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Start creating/ }),
    ).toBeEnabled();
  });
  it("asks for a reinstall when part of Aulo is missing", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: false,
      blocker: "damaged",
      message: "Part of Aulo is missing. Reinstall Aulo to fix it.",
    });
    render(<SetupWizard onExplore={() => undefined} initialStep={2} />);
    expect(
      await screen.findByRole("heading", { name: "Part of Aulo is missing" }),
    ).toBeVisible();
    expect(screen.getByText(/Reinstall Aulo to fix it/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Start creating/ }),
    ).not.toBeInTheDocument();
  });
});

describe("opening Aulo again during setup", () => {
  const status = (fields: Partial<ModelStatus>) =>
    ({ modelsVerified: false, ...fields }) as ModelStatus;

  it("opens on the download that picks up by itself, not on Welcome", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: false,
      blocker: "models",
      message: "Download the music models first.",
    });
    vi.mocked(getModelStatus).mockResolvedValue(
      status({ operation: "download", phase: "downloading" }),
    );
    render(<SetupWizard onExplore={() => undefined} />);
    expect(await screen.findByText("Models panel")).toBeVisible();
  });

  it("starts on Welcome the first time", async () => {
    vi.mocked(getModelStatus).mockResolvedValue(
      status({ operation: null, phase: "not_started" }),
    );
    render(<SetupWizard onExplore={() => undefined} />);
    await vi.waitFor(() => expect(getModelStatus).toHaveBeenCalled());
    expect(
      screen.getByRole("heading", { name: "Make music on your own computer" }),
    ).toBeVisible();
    expect(screen.queryByText("Models panel")).not.toBeInTheDocument();
  });
});
