import { describe, expect, it } from "vitest";
import { buttonDir, KNOB_TOOLTIP, wheelDir } from "./knobInput";

describe("buttonDir", () => {
  it("left adds, right subtracts, middle and the others do nothing", () => {
    expect(buttonDir(0)).toBe(1);
    expect(buttonDir(2)).toBe(-1);
    expect(buttonDir(1)).toBe(0);
    expect(buttonDir(3)).toBe(0);
    expect(buttonDir(4)).toBe(0);
  });
});

describe("wheelDir", () => {
  it("wheel up or right adds, wheel down or left subtracts", () => {
    expect(wheelDir(0, -100)).toBe(1); // deltaY < 0 is the wheel turned up
    expect(wheelDir(0, 100)).toBe(-1);
    expect(wheelDir(100, 0)).toBe(1);
    expect(wheelDir(-100, 0)).toBe(-1);
  });

  it("no movement does nothing and the larger axis wins", () => {
    expect(wheelDir(0, 0)).toBe(0);
    expect(wheelDir(10, -50)).toBe(1);
    expect(wheelDir(50, -10)).toBe(1);
    expect(wheelDir(-50, -10)).toBe(-1);
  });
});

describe("KNOB_TOOLTIP", () => {
  it("is Gpredict's tooltip", () => {
    expect(KNOB_TOOLTIP).toBe("Use mouse buttons and wheel to change value");
  });
});
