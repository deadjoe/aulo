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

it("reports an unsupported computer in plain language", async () => {
  vi.mocked(inspectEngine).mockResolvedValue({
    state: "unsupported",
    generationReady: false,
    engineVersion: "1.0.10",
    device: "cpu",
    backend: null,
    message:
      "The music engine started, but this computer has no supported graphics acceleration.",
  });
  render(<EngineStatus />);
  expect(
    await screen.findByText(/no supported graphics acceleration/),
  ).toBeVisible();
});

it("turns an IPC failure into an understandable recovery message", async () => {
  vi.mocked(inspectEngine).mockRejectedValue(new Error("internal path"));
  render(<EngineStatus />);
  expect(await screen.findByText(/Close and reopen Aulo/)).toBeVisible();
  expect(screen.queryByText(/internal path/)).not.toBeInTheDocument();
});
