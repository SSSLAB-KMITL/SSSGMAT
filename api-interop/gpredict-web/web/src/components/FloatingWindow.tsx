import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { centerIn, clampToViewport } from "../windowGeom";
import type { Point, Size } from "../windowGeom";

interface Props {
  /** shown in the title bar, centred */
  title: string;
  /** the close button, or Escape while this is the front window */
  onClose: () => void;
  children: ReactNode;
  /** top left corner in client px; the window is moved back inside the page if it does not fit. Default: centred */
  initialPosition?: Point;
  /** width of the window in px. Default: as wide as its content (`max-content`) */
  width?: number;
}

// ---------------------------------------------------------------- the stack of open windows (the last is in front)

let stack: readonly string[] = [];
const listeners = new Set<() => void>();

function setStack(next: readonly string[]): void {
  stack = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getStack = () => stack;

/** Windows are above the page and its overlay (z-index 10) and below a popup menu (30). */
const BASE_Z = 20;
const MAX_STACK_Z = 9;

function viewportSize(): Size {
  return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

/**
 * A window that floats inside the page (the dialogs and the Time Controller): a title bar with the title and a close
 * button, dragged by the title bar, always kept inside the page, closed by Escape when it is in front. A press on a
 * window brings it to the front. It does not block the page behind it.
 */
export function FloatingWindow({ title, onClose, children, initialPosition, width }: Props) {
  const id = useId();
  const titleId = `${id}-title`;
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // null until the window is measured (it is invisible until then, so it never flashes at the wrong place)
  const [pos, setPos] = useState<Point | null>(null);
  const windows = useSyncExternalStore(subscribe, getStack);

  const place = useCallback((wanted: Point | null) => {
    const el = box.current;
    if (el === null) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const viewport = viewportSize();
    const next = wanted === null ? centerIn(size, viewport) : clampToViewport(wanted, size, viewport);
    setPos((p) => (p !== null && p.x === next.x && p.y === next.y ? p : next));
  }, []);

  // first position
  useLayoutEffect(() => {
    place(initialPosition ?? null);
  }, []); // only the first position counts: after that the user's drag and the keep-inside effect move the window

  // then focus, once the window is visible (an element that is not visible cannot take the focus): the control marked
  // data-autofocus if the window has one, else the window itself, so that Escape and the keyboard work from it
  const focused = useRef(false);
  useEffect(() => {
    if (pos === null || focused.current) return;
    focused.current = true;
    const el = box.current;
    const target = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el;
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement) target.select();
  }, [pos]);

  // the window grew (an error line, say) or the page shrank: keep it inside
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const again = () => {
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      setPos((p) => {
        if (p === null) return p;
        const next = clampToViewport(p, size, viewportSize());
        return next.x === p.x && next.y === p.y ? p : next;
      });
    };
    const observer = new ResizeObserver(again);
    observer.observe(el);
    window.addEventListener("resize", again);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", again);
    };
  }, []);

  // in the stack from mount to unmount
  useEffect(() => {
    setStack([...stack, id]);
    return () => setStack(stack.filter((w) => w !== id));
  }, [id]);

  // Escape closes the front window only; not while a popup menu is open (Escape closes the menu first)
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (stack[stack.length - 1] !== id) return;
      if (document.querySelector(".popup-menu") !== null) return;
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [id, onClose]);

  const raise = () => {
    if (stack[stack.length - 1] !== id) setStack([...stack.filter((w) => w !== id), id]);
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") !== null) return;
    const rect = box.current?.getBoundingClientRect();
    if (rect === undefined) return;
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection while dragging
  };
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d !== null) place({ x: e.clientX - d.dx, y: e.clientY - d.dy });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const z = BASE_Z + Math.min(Math.max(windows.indexOf(id), 0), MAX_STACK_Z);

  return (
    <div
      ref={box}
      className="float-window"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: width ?? "max-content", zIndex: z, visibility: pos === null ? "hidden" : undefined }}
      onPointerDownCapture={raise}
    >
      <div
        className="float-title"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span id={titleId} className="float-title-text">
          {title}
        </span>
        <button type="button" className="button flat float-close" title="Close" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
      <div className="float-body">{children}</div>
    </div>
  );
}
