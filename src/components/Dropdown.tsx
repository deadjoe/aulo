import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useMenuKeys } from "../lib/menuKeys";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

/** A pill that opens a short list; `multiple` turns items into toggles. */
export default function Dropdown<T extends string>({
  label,
  icon,
  options,
  selected,
  onSelect,
  multiple = false,
  active = false,
  footer,
}: {
  label: string;
  icon?: ReactNode;
  options: DropdownOption<T>[];
  selected: T[];
  onSelect: (value: T) => void;
  multiple?: boolean;
  active?: boolean;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keys = useMenuKeys(open, setOpen, menu, trigger);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        ref={trigger}
        className={`tool-pill${active ? " selected" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={keys.onTriggerKeyDown}
      >
        {icon}
        {label}
        <ChevronDown size={15} />
      </button>
      {open && (
        <div
          className="menu menu-left"
          role="menu"
          ref={menu}
          onKeyDown={keys.onMenuKeyDown}
        >
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                role={multiple ? "menuitemcheckbox" : "menuitemradio"}
                aria-checked={checked}
                onClick={() => {
                  onSelect(option.value);
                  if (!multiple) setOpen(false);
                }}
              >
                <span className="menu-label">{option.label}</span>
                {checked && <Check size={16} />}
              </button>
            );
          })}
          {footer}
        </div>
      )}
    </div>
  );
}
