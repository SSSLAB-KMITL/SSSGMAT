// Maidenhead locators (ref §10, "Locator" of Edit ground station data). Pure; a port of hamlib's locator.c as Gpredict uses it
// (longlat2locator and locator2longlat with up to three pairs, the 6-character locator).

/** Characters of each pair: 18 letters (A-R), 10 digits, 24 letters (A-X). */
const RANGE = [18, 10, 24] as const;
const MAX_PAIRS = RANGE.length;
export const LOCATOR_LENGTH = MAX_PAIRS * 2;

/** hamlib adds this before cutting a coordinate into squares, so that a point on an edge falls the same way every time. */
const EDGE = 1e-6;

/**
 * The 6-character locator of a point (latitude and longitude in degrees, south and west negative): the field in capitals, the
 * subsquare in small letters, like "OK03jr" for THBK. 90 degrees north is in the top row and 180 degrees east is the meridian
 * of 180 degrees west (hamlib itself wraps 90 degrees north round to the bottom row).
 */
export function toLocator(lat: number, lon: number): string {
  const ordinate = [(((lon / 2 + 90 + EDGE) % 180) + 180) % 180, Math.min(Math.max(lat + 90 + EDGE, 0), 180 - 1e-9)] as const;
  const chars: string[] = ["", "", "", "", "", ""];
  for (const axis of [0, 1] as const) {
    let rest: number = ordinate[axis];
    let divisions = 1;
    for (let pair = 0; pair < MAX_PAIRS; pair++) {
      const range = RANGE[pair]!;
      divisions *= range;
      const size = 180 / divisions;
      const value = Math.min(Math.floor(rest / size), range - 1);
      rest -= size * value;
      chars[pair * 2 + axis] = range === 10 ? String(value) : String.fromCharCode((pair === 0 ? 65 : 97) + value);
    }
  }
  return chars.join("");
}

/** The value of a locator character in the pair `pair`, or -1 if it is not one. */
function charValue(c: string, pair: number): number {
  const range = RANGE[pair]!;
  const code = c.charCodeAt(0);
  const value = range === 10 ? code - 48 : code >= 65 && code <= 90 ? code - 65 : code - 97;
  return value >= 0 && value < range && c.length === 1 ? value : -1;
}

/**
 * The centre of the square a locator names, as {lat, lon} in degrees, or null if it is not a locator. It reads 2 to 6
 * characters (an odd length counts as the whole pairs in it, like Gpredict) and ignores the case of the letters.
 */
export function tryFromLocator(locator: string): { lat: number; lon: number } | null {
  if (locator.length > LOCATOR_LENGTH) return null;
  const pairs = Math.floor(locator.length / 2);
  if (pairs < 1) return null;
  const point = [0, 0];
  for (const axis of [0, 1] as const) {
    let ordinate = -90;
    let divisions = 1;
    for (let pair = 0; pair < pairs; pair++) {
      const value = charValue(locator[pair * 2 + axis]!, pair);
      if (value < 0) return null;
      divisions *= RANGE[pair]!;
      ordinate += (value * 180) / divisions;
    }
    point[axis] = ordinate + 90 / divisions; // the centre of the square
  }
  return { lat: point[1]!, lon: point[0]! * 2 };
}

/** Like tryFromLocator, but throws a RangeError for text that is not a locator. */
export function fromLocator(locator: string): { lat: number; lon: number } {
  const point = tryFromLocator(locator);
  if (point === null) throw new RangeError(`"${locator}" is not a Maidenhead locator (2 to 6 characters, like OK03jr)`);
  return point;
}

/** What the locator entry shows as it is typed: at most 6 characters, the field in capitals and the subsquare in small letters. */
export function normalizeLocator(text: string): string {
  return [...text.slice(0, LOCATOR_LENGTH)].map((c, i) => (i < 2 ? c.toUpperCase() : i >= 4 ? c.toLowerCase() : c)).join("");
}
