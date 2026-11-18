// The React side of what the canvas views (Map, Polar) have in common: the redraw gate, the size of the cell, the canvas
// itself and the mouse. The decisions are pure functions in canvasCommon.ts.

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { Tick } from "../types";
import { canvasPixels, clickSelection, hitTest, INITIAL_GATE, stepRefreshGate } from "./canvasCommon";
import type { RefreshGate, SatPos, Size } from "./canvasCommon";

/**
 * The tick a view draws from: it takes every `every`-th "ok" tick (the "refresh every N cycles" setting), the first one at
 * once. A tick that is not "ok" leaves the last one, and the next ok tick is taken at once. Null before the first one.
 */
export function useRefreshGate(tick: Tick | null, every: number): Tick | null {
  const [shown, setShown] = useState<Tick | null>(null);
  const gate = useRef<RefreshGate>(INITIAL_GATE);
  useEffect(() => {
    const step = stepRefreshGate(gate.current, tick, every);
    gate.current = step.gate;
    if (step.draw) setShown(tick);
  }, [tick, every]);
  return shown;
}

/** The size in CSS px of the element `ref` points at, kept up to date; 0 x 0 until it has been measured. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * Gets `canvas` ready to draw `size` CSS px: sets its size in device pixels (only when it changed, which clears it) and
 * returns its context with the device pixel ratio. Null while there is nothing to draw on (no canvas, no size, no context).
 */
export function prepareCanvas(canvas: HTMLCanvasElement | null, size: Size): { ctx: CanvasRenderingContext2D; dpr: number } | null {
  if (canvas === null || size.w === 0 || size.h === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const [dw, dh] = canvasPixels(size, dpr);
  if (canvas.width !== dw) canvas.width = dw;
  if (canvas.height !== dh) canvas.height = dh;
  const ctx = canvas.getContext("2d");
  return ctx === null ? null : { ctx, dpr };
}

/** The handlers `useCanvasMouse` gives for the canvas. */
export interface CanvasMouseHandlers {
  onMouseMove: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
  onClick: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
}

export interface CanvasMouseOptions {
  canvas: RefObject<HTMLCanvasElement | null>;
  /** where the satellites were drawn last, for hit testing */
  hits: RefObject<readonly SatPos[]>;
  /** whether the position of the mouse is wanted (the "Cursor Position" content) */
  trackCursor: boolean;
  selected: number | null;
  onSelect: (norad: number | null) => void;
  onSatContextMenu?: (norad: number, clientX: number, clientY: number) => void;
  onSatDoubleClick?: (norad: number) => void;
}

/**
 * The mouse of a canvas view (ref §5, §6).
 * - `cursor` is the mouse position over the canvas in px, null when it is not there or `trackCursor` is off; it is updated
 *   at most once per animation frame.
 * - Left click within 10 px of a satellite selects it, or unselects it if it is the selected one (the second click of a
 *   double click does not toggle again); double click calls `onSatDoubleClick`; right click calls `onSatContextMenu` with the
 *   client position (and the browser's own menu is never shown over the canvas).
 */
export function useCanvasMouse(options: CanvasMouseOptions): { cursor: { x: number; y: number } | null; handlers: CanvasMouseHandlers } {
  const { canvas, hits, trackCursor, selected, onSelect, onSatContextMenu, onSatDoubleClick } = options;
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const position = (e: { clientX: number; clientY: number }) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const satAt = (e: { clientX: number; clientY: number }): number | null => {
    const p = position(e);
    return hitTest(hits.current ?? [], p.x, p.y);
  };

  const handlers: CanvasMouseHandlers = {
    onMouseMove: (e) => {
      if (!trackCursor) return;
      pending.current = position(e);
      if (frame.current === 0) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          setCursor(pending.current);
        });
      }
    },
    onMouseLeave: () => {
      pending.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setCursor(null);
    },
    onClick: (e) => {
      const change = clickSelection(e.detail, satAt(e), selected);
      if (change !== null) onSelect(change.norad);
    },
    onDoubleClick: (e) => {
      const hit = satAt(e);
      if (hit !== null) onSatDoubleClick?.(hit);
    },
    onContextMenu: (e) => {
      e.preventDefault();
      const hit = satAt(e);
      if (hit !== null) onSatContextMenu?.(hit, e.clientX, e.clientY);
    },
  };
  return { cursor: trackCursor ? cursor : null, handlers };
}
