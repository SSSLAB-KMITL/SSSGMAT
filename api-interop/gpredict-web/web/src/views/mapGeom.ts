// Geometry of the Map view (ref §5). Pure functions, no DOM: the web never computes orbits, only how to draw them.
//
// Conventions: latitude and longitude in degrees, a point is [lat, lon], a pixel is [x, y] with y downwards.
// The map is the equirectangular picture of the Earth shown 360 degrees wide: longitude `centerLon` is in the middle,
// so the left edge is centerLon - 180 and the right edge centerLon + 180.

import { MARKER_HALF } from "./canvasCommon";

/** Equatorial radius of the Earth in km, the value Gpredict (and the server's footprint formula) uses. */
export const EARTH_RADIUS_KM = 6378.135;

/** The solar terminator is recomputed when module time has moved this far (ref §5: every 15 s of module time). */
export const TERMINATOR_INTERVAL_S = 15;

/** Grid lines every 30 degrees: 5 horizontal (latitude) lines, and 11 vertical (longitude) ones for the default map (ref §5). */
export const GRID_LATITUDES: readonly number[] = [-60, -30, 0, 30, 60];
const GRID_STEP_DEG = 30;

/** Gap in px between a marker and its label. */
const LABEL_GAP = 2;

const DEG = Math.PI / 180;
const EDGE_EPS = 1e-9;

/** A longitude in [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Longitude minus the centre, in [-180, 180]; +-180 are kept as they are so that the edges of the map stay edges. */
function lonOffset(lon: number, centerLon: number): number {
  const d = lon - centerLon;
  if (d >= -180 - EDGE_EPS && d <= 180 + EDGE_EPS) return Math.max(-180, Math.min(180, d));
  return wrapLon(d);
}

/** x of a longitude on a map `w` px wide centred on `centerLon`, not wrapped: a longitude outside the window lands outside 0..w. */
export function lonToX(lon: number, w: number, centerLon: number): number {
  return ((lon - centerLon + 180) / 360) * w;
}

/**
 * Pixel of (lat, lon) on a map w x h px: the equator is in the middle, longitude `centerLon` is in the middle, and the left
 * edge is centerLon - 180. A longitude is wrapped into the window, so 270 and -90 are the same place.
 */
export function toXY(lat: number, lon: number, w: number, h: number, centerLon: number): [number, number] {
  return [((lonOffset(lon, centerLon) + 180) / 360) * w, ((90 - lat) / 180) * h];
}

/** The inverse of `toXY`: [lat, lon] under pixel (x, y), the longitude in [-180, 180). */
export function fromXY(x: number, y: number, w: number, h: number, centerLon: number): [number, number] {
  return [90 - (y / h) * 180, wrapLon(centerLon + (x / w) * 360 - 180)];
}

// ---------------------------------------------------------------- footprint

const RING_STEPS = 360; // one point per degree of azimuth around the sub-satellite point

