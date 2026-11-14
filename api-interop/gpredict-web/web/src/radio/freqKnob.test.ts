import { describe, expect, it } from "vitest";
import { FREQ_MAX_HZ, freqApply, freqDigits, freqStep, freqText, groupSeparator } from "./freqKnob";

describe("freqDigits", () => {
  it("ten digits with blanks", () => {
    expect(freqDigits(145890000)).toEqual([" ", "1", "4", "5", "8", "9", "0", "0", "0", "0"]);
  });

  it("zero keeps its last digit and a full value has no blank", () => {
    expect(freqDigits(0)).toEqual([" ", " ", " ", " ", " ", " ", " ", " ", " ", "0"]);
    expect(freqDigits(FREQ_MAX_HZ)).toEqual(Array(10).fill("9"));
  });

  it("takes the absolute value and rounds like %10.0f", () => {
    expect(freqDigits(-145890000)).toEqual(freqDigits(145890000));
    expect(freqDigits(145890000.4)).toEqual(freqDigits(145890000));
    expect(freqDigits(145890000.6)).toEqual(freqDigits(145890001));
  });
});

describe("freqText", () => {
  it("no separator after the GHz digit", () => {
    expect(freqText(1435000000, ",")).toBe("1435,000,000 Hz");
    expect(freqText(145890000, ",")).toBe(" 145,890,000 Hz");
  });

  it("an empty separator (the C locale) leaves the digits together", () => {
    expect(freqText(145890000, "")).toBe(" 145890000 Hz");
  });

  it("the separators stay where they are when the leading digits are blank", () => {
    expect(freqText(0, ",")).toBe("    ,   ,  0 Hz");
  });
});

describe("groupSeparator", () => {
  it("separator from the locale", () => {
    expect(groupSeparator("de-DE")).toBe(".");
    expect(groupSeparator("en-US")).toBe(",");
  });

  it("the default locale gives a string", () => {
    expect(typeof groupSeparator()).toBe("string");
  });
});

describe("freqStep", () => {
  it("is 10^(9 - index): 1 GHz down to 1 Hz", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(freqStep)).toEqual([1e9, 1e8, 1e7, 1e6, 1e5, 1e4, 1e3, 100, 10, 1]);
  });
});

describe("freqApply", () => {
  it("steps and range", () => {
    expect(freqApply(9_999_999_999, 9, 1)).toBeNull();
    expect(freqApply(0, 0, -1)).toBeNull();
    expect(freqApply(145890000, 9, 1)).toBe(145890001);
  });

  it("adds or subtracts the step of the digit", () => {
    expect(freqApply(145890000, 3, 1)).toBe(146890000);
    expect(freqApply(145890000, 3, -1)).toBe(144890000);
    expect(freqApply(145890000, 0, 1)).toBe(1145890000);
  });

  it("allows the ends of the range and refuses one step beyond", () => {
    expect(freqApply(9_999_999_998, 9, 1)).toBe(FREQ_MAX_HZ);
    expect(freqApply(1, 9, -1)).toBe(0);
    expect(freqApply(9_000_000_000, 0, 1)).toBeNull(); // 10 GHz is one digit too many
    expect(freqApply(99, 7, -1)).toBeNull(); // 99 - 100 is below zero
  });
});
