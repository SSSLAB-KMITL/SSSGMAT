import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";

/** One entry of a popup menu. */
export type MenuEntry =
  | { kind: "separator" }
  | {
      kind: "item";
      label: ReactNode;
      /** greyed out and not clickable; `title` can say why */
      disabled?: boolean;
      title?: string;
      onChoose?: () => void;
    }
  | { kind: "radio"; label: string; checked: boolean; onChoose: () => void };

interface Props {
  /** top left corner in client px; the menu moves back into the window if it does not fit */
  x: number;
  y: number;
  items: readonly MenuEntry[];
  /** `restoreFocus`: closed by Escape or by choosing an entry, so focus should go back to what opened the menu */
  onClose: (restoreFocus: boolean) => void;
  /** the element that opens the menu: a mouse press on it does not close the menu (its own click does) */
  anchor?: RefObject<HTMLElement | null>;
}

/**
 * A GTK-style popup menu at a position of the window. Closed by choosing an entry, Escape, a mouse press outside, a resize
 * or the window losing focus. Arrow keys move between the entries that can be chosen. A disabled entry keeps its tooltip.
 */
export function PopupMenu({ x, y, items, onClose, anchor }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // keep the menu inside the window
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (box === undefined) return;
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - box.width)),
      top: Math.max(0, Math.min(y, window.innerHeight - box.height)),
    });
  }, [x, y, items]);

  // the first entry that can be chosen takes the focus, for the keyboard
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, []);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || anchor?.current?.contains(target)) return;
      onClose(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(true);
    };
    const away = () => onClose(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", away);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", away);
      window.removeEventListener("resize", away);
    };
  }, [onClose, anchor]);

  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const enabled = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (enabled.length === 0) return;
    const at = enabled.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    enabled[(at + step + enabled.length) % enabled.length]?.focus();
  };

  return (
    <div
      ref={menu}
      className="popup-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top, maxHeight: `calc(100vh - ${pos.top}px - 8px)` }}
      onKeyDown={move}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} className="popup-separator" role="separator" />;
        if (item.kind === "radio") {
          return (
            <button
              key={i}
              type="button"
              role="menuitemradio"
              aria-checked={item.checked}
              className="popup-item"
              onClick={() => {
                item.onChoose();
                onClose(true);
              }}
            >
              <span className="popup-check" aria-hidden="true">
                {item.checked ? "●" : ""}
              </span>
              {item.label}
            </button>
          );
        }
        // aria-disabled and not `disabled`: a disabled button shows no tooltip in some browsers
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled === true}
            title={item.title}
            className={item.disabled ? "popup-item disabled" : "popup-item"}
            onClick={() => {
              if (item.disabled) return;
              item.onChoose?.();
              onClose(true);
            }}
          >
            <span className="popup-check" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
