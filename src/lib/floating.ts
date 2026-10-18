import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

/**
 * Position an open menu against the viewport, so scrolling lists never clip it.
 * It opens below its button, or above when there is not enough room below.
 */
export function useFloating(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  estimatedHeight = 360,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const box = anchor.current!.getBoundingClientRect();
      const right = Math.max(8, window.innerWidth - box.right);
      const below = window.innerHeight - box.bottom;
      setStyle(
        below >= estimatedHeight || below >= box.top
          ? { position: "fixed", top: box.bottom + 6, right, bottom: "auto" }
          : {
              position: "fixed",
              bottom: window.innerHeight - box.top + 6,
              right,
              top: "auto",
            },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, estimatedHeight]);
  return open ? style : undefined;
}
