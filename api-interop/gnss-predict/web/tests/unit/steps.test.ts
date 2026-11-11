import { describe, expect, test } from "vitest";
import { STEPS_S, formatStep, nextStep, prevStep } from "../../src/time/steps";

test("step table has the 32 STK values", () => {
  expect(STEPS_S).toHaveLength(32); expect(STEPS_S[0]).toBe(0.0001); expect(STEPS_S[31]).toBe(31536000);
});

test("step table is exactly the list in spec 6.1, strictly ascending", () => {
  expect([...STEPS_S]).toEqual([0.0001, 0.0005, 0.001, 0.005, 0.01, 0.1, 0.5, 1, 3, 5, 10, 30, 60, 180, 300, 600, 1800, 3600, 7200,
    14400, 28800, 57600, 115200, 230400, 460800, 921600, 1843200, 3686400, 7372800, 14745600, 29491200, 31536000]);
  for (let i = 1; i < STEPS_S.length; i++) expect(STEPS_S[i]).toBeGreaterThan(STEPS_S[i - 1]);
});

test("Increase from 60 three times gives 600 (manual example)", () => expect(nextStep(nextStep(nextStep(60)))).toBe(600));

test("ends clamp and off-table values snap", () => {
  expect(prevStep(0.0001)).toBe(0.0001); expect(nextStep(31536000)).toBe(31536000);
  expect(nextStep(45)).toBe(60); expect(prevStep(45)).toBe(30);
});

describe("off-table values", () => {
  test("nextStep is the smallest table value strictly above, prevStep the largest strictly below", () => {
    expect(nextStep(60)).toBe(180);
    expect(prevStep(60)).toBe(30);
    expect(nextStep(0.00001)).toBe(0.0001);
    expect(prevStep(0.00001)).toBe(0.0001);
    expect(nextStep(1e9)).toBe(31536000);
    expect(prevStep(1e9)).toBe(31536000);
    expect(nextStep(0.2)).toBe(0.5);
    expect(prevStep(0.2)).toBe(0.1);
  });
  test("walking down from the top visits every table value once", () => {
    const seen = [31536000];
    for (let s = prevStep(31536000); s !== seen[seen.length - 1]; s = prevStep(s)) seen.push(s);
    expect(seen).toEqual([...STEPS_S].reverse());
  });
});

test("step display", () => {
  expect(formatStep(60)).toBe("60.00 sec"); expect(formatStep(0.0005)).toBe("0.0005 sec"); expect(formatStep(0.01)).toBe("0.01 sec");
});

test("step display: 2 decimals from 0.01 up, 4 decimals below", () => {
  expect(formatStep(0.0001)).toBe("0.0001 sec");
  expect(formatStep(0.001)).toBe("0.0010 sec");
  expect(formatStep(0.005)).toBe("0.0050 sec");
  expect(formatStep(0.1)).toBe("0.10 sec");
  expect(formatStep(0.5)).toBe("0.50 sec");
  expect(formatStep(3600)).toBe("3600.00 sec");
  expect(formatStep(31536000)).toBe("31536000.00 sec");
});
