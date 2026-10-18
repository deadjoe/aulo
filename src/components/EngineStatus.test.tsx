// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EngineStatus from "./EngineStatus";
import { inspectEngine } from "../lib/core";

vi.mock("../lib/core", () => ({ inspectEngine: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("shows detection without claiming generation readiness", async () => {
  vi.mocked(inspectEngine).mockResolvedValue({
    state: "detected",
    generationReady: false,
    engineVersion: "1.0.10",
    device: "mps",
    message:
      "The music engine was detected. Model loading and generation still need verification.",
  });
  render(<EngineStatus />);
  expect(
    await screen.findByText(
      /Model loading and generation still need verification/,
    ),
  ).toBeVisible();
});

it("turns an IPC failure into an understandable recovery message", async () => {
  vi.mocked(inspectEngine).mockRejectedValue(new Error("internal path"));
  render(<EngineStatus />);
  expect(await screen.findByText(/Close and reopen Aulo/)).toBeVisible();
  expect(screen.queryByText(/internal path/)).not.toBeInTheDocument();
});
