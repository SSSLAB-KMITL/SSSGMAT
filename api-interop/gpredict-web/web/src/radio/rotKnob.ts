// The number logic of Gpredict's rotator knob (GtkRotKnob, ref-R §5.2): the digits, the steps, and the two ways a step meets the limits
// (the arrows ignore a big overshoot, the mouse clamps). Pure; RotKnob.tsx shows it.

/** What the digits add, hundreds first: ±100, ±10, ±1, ±0.1 and ±0.01 degrees. */
export const ROT_STEPS = [100, 10, 1, 0.1, 0.01] as const;

/** Where an arrow or a mouse press may overshoot a limit and still be clamped to it (`gtk-rot-knob.c:96-120`). */
const OVERSHOOT = 0.005;

/** The sign and the six characters of `v`: "-" or " ", then `%6.2f` of the absolute value, always with a point (`  5.50`, `180.00`). */
export function rotDigits(v: number): { sign: string; digits: string } {
  return { sign: v < 0 ? "-" : " ", digits: Math.abs(v).toFixed(2).padStart(6, " ").slice(0, 6) };
}

/**
 * What the cell `cell` of the display adds: the cells are the sign, the hundreds, tens and units, the decimal point, the tenths and the
 * hundredths. The sign and the point have no step: a click or a wheel step on them does nothing.
 */
export function rotCellStep(cell: number): number | null {
  return [null, ROT_STEPS[0], ROT_STEPS[1], ROT_STEPS[2], null, ROT_STEPS[3], ROT_STEPS[4]][cell] ?? null;
}

/**
 * `v` moved one `step` by an arrow button, `dir` 1 up or -1 down. A step that overshoots `min` or `max` by more than 0.005 is ignored
 * (null); a smaller overshoot gives the limit.
 */
export function rotArrow(v: number, step: number, dir: 1 | -1, min: number, max: number): number | null {
  const next = v + dir * step;
  if (dir > 0) return next <= max + OVERSHOOT ? Math.min(next, max) : null;
  return next >= min - OVERSHOOT ? Math.max(next, min) : null;
}

/** `v` moved one `step` by a mouse button or the wheel, `dir` 1 up or -1 down, and clamped to `min` … `max`. */
export function rotMouse(v: number, step: number, dir: 1 | -1, min: number, max: number): number {
  return Math.min(max, Math.max(min, v + dir * step));
}
