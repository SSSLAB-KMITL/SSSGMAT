import { describe, expect, it } from "vitest";
import { MAP_COLORS, POLAR_COLORS } from "./colors";
import {
  infoBgHex,
  joinRgba,
  MAP_COLOUR_BUTTONS,
  POLAR_COLOUR_BUTTONS,
  SHADOW_ROW,
  splitRgba,
} from "./rgba";

describe("splitRgba and joinRgba (ref-D §11: 0xRRGGBBAA, red in the top byte, alpha in the low byte)", () => {
  it("rgba round trip", () => {
    const again = (c: number) => {
      const { hex, alpha } = splitRgba(c);
      return joinRgba(hex, alpha);
    };
    expect(again(0xffffff1f)).toBe(0xffffff1f);
    for (const c of [0x00000000, 0xffffffff, 0x7f7f7fc8, 0xff1200bb, 0x0a0b0c0d, 0x80000001]) expect(again(c)).toBe(c);
  });

  it("splits into the #rrggbb of a colour input and the alpha 0-255", () => {
    expect(splitRgba(0xffffff1f)).toMatchObject({ hex: "#ffffff", alpha: 0x1f });
    expect(splitRgba(0xff1200bb)).toMatchObject({ hex: "#ff1200", alpha: 0xbb });
    expect(splitRgba(0x0a0b0c00)).toMatchObject({ hex: "#0a0b0c", alpha: 0 }); // each byte is padded to two digits
  });

  it("joins to an unsigned number whatever the top bit is", () => {
    expect(joinRgba("#ffffff", 255)).toBe(0xffffffff);
    expect(joinRgba("#800000", 1)).toBe(0x80000001);
    expect(joinRgba("#0a0b0c", 255)).toBe(0x0a0b0cff);
  });

  it("takes the hex in either case and keeps the alpha a whole number from 0 to 255", () => {
    expect(joinRgba("#ABCDEF", 0x10)).toBe(0xabcdef10);
    expect(joinRgba("#000000", -5)).toBe(0x00000000);
    expect(joinRgba("#000000", 300)).toBe(0x000000ff);
    expect(joinRgba("#000000", 12.7)).toBe(0x0000000c); // truncated, as Gpredict truncates the channels of its chooser
  });

  it("refuses a text that is not #rrggbb", () => {
    expect(() => joinRgba("red", 255)).toThrow(RangeError);
    expect(() => joinRgba("#fff", 255)).toThrow(RangeError);
  });
});

describe("infoBgHex (the info text background: no alpha, every byte two digits)", () => {
  it("info background hex is zero padded", () => {
    expect(infoBgHex(0x0a0b0cff)).toBe("#0a0b0c");
    expect(infoBgHex(0x000000ff)).toBe("#000000");
    expect(infoBgHex(0x01020300)).toBe("#010203"); // the alpha is dropped
    expect(infoBgHex(0xffffffff)).toBe("#ffffff");
  });
});

describe("the colour buttons of the Map View page (ref-D §11)", () => {
  it("map colour tooltips", () => {
    expect(MAP_COLOUR_BUTTONS.map((b) => [b.label, b.tooltip])).toEqual([
      ["Ground Station:", "Select the ground station colour"],
      ["Grid:", "Select the grid colour"],
      ["Tick Labels:", "Select a colour for tick labels"],
      ["Satellite:", "Select the satellite colour"],
      ["Selected Sat.:", "Select colour for selected satellites"],
      ["Ground Track:", "Select ground track colour"],
      ["Footprint:", "Select colour for satellite footprint area.\nHint: Make it transparent"],
      ["Info Text FG:", "Select info text foreground colour"],
      ["Info Text BG:", "Select info text background colour"],
      ["Solar terminator:", "Select solar terminator colour"],
      ["Global shadow:", "Select Earth shadow colour"],
    ]);
  });

  it("each button sets one colour of the map, and there is a button for every colour", () => {
    expect(MAP_COLOUR_BUTTONS.map((b) => b.key).sort()).toEqual(Object.keys(MAP_COLORS).sort());
    expect(MAP_COLOUR_BUTTONS.map((b) => b.key)).toEqual([
      "groundStation",
      "grid",
      "tick",
      "satellite",
      "selected",
      "track",
      "footprint",
      "infoFg",
      "infoBg",
      "terminator",
      "earthShadow",
    ]);
  });

  it("Shadow: row", () => {
    expect(SHADOW_ROW).toEqual({
      label: "Shadow:",
      low: "Transp.",
      high: "Opaque",
      tooltip:
        "Shadow transparency under the satellite marker.\n\nThe shadow improves the visibility of the satellites where the colour of the background is light, e.g. the South Pole. Fully transparent is the same as no shadow.",
    });
  });
});

describe("the colour buttons of the Polar View page (ref-D §12)", () => {
  it("labels and tooltips, in the order of the grid", () => {
    expect(POLAR_COLOUR_BUTTONS.map((b) => [b.label, b.tooltip])).toEqual([
      ["Background:", "Click to select background colour"],
      ["Axes/Circles:", "Click to select the axis colour"],
      ["Tick Labels:", "Click to select the colour for tick labels"],
      ["Satellite:", "Click to select satellite colour"],
      ["Selected Sat.:", "Click to select colour for selected satellites"],
      ["Sky Track:", "Click to select track colour"],
      ["Info Text:", "Click to select background colour"],
    ]);
  });

  it("polar info text tooltip copies background", () => {
    const [background, , , , , , info] = [...POLAR_COLOUR_BUTTONS];
    expect(info!.label).toBe("Info Text:");
    expect(info!.tooltip).toBe("Click to select background colour");
    expect(info!.tooltip).toBe(background!.tooltip);
  });

  it("there is a button for every colour", () => {
    expect(POLAR_COLOUR_BUTTONS.map((b) => b.key)).toEqual(["background", "axes", "tick", "satellite", "selected", "track", "info"]);
    expect([...POLAR_COLOUR_BUTTONS.map((b) => b.key)].sort()).toEqual(Object.keys(POLAR_COLORS).sort());
  });
});
