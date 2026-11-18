// What the two knobs (FreqKnob.tsx, RotKnob.tsx) share of Gpredict's mouse handling (`gtk-freq-knob.c:143-259`, `gtk-rot-knob.c:146-252`):
// the tooltip, which way a mouse button or the wheel steps, and a wheel listener that stops the page from scrolling.

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** The tooltip of every digit of an active frequency knob and of every cell of a rotator knob. */
export const KNOB_TOOLTIP = "Use mouse buttons and wheel to change value";

export type Dir = 1 | -1;

/** The step of a mouse button (`MouseEvent.button`): the left button adds, the right button subtracts, the middle button does nothing. */
export function buttonDir(button: number): Dir | 0 {
  return button === 0 ? 1 : button === 2 ? -1 : 0;
}

/** The step of a wheel event: wheel up or right adds, wheel down or left subtracts. `deltaY` is negative when the wheel turns up. */
export function wheelDir(deltaX: number, deltaY: number): Dir | 0 {
  const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : -deltaY;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** (ของเรา) A trackpad sends a wheel event every few milliseconds: at most one step in this time, so that a swipe is not 40 steps. */
const WHEEL_MIN_INTERVAL_MS = 60;

/**
 * Calls `onStep(digit, dir)` for a wheel turned over an element of `ref` with `data-digit`, and keeps the page behind it from scrolling
 * (Gpredict's handler consumes the event). The listener is not passive, which React's onWheel is, so that it can do that. Nothing is
 * listened to, and the page scrolls as usual, while `enabled` is false.
 */
export function useKnobWheel(ref: RefObject<HTMLElement | null>, enabled: boolean, onStep: (digit: number, dir: Dir) => void): void {
  const latest = useRef(onStep);
  const lastStep = useRef(-Infinity);
  useEffect(() => {
    latest.current = onStep;
  });
  useEffect(() => {
    const knob = ref.current;
    if (knob === null || !enabled) return;
    const wheel = (e: WheelEvent) => {
      const cell = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-digit]") : null;
      if (cell === null || !knob.contains(cell)) return;
      e.preventDefault();
      const dir = wheelDir(e.deltaX, e.deltaY);
      if (dir === 0 || e.timeStamp - lastStep.current < WHEEL_MIN_INTERVAL_MS) return;
      lastStep.current = e.timeStamp;
      latest.current(Number(cell.dataset.digit), dir);
    };
    knob.addEventListener("wheel", wheel, { passive: false });
    return () => knob.removeEventListener("wheel", wheel);
  }, [ref, enabled]);
}
