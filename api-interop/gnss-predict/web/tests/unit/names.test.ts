import { describe, expect, test } from "vitest";
import { firstFreeName, isObjectName } from "../../src/api/names";

describe("firstFreeName", () => {
  test("starts at 1 and takes the first number that is free", () => {
    expect(firstFreeName("Sensor", [])).toBe("Sensor1");
    expect(firstFreeName("Sensor", ["Sensor1", "Sensor2"])).toBe("Sensor3");
    expect(firstFreeName("Sensor", ["Sensor1", "Sensor3"])).toBe("Sensor2"); // fills the first gap
  });

  test("compares without regard to case, like the server", () => {
    expect(firstFreeName("Sensor", ["sensor1", "SENSOR2"])).toBe("Sensor3");
  });

  test("names of other objects and other prefixes do not count", () => {
    expect(firstFreeName("Sensor", ["G01", "Facility1", "Sensor"])).toBe("Sensor1");
  });

  test("takes any iterable and gives a valid object name", () => {
    expect(firstFreeName("Sensor", new Set(["Sensor1"]))).toBe("Sensor2");
    expect(isObjectName(firstFreeName("Sensor", []))).toBe(true);
  });
});
