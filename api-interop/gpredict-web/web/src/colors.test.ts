import { describe, expect, it } from "vitest";
import { coloursOf, cssRgba, MAP_COLORS, MAP_SHADOW_ALPHA, POLAR_COLORS } from "./colors";

describe("cssRgba", () => {
  it("turns 0xRRGGBBAA into an rgba() string", () => {
    expect(cssRgba(0xf0f000ff)).toBe("rgba(240, 240, 0, 1)");
    expect(cssRgba(0x00000060)).toBe("rgba(0, 0, 0, 0.376)");
    expect(cssRgba(0xffffff1f)).toBe("rgba(255, 255, 255, 0.122)");
    expect(cssRgba(0xff1200bb)).toBe("rgba(255, 18, 0, 0.733)");
    expect(cssRgba(0x00000000)).toBe("rgba(0, 0, 0, 0)");
  });

  it("applies a different alpha on request (the 0xDD shadow alpha)", () => {
    expect(cssRgba(0x000000ff, MAP_SHADOW_ALPHA)).toBe("rgba(0, 0, 0, 0.867)");
  });
});

describe("default colours (ref §5 and §6)", () => {
  it("Map", () => {
    expect(MAP_COLORS).toEqual({
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
    });
    expect(MAP_SHADOW_ALPHA).toBe(0xdd);
  });

  it("Polar", () => {
    expect(POLAR_COLORS).toEqual({
      background: 0xffffffff,
      axes: 0x0f0f0f7f,
      tick: 0x007f00ff,
      satellite: 0x8f0000ff,
      selected: 0xff0d0bff,
      track: 0x0000ffff,
      info: 0x00007fff,
    });
  });
});

describe("coloursOf", () => {
  it("takes the colours of the configuration and the default for a name it lacks", () => {
    const got = coloursOf(POLAR_COLORS, { background: 0x11223344, track: 0 });
    expect(got).toEqual({ ...POLAR_COLORS, background: 0x11223344, track: 0 });
  });

  it("ignores a name that is not a colour and a value that is not a number, and is a copy", () => {
    const got = coloursOf(MAP_COLORS, { grid: NaN, other: 5 } as unknown as Record<string, number>);
    expect(got).toEqual(MAP_COLORS);
    expect(got).not.toBe(MAP_COLORS);
    expect(coloursOf(MAP_COLORS, undefined)).toEqual(MAP_COLORS);
  });
});
