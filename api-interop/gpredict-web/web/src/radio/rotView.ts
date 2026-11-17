// The logic of the Antenna Control window that has no DOM (ref-R §5): where the three markers of the polar plot go and what they
// look like, which controls are enabled, the title and the tooltips. RotatorControl.tsx shows it. Pure functions: nothing here
// reads the page or calls the server.

import { passPolarScene } from "../passes/passPolar";
import type { PlotSize, Segment } from "../passes/plotCommon";
import { azElToXY } from "../views/polarGeom";
import type { Orientation } from "../views/polarGeom";
import type { RotatorState } from "./types";

// ---------------------------------------------------------------- markers on the polar plot (ref-R §5.6)

/** A pixel of the plot. */
export interface XY {
  x: number;
  y: number;
}

/** Where the three markers are, in px of the plot; null where Gpredict draws nothing. */
export interface RotMarkers {
  /** the satellite: a filled square. Not shown below the horizon, or while the module has no target */
  target: XY | null;
  /** the set-point of the controller, at the values of the knobs: a circle */
  setpoint: XY | null;
  /** where the rotator is: a cross-hair. Only while engaged and without error */
  rotor: XY | null;
}

/** `Az` of a "-180...+180" rotator (`az_type` 1) is shifted by +360 before it is plotted, so that -90 is where 270 is (`gtk-rot-ctrl.c:886-895`, `:1039-1052`). */
const AZ_TYPE_180 = 1;

/** What the server shows in "Read:" when the rotator cannot be read (`rot.py` READ_ERROR). */
const READ_ERROR = "ERROR";

/**
 * The markers for `state` on a plot of `size` px, drawn as the plot is (the same centre and radius as `passPolarScene`, whose circle
 * has `r = min(width, height)/2 - 20`).
 *
 * As `gtk-polar-plot.c` draws them (`:592-635`) each marker needs Az >= 0 and El >= 0 after the shift, so a marker whose El is below the
 * horizon, or whose Az is still negative (a 0...360 rotator with a Min Az below 0), is not there. (ของเรา) That makes `setpoint` null in
 * those cases, which the brief of Task 13 did not list; the rotor is also left out when the server has nothing read (`rotor` null).
 */
export function rotMarkers(state: RotatorState, size: PlotSize, orientation: Orientation): RotMarkers {
  const { cx, cy, r } = passPolarScene(null, size, orientation, null);
  const shift = state.limits.az_type === AZ_TYPE_180;
  const place = (az: number, el: number): XY | null => {
    const shown = shift && az < 0 ? az + 360 : az;
    if (shown < 0 || el < 0) return null;
    const [x, y] = azElToXY(shown, el, cx, cy, r, orientation);
    return { x, y };
  };
  const rotor = state.rotor;
  return {
    target: state.target === null ? null : place(state.target.az, state.target.el),
    setpoint: place(state.setpoint.az, state.setpoint.el),
    rotor: rotor === null || !state.engaged || state.read.az === READ_ERROR ? null : place(rotor.az, rotor.el),
  };
}

/** The target is a filled square of 4 x 4 px (`MARKER_SIZE_HALF` 2). */
export const TARGET_SIZE = 4;

/** The set-point is a circle of 7 px radius, stroked. */
export const SETPOINT_RADIUS = 7;

/** The square of the target around its point. */
export function targetRect({ x, y }: XY): { x: number; y: number; w: number; h: number } {
  const half = TARGET_SIZE / 2;
  return { x: x - half, y: y - half, w: TARGET_SIZE, h: TARGET_SIZE };
}

/** The cross-hair of the rotor: four strokes of 10 px from 4 px to 14 px off the point, up, right, down and left. */
export function crosshair({ x, y }: XY): Segment[] {
  const [near, far] = [4, 14];
  return [
    { x1: x, y1: y - near, x2: x, y2: y - far },
    { x1: x + near, y1: y, x2: x + far, y2: y },
    { x1: x, y1: y + near, x2: x, y2: y + far },
    { x1: x - near, y1: y, x2: x - far, y2: y },
  ];
}

// ---------------------------------------------------------------- which controls can be pressed

/** Which controls of the window answer a press (the others are greyed out). */
export interface RotEnabled {
  /** the "Device:" combo: not while engaged */
  device: boolean;
  /** the "Track" toggle: not while "Monitor" is on */
  track: boolean;
  /** the "Monitor" box, as the server says: it is greyed while Track or Engage is on, but only re-evaluated when one of them is toggled (ref-R §6.1) */
  monitor: boolean;
  /** the Az and El knobs, as the server says: not while Track or Monitor is on */
  knobs: boolean;
}

export function rotEnabled(state: RotatorState): RotEnabled {
  return { device: !state.engaged, track: !state.monitor, monitor: state.monitor_enabled, knobs: state.knobs_enabled };
}

// ---------------------------------------------------------------- window

/** The title of the window (`gtk-sat-module-popup.c`): the name of the module follows the colon. */
export function rotTitle(module: string): string {
  return `Gpredict Rotator Control: ${module}`;
}

/** Gpredict's tooltips of the window, letter for letter (ref-R §5.4 and §5.5). The knob cells have KNOB_TOOLTIP (knobInput.ts). */
export const ROT_TOOLTIPS = {
  satellite: "Select target object",
  track: "Track the satellite when it is within range",
  device: "Select antenna rotator device",
  engage: "Engage the selected rotor device",
  monitor: "Monitor rotator but do not send any position commands",
  cycle: "This parameter controls the delay between commands sent to the rotator.",
  threshold:
    "This parameter sets the threshold that triggers new motion command to the rotator.\n" +
    "If the difference between the target and rotator values is smaller than the threshold, no new commands are sent",
} as const;
