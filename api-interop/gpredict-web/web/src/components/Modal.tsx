import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

interface Props {
  /** shown in a title bar, centred; without it the box has no title bar */
  title?: string;
  children: ReactNode;
  /** Escape was pressed while the modal is the top one (a dialog treats it as Cancel) */
  onEscape: () => void;
}

/** The modals that are open, the last is on top. Only the top one pulls the focus back and answers keys that miss its box. */
let open: readonly string[] = [];

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The controls of `box` that can take the focus now (not the ones of a page that is hidden). */
const focusables = (box: HTMLElement): HTMLElement[] =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

/**
 * A modal box (Gpredict's Preferences dialog, a message that must be answered): it covers the page (z-index 40, above the windows
 * and the popup menus, see styles.css), so nothing behind it can be pressed, the focus stays inside the box (Tab goes round), and
 * the page behind gets no keys (its shortcuts, the Escape of a window). Escape calls `onEscape`, unless a control inside has used
 * the key (`preventDefault`). A control marked `data-autofocus` gets the focus when the box opens, else the box itself; the focus
 * goes back to where it was when the box closes. FloatingWindow is for the windows that do not block the page.
 */
export function Modal({ title, children, onEscape }: Props) {
  const id = useId();
  const titleId = `${id}-title`;
  const backdrop = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  }, [onEscape]);

  // focus into the box, and back where it was when the box goes
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = box.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus({ preventScroll: true });
    return () => {
      if (before !== null && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // the focus must not leave the box: it is pulled back if something outside takes it, and a key that reaches the page while the
  // focus is outside (on a control that has vanished or been disabled, say) is answered here and never reaches the page
  useEffect(() => {
    open = [...open, id];
    const top = () => open[open.length - 1] === id;
    const outside = (target: EventTarget | null) => !(target instanceof Node && backdrop.current?.contains(target));
    const pull = (e: FocusEvent) => {
      if (top() && outside(e.target)) box.current?.focus({ preventScroll: true });
    };
    const key = (e: KeyboardEvent) => {
      if (!top() || !outside(e.target)) return;
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        escape.current();
      } else if (e.key === "Tab") {
        e.preventDefault();
        (focusables(box.current!)[0] ?? box.current)?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", pull);
    document.addEventListener("keydown", key, true);
    return () => {
      open = open.filter((m) => m !== id);
      document.removeEventListener("focusin", pull);
      document.removeEventListener("keydown", key, true);
    };
  }, [id]);

  const keydown = (e: ReactKeyboardEvent) => {
    e.stopPropagation(); // the page behind gets no key (the default of the key still happens)
    if (e.key === "Escape") {
      if (!e.defaultPrevented) {
        e.preventDefault();
        onEscape();
      }
      return;
    }
    if (e.key !== "Tab" || box.current === null) return;
    const items = focusables(box.current);
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (first === undefined || last === undefined) {
      e.preventDefault();
      box.current.focus();
    } else if (e.shiftKey && (at === first || at === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={backdrop}
      className="modal-backdrop"
      onKeyDown={keydown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault(); // a press beside the box must not take the focus out of it
      }}
    >
      <div ref={box} className="modal-box" role="dialog" aria-modal="true" aria-labelledby={title === undefined ? undefined : titleId} tabIndex={-1}>
        {title !== undefined && (
          <div id={titleId} className="modal-title">
            {title}
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
