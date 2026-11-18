// The number logic of a spin button (GtkSpinButton with 0 to 4 digits, ref §3 and §10). Pure; SpinButton.tsx shows it.

/** `x` rounded to `digits` decimal places (the digits of the spin button), without the noise of floating point steps. */
export function roundTo(x: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(x * factor) / factor;
}

/** The text of a spin button for `value`: always `digits` decimal places. */
export function formatSpin(value: number, digits: number): string {
  return value.toFixed(digits);
}

const WHOLE = /^\d+$/;
const WHOLE_SIGNED = /^-?\d+$/;
const DECIMAL = /^(\d+(\.\d*)?|\.\d+)$/;
const DECIMAL_SIGNED = /^-?(\d+(\.\d*)?|\.\d+)$/;

/**
 * The number typed into a spin button, or null if it cannot be taken: GTK_UPDATE_IF_VALID, the text must be a number inside
 * [min, max], otherwise the old value comes back. Only a spin button that goes below zero takes a minus sign, and only one with
 * digits takes a decimal point; more decimals than the digits are rounded.
 */
export function parseSpinText(text: string, min: number, max: number, digits: number): number | null {
  const t = text.trim();
  const signed = min < 0;
  const pattern = digits > 0 ? (signed ? DECIMAL_SIGNED : DECIMAL) : signed ? WHOLE_SIGNED : WHOLE;
  if (!pattern.test(t)) return null;
  const value = roundTo(Number(t), digits);
  return value >= min && value <= max ? value : null;
}

/** `value` moved by `delta`, rounded to the digits and stopped at the ends of the range. */
export function stepSpin(value: number, delta: number, min: number, max: number, digits: number): number {
  return Math.max(min, Math.min(max, roundTo(value + delta, digits)));
}
