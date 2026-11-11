import { describe, expect, test } from "vitest";
import { msg } from "../../src/labels/messages.th";
import { applyValues, OBJECT_SPECS, valuesFrom } from "../../src/windows/PropertiesBrowser/form";
import { parseDecimal, parseInteger } from "../../src/windows/fieldRules";

const ok = (value: number) => ({ ok: true, value });
const bad = (error: string) => ({ ok: false, error });

describe("parseDecimal", () => {
  test("reads plain, signed, fractional and exponent numbers, with the spaces around trimmed", () => {
    for (const [text, n] of [["5", 5], [" -12.5 ", -12.5], ["+.5", 0.5], ["1e3", 1000], ["7.", 7], ["0", 0]] as const) expect(parseDecimal(text), text).toEqual(ok(n));
  });

  test.each(["", " ", "abc", "1,5", "1 2", "--1", "0x10", "1e", "."])("%j is not a number", (text) => {
    expect(parseDecimal(text)).toEqual(bad(msg("props.notNumber")));
  });

  test("a number too big for a double is not finite", () => {
    expect(parseDecimal("1e999")).toEqual(bad(msg("props.notFinite")));
  });

  test("min and max are a closed range", () => {
    expect(parseDecimal("90", { min: -90, max: 90 })).toEqual(ok(90));
    expect(parseDecimal("-90", { min: -90, max: 90 })).toEqual(ok(-90));
    expect(parseDecimal("90.1", { min: -90, max: 90 })).toEqual(bad(msg("props.rangeBetween", { min: -90, max: 90 })));
    expect(parseDecimal("-91", { min: -90, max: 90 })).toEqual(bad(msg("props.rangeBetween", { min: -90, max: 90 })));
  });

  test("gt is a strict lower bound, min alone is a lower bound", () => {
    expect(parseDecimal("0", { gt: 0 })).toEqual(bad(msg("props.rangeGreater", { min: 0 })));
    expect(parseDecimal("0.001", { gt: 0 })).toEqual(ok(0.001));
    expect(parseDecimal("-1", { min: 0 })).toEqual(bad(msg("props.rangeAtLeast", { min: 0 })));
    expect(parseDecimal("0", { min: 0 })).toEqual(ok(0));
  });
});

describe("parseInteger", () => {
  test("reads whole numbers within the range", () => {
    expect(parseInteger(" 30 ", { min: 1, max: 3650 })).toEqual(ok(30));
    expect(parseInteger("1", { min: 1, max: 3650 })).toEqual(ok(1));
    expect(parseInteger("3650", { min: 1, max: 3650 })).toEqual(ok(3650));
  });

  test.each(["1.5", "1e3", "abc", "", "4 0", "9007199254740993"])("%j is not an integer", (text) => {
    expect(parseInteger(text, { min: 1, max: 999999999999999999 })).toEqual(bad(msg("form.notInteger")));
  });

  test("outside the range gives the range message, or the given text when there is no upper bound", () => {
    expect(parseInteger("0", { min: 1, max: 168 })).toEqual(bad(msg("props.rangeBetween", { min: 1, max: 168 })));
    expect(parseInteger("169", { min: 1, max: 168 })).toEqual(bad(msg("props.rangeBetween", { min: 1, max: 168 })));
    expect(parseInteger("0", { min: 1 }, "positive please")).toEqual(bad("positive please"));
  });
});

// The Properties Browser reads its number fields through the same parser (one implementation of the number grammar)
describe("the Properties Browser number fields", () => {
  const specs = OBJECT_SPECS.Facility;
  const base = { basic: { position: { type: "Geodetic", lat_deg: 10, lon_deg: 20, alt_m: 30 } }, graphics2d: {}, graphics3d: {}, constraints: {} };
  const apply = (key: string, text: string) => {
    const values = { ...valuesFrom(base, specs), [key]: text };
    return applyValues(base, values, specs).errors[key];
  };

  test("shares the messages of parseDecimal", () => {
    expect(apply("basic.position.lat_deg", "ninety")).toBe(msg("props.notNumber"));
    expect(apply("basic.position.lat_deg", "91")).toBe(msg("props.rangeBetween", { min: -90, max: 90 }));
    expect(apply("basic.position.lat_deg", "1e999")).toBe(msg("props.notFinite"));
    expect(apply("basic.position.lat_deg", "45")).toBeUndefined();
  });
});