/** Linear interpolation of the latitude at longitude `lon` between points a and b. */
function latBetween(a: [number, number], b: [number, number], lon: number): number {
  return a[1] === b[1] ? a[0] : a[0] + ((lon - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
}

/** Sutherland-Hodgman against one meridian: keep the part of the polygon east (or west) of `bound`. */
function clipAtLon(poly: [number, number][], bound: number, keepEast: boolean): [number, number][] {
  const out: [number, number][] = [];
  const inside = (p: [number, number]) => (keepEast ? p[1] >= bound : p[1] <= bound);
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    if (inside(cur) !== inside(prev)) out.push([latBetween(prev, cur, bound), bound]);
    if (inside(cur)) out.push(cur);
  }
  return out;
}

/**
 * The footprint (range circle) of a satellite over (lat, lon) as closed rings of [lat, lon] (first point repeated at the end).
 * `footprintKm` is the diameter of the circle on the ground, as the server sends it (ref §4, Footprint), so the angular
 * radius is footprintKm / 2 / EARTH_RADIUS_KM.
 *
 * The rings are cut at the edge of the map (longitude centerLon - 180 and centerLon + 180, default 0: the 180 degree line)
 * and every longitude lies in [centerLon - 180, centerLon + 180]:
 * - a circle that crosses the edge gives two rings, one at each side;
 * - a circle that holds a pole gives one ring that runs along the whole map and closes along the top (or bottom) edge
 *   (latitude +-90), because the pole is a line on the map.
 * Nothing for a footprint that is not a positive number.
 */
export function footprintRings(lat: number, lon: number, footprintKm: number, centerLon = 0): [number, number][][] {
  if (![lat, lon, footprintKm, centerLon].every(Number.isFinite) || footprintKm <= 0) return [];
  const rho = Math.min(footprintKm / 2 / EARTH_RADIUS_KM, Math.PI / 2 - 1e-6);
  const [sinLat, cosLat, sinRho, cosRho] = [Math.sin(lat * DEG), Math.cos(lat * DEG), Math.sin(rho), Math.cos(rho)];
  const left = centerLon - 180;
  const right = centerLon + 180;
  const lon0 = centerLon + lonOffset(lon, centerLon); // the centre of the circle, inside the window

  // the circle point by point, the longitude continuous (not wrapped); k = RING_STEPS is the first point again
  const circle: [number, number][] = [];
  let prev = 0;
  let first = 0;
  for (let k = 0; k <= RING_STEPS; k++) {
    const az = (2 * Math.PI * k) / RING_STEPS;
    const sinPhi = Math.max(-1, Math.min(1, sinLat * cosRho + cosLat * sinRho * Math.cos(az)));
    let d = Math.atan2(Math.sin(az) * sinRho * cosLat, cosRho - sinLat * sinPhi);
    if (k === 0) first = d;
    else {
      while (d - prev > Math.PI) d -= 2 * Math.PI;
      while (d - prev < -Math.PI) d += 2 * Math.PI;
    }
    prev = d;
    circle.push([Math.asin(sinPhi) / DEG, lon0 + d / DEG]);
  }
  const turns = prev - first; // 0 for a circle that holds no pole, +-2 pi for one that does
  circle.pop();

  if (Math.abs(turns) > Math.PI) {
    // holds a pole: longitude runs monotonically around once, so the circle is a function lat(lon)
    const chainOnce = turns > 0 ? circle : circle.reverse();
    const strip: [number, number][] = [];
    for (let turn = -2; turn <= 2; turn++) for (const p of chainOnce) strip.push([p[0], p[1] + 360 * turn]);
    const latAt = (x: number): number => {
      for (let i = 0; i + 1 < strip.length; i++) {
        const [a, b] = [strip[i]!, strip[i + 1]!];
        if (a[1] <= x && x <= b[1]) return latBetween(a, b, x);
      }
      return strip[0]![0];
    };
    const chain: [number, number][] = [[latAt(left), left]];
    for (const p of strip) if (p[1] > left && p[1] < right) chain.push(p);
    chain.push([latAt(right), right]);
    const poleLat = lat >= 0 ? 90 : -90;
    return [[...chain, [poleLat, right], [poleLat, left], chain[0]!]];
  }

  // holds no pole: the circle is a closed curve less than 180 degrees wide; cut the copies of it that reach into the window
  const rings: [number, number][][] = [];
  for (const shift of [-360, 0, 360]) {
    const moved = circle.map((p): [number, number] => [p[0], p[1] + shift]);
    const piece = clipAtLon(clipAtLon(moved, left, true), right, false);
    if (piece.length >= 3) rings.push([...piece, piece[0]!]);
  }
  return rings;
}

// ---------------------------------------------------------------- night side

const MIN_DECLINATION = 1e-9; // rad: at the equinox tan(0) would divide by zero; this puts the terminator on the meridians
const NIGHT_STEP_DEG = 0.5;

/**
 * The night side of the Earth for the sub-solar point (sunLat, sunLon), as a polygon of [lat, lon].
 *
 * Longitude runs from -360 to 360 (the terminator repeats every 360 degrees), so a map centred anywhere between -180 and
 * 180 finds the whole night side inside its window, with no seam to handle. The terminator is the curve
 * lat(lon) = atan(-cos(lon - sunLon) / tan(sunLat)): every point of it is 90 degrees from the sun. The polygon is the
 * part of the plane on the far side of it from the sun: it reaches the south pole line when the sun is north of the equator
 * (the sun's declination is positive) and the north pole line when it is south. The last two points close the polygon along
 * that pole line; the others are the terminator.
 */
export function nightPolygon(sunLat: number, sunLon: number): [number, number][] {
  if (!Number.isFinite(sunLat) || !Number.isFinite(sunLon)) return [];
  let dec = sunLat * DEG;
  if (Math.abs(dec) < MIN_DECLINATION) dec = dec < 0 ? -MIN_DECLINATION : MIN_DECLINATION;
  const tanDec = Math.tan(dec);
  const polygon: [number, number][] = [];
  const steps = Math.round(720 / NIGHT_STEP_DEG);
  for (let i = 0; i <= steps; i++) {
    const lon = -360 + i * NIGHT_STEP_DEG;
    polygon.push([Math.atan(-Math.cos((lon - sunLon) * DEG) / tanDec) / DEG, lon]);
  }
  const poleLat = dec > 0 ? -90 : 90;
  polygon.push([poleLat, 360], [poleLat, -360]);
  return polygon;
}

// ---------------------------------------------------------------- lines, labels, hits, grid

/**
 * A track (the server's polylines of [lat, lon], split at 180 degrees) as polylines of pixels. A line is cut again where
 * it crosses the edge of the map, which is not at 180 when the map is centred elsewhere: two points in a row whose x
 * differs by more than half the map are on different sides. Lines of fewer than two points are dropped.
 */
export function projectLine(points: readonly (readonly [number, number])[], w: number, h: number, centerLon: number): [number, number][][] {
  const lines: [number, number][][] = [];
  let current: [number, number][] = [];
  let prevX: number | null = null;
  for (const [lat, lon] of points) {
    const p = toXY(lat, lon, w, h, centerLon);
    if (prevX !== null && Math.abs(p[0] - prevX) > w / 2) {
      lines.push(current);
      current = [];
    }
    current.push(p);
    prevX = p[0];
  }
  lines.push(current);
  return lines.filter((l) => l.length >= 2);
}

/**
 * Top-left corner of the name label of a satellite (ref §5): the label is `tw` x `th` px, the marker is at (x, y), the
 * map is `w` x `h` px. It goes below the marker, centred on it. Near the left or right edge it goes to the side of the
 * marker (right of it near the left edge, left of it near the right edge), and near the bottom edge it goes above.
 */
export function labelPos(x: number, y: number, tw: number, th: number, w: number, h: number): { x: number; y: number } {
  const clampY = (v: number) => Math.max(0, Math.min(v, h - th));
  const offset = MARKER_HALF + LABEL_GAP;
  const nearLeft = x - tw / 2 < 0;
  const nearRight = x + tw / 2 > w;
  if (nearLeft) return { x: x + offset, y: clampY(y - th / 2) };
  if (nearRight) return { x: x - offset - tw, y: clampY(y - th / 2) };
  if (y + offset + th > h) return { x: x - tw / 2, y: Math.max(0, y - offset - th) };
  return { x: x - tw / 2, y: y + offset };
}

/** Longitudes of the vertical grid lines for a map centred on `centerLon`: every 30 degrees strictly inside the window, as in the window (may be above 180). */
export function gridLongitudes(centerLon: number): number[] {
  const lons: number[] = [];
  for (let lon = Math.ceil((centerLon - 180) / GRID_STEP_DEG) * GRID_STEP_DEG; lon < centerLon + 180; lon += GRID_STEP_DEG) {
    if (lon > centerLon - 180) lons.push(lon);
  }
  return lons;
}

// ---------------------------------------------------------------- terminator

/** Whether the terminator must be computed again: there is none yet, or module time moved 15 s or more (either way) since it was. */
export function terminatorDue(lastMs: number | null, nowMs: number): boolean {
  return lastMs === null || !(Math.abs(nowMs - lastMs) < TERMINATOR_INTERVAL_S * 1000);
}
