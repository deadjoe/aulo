// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SetupWizard from "./SetupWizard";
import { creationStatus, prepareEngine } from "../lib/songs";

vi.mock("./ModelsPanel", () => ({ default: () => null }));
vi.mock("../lib/models", () => ({
  desktopModelsAvailable: () => true,
  getModelStatus: vi.fn().mockResolvedValue({ modelsVerified: true }),
}));
vi.mock("../lib/songs", () => ({
  creationStatus: vi.fn(),
  prepareEngine: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

describe("the last setup step", () => {
  it("never says all set while the engine cannot create", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: false,
      blocker: "engine",
      message: "The music engine could not start.",
    });
    render(<SetupWizard onExplore={() => undefined} initialStep={2} />);
    expect(
      await screen.findByRole("heading", {
        name: "Aulo can’t make songs here yet",
      }),
    ).toBeVisible();
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
    expect(
      screen.queryByRole("button", { name: /Start creating/ }),
    ).not.toBeInTheDocument();
  });

  it("readies the models for this computer once, without calling it a problem", async () => {
    vi.mocked(creationStatus).mockResolvedValue({
      ready: false,
      blocker: "preparing",
      message: "Aulo is getting the music models ready for this computer.",
    });
    render(<SetupWizard onExplore={() => undefined} initialStep={2} />);
    expect(
      await screen.findByRole("heading", { name: "Getting ready…" }),
    ).toBeVisible();
    expect(screen.getByText(/This happens once/)).toBeVisible();
    expect(screen.queryByText(/can’t make songs/)).not.toBeInTheDocument();
    expect(prepareEngine).toHaveBeenCalledOnce();
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
});
