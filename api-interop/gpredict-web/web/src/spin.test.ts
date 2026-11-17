import { describe, expect, it } from "vitest";
import { formatSpin, parseSpinText, roundTo, stepSpin } from "./spin";

describe("roundTo", () => {
  it("rounds to the number of decimal places, away from the float noise of a step", () => {
    expect(roundTo(0.1 + 0.2, 4)).toBe(0.3);
    expect(roundTo(13.72977949, 4)).toBe(13.7298);
    expect(roundTo(12.6, 0)).toBe(13);
  });
});

describe("formatSpin", () => {
  it("shows exactly the digits of the spin button", () => {
    expect(formatSpin(13.7298, 4)).toBe("13.7298");
    expect(formatSpin(0, 4)).toBe("0.0000");
    expect(formatSpin(300, 0)).toBe("300");
    expect(formatSpin(-45, 0)).toBe("-45");
  });
});

describe("parseSpinText (GTK_UPDATE_IF_VALID: a number inside the range is taken, anything else is not)", () => {
  it("takes whole numbers", () => {
    expect(parseSpinText("300", 100, 10000, 0)).toBe(300);
    expect(parseSpinText(" 42 ", 1, 50, 0)).toBe(42);
  });

  it("takes decimals up to the digits of the spin button, rounded", () => {
    expect(parseSpinText("13.7298", 0, 90, 4)).toBe(13.7298);
    expect(parseSpinText("13.72977949", 0, 90, 4)).toBe(13.7298);
    expect(parseSpinText(".5", 0, 90, 4)).toBe(0.5);
  });

  it("refuses decimals when the spin button has none", () => {
    expect(parseSpinText("1.5", 1, 50, 0)).toBeNull();
  });

  it("takes a minus sign only where the range goes below zero", () => {
    expect(parseSpinText("-90", -180, 180, 0)).toBe(-90);
    expect(parseSpinText("-5", 0, 90, 4)).toBeNull();
  });

  it("refuses text that is not a number and numbers outside the range", () => {
    for (const text of ["", "abc", "1e3", "1,5", "--1", "12x"]) expect(parseSpinText(text, 0, 5000, 0), text).toBeNull();
    expect(parseSpinText("5001", 0, 5000, 0)).toBeNull();
    expect(parseSpinText("99", 100, 10000, 0)).toBeNull();
    expect(parseSpinText("90.0001", 0, 90, 4)).toBeNull();
  });
});

describe("stepSpin", () => {
  it("moves by the step and stops at the ends of the range", () => {
    expect(stepSpin(10, 1, 1, 50, 0)).toBe(11);
    expect(stepSpin(50, 1, 1, 50, 0)).toBe(50);
    expect(stepSpin(1, -1, 1, 50, 0)).toBe(1);
    expect(stepSpin(48, 5, 1, 50, 0)).toBe(50);
  });

  it("steps a decimal spin button without float noise", () => {
    expect(stepSpin(0.09, 0.01, 0, 90, 4)).toBe(0.1);
    expect(stepSpin(89.995, 0.01, 0, 90, 4)).toBe(90);
    expect(stepSpin(0.3, -1, 0, 90, 4)).toBe(0);
  });
});
