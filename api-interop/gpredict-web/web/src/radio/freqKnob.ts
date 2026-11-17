// The number logic of Gpredict's frequency knob (GtkFreqKnob, ref-R §2.3): the ten digits, the step of each digit, the range and the text.
// Pure; FreqKnob.tsx shows it.

/** The range of the knob, 0 … 9 999 999 999 Hz (`gtk-freq-knob.c:65-71`): ten digits. The same number as the server's FREQ_MAX_HZ. */
export const FREQ_MAX_HZ = 9_999_999_999;

/** The ten digits of `hz`, from the GHz digit to the 1 Hz digit: `%10.0f` of the absolute value, leading zeros are blanks. */
export function freqDigits(hz: number): string[] {
  return Math.abs(hz).toFixed(0).padStart(10, " ").slice(0, 10).split("");
}

/** What a click, a wheel step or an arrow adds to the digit `index` (0 is the GHz digit): 10^(9 − index) Hz. */
export function freqStep(index: number): number {
  return 10 ** (9 - index);
}

/** `hz` moved one step of digit `index` up (`dir` 1) or down (-1), or null if that would leave 0 … FREQ_MAX_HZ (the step is ignored). */
export function freqApply(hz: number, index: number, dir: 1 | -1): number | null {
  const next = hz + dir * freqStep(index);
  return next >= 0 && next <= FREQ_MAX_HZ ? next : null;
}

/**
 * The thousands separator of the locale (`undefined`: the browser's). A locale without one, like Gpredict's C locale, gives "" and the
 * separators of the knob stay empty.
 */
export function groupSeparator(locale?: string): string {
  const group = new Intl.NumberFormat(locale).formatToParts(1_000_000).find((part) => part.type === "group");
  return group?.value ?? "";
}

/**
 * The knob as one line of text. There is no separator between the GHz digit and the next one: `1435,000,000 Hz`, ` 145,890,000 Hz`
 * (the blank is the GHz digit).
 */
export function freqText(hz: number, sep: string): string {
  const d = freqDigits(hz).join("");
  return `${d.slice(0, 4)}${sep}${d.slice(4, 7)}${sep}${d.slice(7)} Hz`;
}
