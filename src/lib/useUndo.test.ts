// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUndo } from "./useUndo";

function useField(start: string) {
  const [value, setValue] = useState(start);
  return { value, ...useUndo(value, setValue) };
}

afterEach(() => vi.useRealTimers());

describe("useUndo", () => {
  it("groups typing into steps and keeps replacements separate", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useField(""));
    act(() => result.current.type("C"));
    act(() => result.current.type("Ci"));
    act(() => result.current.type("Cit"));
    vi.advanceTimersByTime(1000);
    act(() => result.current.type("City"));
    act(() => result.current.replace(""));
    expect(result.current.value).toBe("");
    act(() => result.current.undo());
    expect(result.current.value).toBe("City");
    act(() => result.current.undo());
    expect(result.current.value).toBe("Cit");
    act(() => result.current.undo());
    expect(result.current.value).toBe("");
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    act(() => result.current.redo());
    expect(result.current.value).toBe("City");
    // A new change drops what could be redone.
    act(() => result.current.replace("New"));
    expect(result.current.canRedo).toBe(false);
  });
});
