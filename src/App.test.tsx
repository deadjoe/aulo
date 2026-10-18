// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import SetupWizard from "./components/SetupWizard";
vi.mock("./lib/hardware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/hardware")>()),
  detectHardware: vi.fn().mockResolvedValue(null),
  chooseModelFolder: vi.fn().mockResolvedValue("/existing/models"),
}));
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
describe("first-run setup", () => {
  it("does not call browser hardware ready and offers a clearly labeled preview", async () => {
    const user = userEvent.setup();
    const explore = vi.fn();
    render(<SetupWizard onExplore={explore} />);
    await user.click(screen.getByRole("button", { name: /get started/ }));
    expect(
      await screen.findByRole("heading", {
        name: "A quick check in the desktop app",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Not installed")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /Already have the models/ }),
    );
    expect(await screen.findByText("/existing/models")).toBeVisible();
    expect(screen.getByText(/not been validated or imported/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /Preview download experience/ }),
    );
    expect(screen.getByText(/SIMULATION/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Preview paused")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    await user.click(
      screen.getByRole("button", { name: "Explore the workspace" }),
    );
    expect(explore).toHaveBeenCalledOnce();
    expect(localStorage.getItem("aulo.runtime.ready")).toBeNull();
  });
});
describe("draft workspace", () => {
  it("saves, searches, favorites, and reloads a local idea without fabricating audio", async () => {
    localStorage.setItem("aulo.explored.v1", "true");
    const user = userEvent.setup();
    const view = render(<App />);
    expect(screen.getByRole("button", { name: "Create song" })).toBeDisabled();
    await user.type(screen.getByLabelText(/SONG TITLE/), "Sunday");
    await user.type(screen.getByLabelText("Music style"), "Warm piano");
    await user.type(screen.getByLabelText("Lyrics"), "Morning light");
    await user.click(screen.getByRole("button", { name: "Save idea" }));
    expect(screen.getByText("Draft · No audio")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Favorite Sunday" }));
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    expect(
      screen.getByRole("button", { name: "Remove Sunday from favorites" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Search your music"), "nonexistent");
    expect(screen.getByText("No ideas match that search.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Variation" }));
    expect(screen.getByLabelText(/SONG TITLE/)).toHaveValue(
      "Sunday — variation",
    );
    expect(screen.getByLabelText("Lyrics")).toHaveValue("Morning light");
    view.unmount();
    render(<App />);
    expect(screen.getByText("Sunday")).toBeVisible();
    expect(screen.getByRole("button", { name: "Play audio" })).toBeDisabled();
  });
  it("keeps agent integration explicitly unconnected and closes dialogs with Escape", async () => {
    localStorage.setItem("aulo.explored.v1", "true");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "AI connection" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/No agent is connected/)).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI connection" })).toHaveFocus();
  });
});
