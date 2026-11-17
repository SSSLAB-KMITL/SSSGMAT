import { describe, expect, it } from "vitest";
import { ROT_STEPS, rotArrow, rotCellStep, rotDigits, rotMouse } from "./rotKnob";

describe("rotDigits", () => {
  it("rot digits", () => {
    expect(rotDigits(-5.5)).toEqual({ sign: "-", digits: "  5.50" });
    expect(rotDigits(180)).toEqual({ sign: " ", digits: "180.00" });
  });

  it("two decimals, always a point, blank padded to six characters", () => {
    expect(rotDigits(0)).toEqual({ sign: " ", digits: "  0.00" });
    expect(rotDigits(45.678)).toEqual({ sign: " ", digits: " 45.68" });
    expect(rotDigits(360)).toEqual({ sign: " ", digits: "360.00" });
    expect(rotDigits(-179.99)).toEqual({ sign: "-", digits: "179.99" });
  });
});

describe("ROT_STEPS", () => {
  it("are 100, 10, 1, 0.1 and 0.01", () => {
    expect(ROT_STEPS).toEqual([100, 10, 1, 0.1, 0.01]);
  });

  it("the cells are the sign, three digits, the point and two digits: the sign and the point have no step", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(rotCellStep)).toEqual([null, 100, 10, 1, null, 0.1, 0.01]);
  });
});

describe("rotArrow", () => {
  it("rot arrow ignores overshoot, clamps small", () => {
    expect(rotArrow(355, 10, 1, 0, 360)).toBeNull();
    // ref-R §5.2: more than 0.005 over the limit is ignored (359.996 + 0.01 is 0.006 over), up to 0.005 is clamped to the limit
    expect(rotArrow(359.996, 0.01, 1, 0, 360)).toBeNull();
    expect(rotArrow(359.994, 0.01, 1, 0, 360)).toBe(360);
  });

  it("the same at the lower limit", () => {
    expect(rotArrow(5, 10, -1, 0, 360)).toBeNull();
    expect(rotArrow(0.004, 0.01, -1, 0, 360)).toBeNull(); // -0.006
    expect(rotArrow(0.006, 0.01, -1, 0, 360)).toBe(0); // -0.004
  });

  it("a step inside the range is added or subtracted", () => {
    expect(rotArrow(180, 10, 1, 0, 360)).toBe(190);
    expect(rotArrow(180, 100, -1, 0, 360)).toBe(80);
    expect(rotArrow(5.5, 0.1, 1, 0, 90)).toBeCloseTo(5.6, 10);
    expect(rotArrow(5.5, 0.01, -1, 0, 90)).toBeCloseTo(5.49, 10);
  });

  it("a step to exactly the limit is allowed", () => {
    expect(rotArrow(350, 10, 1, 0, 360)).toBe(360);
    expect(rotArrow(10, 10, -1, 0, 360)).toBe(0);
  });

  it("works with a range below zero", () => {
    expect(rotArrow(-175, 10, -1, -180, 180)).toBeNull();
    expect(rotArrow(-175, 1, -1, -180, 180)).toBe(-176);
  });
});

describe("rotMouse", () => {
  it("rot mouse clamps", () => {
    expect(rotMouse(355, 10, 1, 0, 360)).toBe(360);
  });

  it("clamps at the lower limit too and steps normally inside", () => {
    expect(rotMouse(5, 10, -1, 0, 360)).toBe(0);
    expect(rotMouse(-175, 10, -1, -180, 180)).toBe(-180);
    expect(rotMouse(180, 10, 1, 0, 360)).toBe(190);
    expect(rotMouse(180, 1, -1, 0, 360)).toBe(179);
  });
});
