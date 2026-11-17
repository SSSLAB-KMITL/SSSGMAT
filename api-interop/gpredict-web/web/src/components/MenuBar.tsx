import { useCallback, useMemo, useRef, useState } from "react";
import { barMenu, MENU_TITLES } from "../menus";
import type { BarAction, MenuTitle } from "../menus";
import { toEntries } from "./menuEntries";
import { PopupMenu } from "./PopupMenu";

interface Props {
  /** an enabled item was chosen */
  onAction: (action: BarAction) => void;
}

/**
 * The menu bar (ref §1): File, Edit and Help. A click opens a menu under its title; while one is open, moving over another
 * title opens that one (as in GTK). The items and accelerators are in menus.ts; the keys themselves are handled by the page.
 */
export function MenuBar({ onAction }: Props) {
  const [shown, setShown] = useState<{ title: MenuTitle; x: number; y: number } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<MenuTitle, HTMLButtonElement>());
  const latest = useRef(onAction);
  latest.current = onAction;
  const shownTitle = useRef<MenuTitle | null>(null);
  shownTitle.current = shown?.title ?? null;

  const show = (title: MenuTitle, button: HTMLElement) => {
    const box = button.getBoundingClientRect();
    setShown({ title, x: box.left, y: box.bottom });
  };
  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus && shownTitle.current !== null) buttons.current.get(shownTitle.current)?.focus();
    setShown(null);
  }, []);
  const entries = useMemo(
    () => (shown === null ? [] : toEntries(barMenu(shown.title), (action) => latest.current(action))),
    [shown?.title],
  );

  return (
    <div className="menubar" role="menubar" ref={bar}>
      {MENU_TITLES.map((title) => (
        <button
          key={title}
          ref={(el) => {
            if (el === null) buttons.current.delete(title);
            else buttons.current.set(title, el);
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={shown?.title === title}
          className={shown?.title === title ? "button flat menubar-item open" : "button flat menubar-item"}
          onClick={(e) => (shown?.title === title ? close(false) : show(title, e.currentTarget))}
          onMouseEnter={(e) => {
            if (shown !== null && shown.title !== title) show(title, e.currentTarget);
          }}
        >
          {title}
        </button>
      ))}
      {shown !== null && <PopupMenu key={shown.title} x={shown.x} y={shown.y} items={entries} onClose={close} anchor={bar} />}
    </div>
  );
}
