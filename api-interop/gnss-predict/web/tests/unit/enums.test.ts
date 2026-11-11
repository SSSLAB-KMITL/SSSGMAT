import { expect, test } from "vitest";
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
