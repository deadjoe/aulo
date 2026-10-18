// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dropdown from "./Dropdown";

afterEach(cleanup);

describe("Dropdown", () => {
  it("works from the keyboard alone", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Dropdown
        label="Sort"
        options={[
          { value: "newest", label: "Newest" },
          { value: "oldest", label: "Oldest" },
          { value: "title", label: "Title" },
        ]}
        selected={["newest"]}
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button", { name: /Sort/ });
    button.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Newest" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Title" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Newest" })).toHaveFocus();
    await user.keyboard("{End}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("title");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.keyboard("{ArrowUp}{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
