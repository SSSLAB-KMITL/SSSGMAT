// Default colours of the Map and Polar views as RGBA hex 0xRRGGBBAA, copied from the tables of the reference
// (ref §5 Map view, ref §6 Polar view; both from `sat-cfg.c`). Task 15 (Polar) uses POLAR_COLORS.

/** Map view (ref §5). `earthShadow` is the "Global shadow" colour of the night side; `tick` is read by Gpredict but aliased to `grid`. */
export const MAP_COLORS = {
  infoFg: 0x00ff00ff,
  infoBg: 0x000000ff,
  groundStation: 0x00ffffff,
  satellite: 0xf0f000ff,
  selected: 0xffffffff,
  footprint: 0xffffff1f,
  grid: 0x7f7f7fc8,
  terminator: 0xffff0080,
  earthShadow: 0x00000060,
  tick: 0x7f7f7fc8,
  track: 0xff1200bb,
} as const;

/** Alpha of the shadow behind satellite markers and names on the map ("Shadow" slider, ref §5). */
export const MAP_SHADOW_ALPHA = 0xdd;

/** Polar view (ref §6). */
export const POLAR_COLORS = {
  background: 0xffffffff,
  axes: 0x0f0f0f7f,
  tick: 0x007f00ff,
  satellite: 0x8f0000ff,
  selected: 0xff0d0bff,
  track: 0x0000ffff,
  info: 0x00007fff,
} as const;

/** A colour 0xRRGGBBAA as a CSS rgba() string; `alpha` (0-255) replaces the colour's own alpha when given. */
export function cssRgba(color: number, alpha?: number): string {
  const r = (color >>> 24) & 0xff;
  const g = (color >>> 16) & 0xff;
  const b = (color >>> 8) & 0xff;
  const a = (alpha ?? color) & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}
