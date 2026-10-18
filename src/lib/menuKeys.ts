import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const items = (menu: HTMLElement | null) =>
  Array.from(
    menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ??
      [],
  );

/**
 * Keyboard use for a menu button and its menu: the arrow keys open the menu
 * and move between items, Home and End jump to either end, and closing the
 * menu returns focus to the button that opened it.
 */
export function useMenuKeys(
  open: boolean,
  setOpen: (open: boolean) => void,
  menu: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      items(menu.current)[0]?.focus();
    } else if (wasOpen.current) {
      const active = document.activeElement;
      // Only take focus back when it was inside the menu, not when a click moved it on.
      if (!active || active === document.body) trigger.current?.focus();
    }
    wasOpen.current = open;
  }, [open, menu, trigger]);

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };
  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items(menu.current);
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const go = (next: number) => {
      e.preventDefault();
      list[(next + list.length) % list.length].focus();
    };
    if (e.key === "ArrowDown") go(index + 1);
    else if (e.key === "ArrowUp") go(index < 0 ? -1 : index - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "Tab") setOpen(false);
  };
  return { onTriggerKeyDown, onMenuKeyDown };
}
