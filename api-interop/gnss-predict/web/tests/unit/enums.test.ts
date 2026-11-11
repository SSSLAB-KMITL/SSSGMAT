import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { SOURCES } from "../../tools/enum-sources.mjs";
import { ENUMS } from "../../src/api/enums.gen";

test("enums come from the server schema", () => {
  expect(ENUMS.LeadType).toEqual(["Time", "Percent", "Quarter", "Half", "Full", "All", "None", "One Pass", "Current Interval"]);
  expect(ENUMS.TrailType).toContain("Same As Lead");
  expect(ENUMS.Cycle).toEqual(["off", "stop", "loop"]);
  expect(ENUMS.UpdateMode).toEqual(["time_step", "real_time", "x_real_time"]);
  expect(ENUMS.SwathOptions).toEqual(["No Graphics", "Edge Limits", "Filled Limits"]);
});

test("ENUMS has exactly the ten keys of the contract, each a non-empty list of strings", () => {
  expect(Object.keys(ENUMS).sort()).toEqual(["Cycle", "DateFormat", "LeadType", "LineStyle", "MarkerStyle", "OrbitSystem",
                                             "SwathOptions", "TrailType", "UpdateMode", "VisibleSides"]);
  for (const [name, values] of Object.entries(ENUMS)) {
    expect(values.length, name).toBeGreaterThan(0);
    expect(new Set(values).size, `${name} has duplicates`).toBe(values.length);
  }
});

test("the remaining enums carry the STK wording of the server schema", () => {
  expect(ENUMS.MarkerStyle).toEqual(["Point", "Plus", "Star", "Square", "Circle", "Diamond", "Triangle", "Cross"]);
  expect(ENUMS.LineStyle).toEqual(["Solid", "Dashed", "Dotted", "Dot Dashed", "Long Dashed", "Dash Dot Dot", "Medium Dashed", "Short Dashed"]);
  expect(ENUMS.VisibleSides).toEqual(["Both", "Ascending", "Descending"]);
  expect(ENUMS.OrbitSystem).toEqual(["Fixed by Window", "Inertial by Window"]);
  expect(ENUMS.DateFormat).toEqual(["UTCG", "LTZG"]);
});

// ---- ENUMS ตรงกับ src/api/openapi.json (ไม่ต้องใช้ Python): ตรวจว่า enums.gen.ts ไม่ล้าหลัง schema ที่ commit ไว้ ----

type Schema = { enum?: string[]; anyOf?: Schema[]; properties?: Record<string, Schema> };

const spec = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../src/api/openapi.json"), "utf8")) as {
  components: { schemas: Record<string, Schema> };
};

/** enum ของ property ใน components.schemas: ประกาศตรงๆ หรืออยู่ในสาขาหนึ่งของ `X | None` (anyOf) */
function enumAt(model: string, prop: string): string[] {
  const property = spec.components.schemas[model]?.properties?.[prop];
  expect(property, `${model}.${prop} exists in openapi.json`).toBeDefined();
  const found = property!.enum ? [property!.enum] : (property!.anyOf ?? []).flatMap((b) => (b.enum ? [b.enum] : []));
  expect(found, `${model}.${prop} carries exactly one enum`).toHaveLength(1);
  return found[0];
}

test("every ENUMS key is declared in the shared SOURCES table of gen-enums.mjs, and only those", () => {
  expect(Object.keys(ENUMS).sort()).toEqual(Object.keys(SOURCES).sort());
});

test.each(Object.entries(SOURCES))("ENUMS.%s equals the enum at its source property in openapi.json", (key, [model, prop, sameAs = []]) => {
  const expected = enumAt(model, prop);
  expect(ENUMS[key as keyof typeof ENUMS]).toEqual(expected);
  for (const [otherModel, otherProp] of sameAs) expect(enumAt(otherModel, otherProp), `${otherModel}.${otherProp}`).toEqual(expected);
});
