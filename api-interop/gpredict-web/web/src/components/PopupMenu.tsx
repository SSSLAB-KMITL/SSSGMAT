import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";

/** One entry of a popup menu. */
export type MenuEntry =
  | { kind: "separator" }
  | {
      kind: "item";
      label: ReactNode;
      /** accelerator written at the right, e.g. "Ctrl+N" (the page handles the key itself) */
      accel?: string;
      /** greyed out and not clickable; `title` can say why */
      disabled?: boolean;
      title?: string;
      onChoose?: () => void;
    }
  | { kind: "radio"; label: string; checked: boolean; onChoose: () => void }
  | { kind: "check"; label: ReactNode; checked: boolean; disabled?: boolean; title?: string; onChoose: () => void }
  /** opens a second menu to the right; its own entries cannot be submenus */
  | { kind: "submenu"; label: ReactNode; items: readonly MenuEntry[]; disabled?: boolean; title?: string };

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

const ENABLED = '[role^="menuitem"]:not([aria-disabled="true"])';

/** Moves the focus to the next (or previous) entry of `container` that can be chosen. */
function moveFocus(container: HTMLElement, e: ReactKeyboardEvent): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const enabled = [...container.querySelectorAll<HTMLElement>(ENABLED)];
  if (enabled.length === 0) return;
  const at = enabled.indexOf(document.activeElement as HTMLElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  enabled[(at + step + enabled.length) % enabled.length]?.focus();
}

/**
 * A GTK-style popup menu at a position of the window. Closed by choosing an entry, Escape, a mouse press outside, a resize
 * or the window losing focus. Arrow keys move between the entries that can be chosen. A disabled entry keeps its tooltip.
 * A submenu opens to the right on hover, click or ArrowRight; ArrowLeft or Escape closes just that.
 */
export function PopupMenu({ x, y, items, onClose, anchor }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const subMenu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // the open submenu: which entry, and whether the keyboard opened it (then its first entry takes the focus)
  const [sub, setSub] = useState<{ index: number; keyboard: boolean } | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);

  // keep the menu inside the window
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (box === undefined) return;
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - box.width)),
      top: Math.max(0, Math.min(y, window.innerHeight - box.height)),
    });
  }, [x, y, items]);

  // the submenu goes next to its entry: to the right, or to the left if it does not fit there
  const subIndex = sub?.index ?? null;
  useLayoutEffect(() => {
    setSubPos(null);
    if (subIndex === null) return;
    const entry = menu.current?.children[subIndex]?.getBoundingClientRect();
    const box = subMenu.current?.getBoundingClientRect();
    if (entry === undefined || box === undefined) return;
    const right = entry.right - 2;
    setSubPos({
      left: right + box.width <= window.innerWidth ? right : Math.max(0, entry.left - box.width + 2),
      top: Math.max(0, Math.min(entry.top - 4, window.innerHeight - box.height)),
    });
  }, [subIndex, pos]);

  // the first entry that can be chosen takes the focus, for the keyboard
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>(ENABLED)?.focus();
  }, []);
  useEffect(() => {
    if (sub?.keyboard && subPos !== null) subMenu.current?.querySelector<HTMLElement>(ENABLED)?.focus();
  }, [sub, subPos]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || subMenu.current?.contains(target) || anchor?.current?.contains(target)) return;
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

  const choose = (onChoose?: () => void) => {
    onChoose?.();
    onClose(true);
  };

  /** The elements of a list of entries; `main` is the menu itself, not its submenu. */
  const render = (list: readonly MenuEntry[], main: boolean): ReactNode =>
    list.map((item, i) => {
      // hovering an entry of the menu opens its submenu, or closes the one that is open
      const hover = main
        ? {
            onMouseEnter: () =>
              setSub((s) => {
                if (item.kind !== "submenu" || item.disabled) return s === null ? s : null;
                return s?.index === i ? s : { index: i, keyboard: false };
              }),
          }
        : {};
      if (item.kind === "separator") return <div key={i} className="popup-separator" role="separator" />;
      if (item.kind === "radio") {
        return (
          <button
            key={i}
            type="button"
            role="menuitemradio"
            aria-checked={item.checked}
            className="popup-item"
            onClick={() => choose(item.onChoose)}
            {...hover}
          >
            <span className="popup-check" aria-hidden="true">
              {item.checked ? "●" : ""}
            </span>
            {item.label}
          </button>
        );
      }
      if (item.kind === "check") {
        return (
          <button
            key={i}
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.checked}
            aria-disabled={item.disabled === true}
            title={item.title}
            className={item.disabled ? "popup-item disabled" : "popup-item"}
            onClick={() => {
              if (!item.disabled) choose(item.onChoose);
            }}
            {...hover}
          >
            <span className="popup-check" aria-hidden="true">
              {item.checked ? "✓" : ""}
            </span>
            {item.label}
          </button>
        );
      }
      if (item.kind === "submenu") {
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={main && sub?.index === i}
            aria-disabled={item.disabled === true}
            title={item.title}
            className={`popup-item${item.disabled ? " disabled" : ""}${main && sub?.index === i ? " open" : ""}`}
            onClick={(e) => {
              if (!item.disabled) setSub({ index: i, keyboard: e.detail === 0 });
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" && !item.disabled) {
                e.preventDefault();
                setSub({ index: i, keyboard: true });
              }
            }}
            {...hover}
          >
            <span className="popup-check" aria-hidden="true" />
            {item.label}
            <span className="popup-arrow" aria-hidden="true">
              ▸
            </span>
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
            if (!item.disabled) choose(item.onChoose);
          }}
          {...hover}
        >
          <span className="popup-check" aria-hidden="true" />
          {item.label}
          {item.accel !== undefined && <span className="popup-accel">{item.accel}</span>}
        </button>
      );
    });

  const open = sub === null ? undefined : items[sub.index];
  const subItems = open?.kind === "submenu" ? open.items : null;

  // the focus goes back to the entry that opened the submenu
  const closeSub = (e: ReactKeyboardEvent) => {
    e.stopPropagation(); // Escape closes just the submenu, not the whole menu
    (menu.current?.children[sub?.index ?? 0] as HTMLElement | undefined)?.focus();
    setSub(null);
  };

  return (
    <>
      <div
        ref={menu}
        className="popup-menu"
        role="menu"
        style={{ left: pos.left, top: pos.top, maxHeight: `calc(100vh - ${pos.top}px - 8px)` }}
        onKeyDown={(e) => moveFocus(e.currentTarget, e)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {render(items, true)}
      </div>
      {subItems !== null && (
        <div
          ref={subMenu}
          className="popup-menu popup-sub"
          role="menu"
          style={{
            left: subPos?.left ?? 0,
            top: subPos?.top ?? 0,
            maxHeight: `calc(100vh - ${subPos?.top ?? 0}px - 8px)`,
            visibility: subPos === null ? "hidden" : undefined,
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "Escape") {
              e.preventDefault();
              closeSub(e);
            } else moveFocus(e.currentTarget, e);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {render(subItems, false)}
        </div>
      )}
    </>
  );
}
