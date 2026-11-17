import { beforeEach, describe, expect, test } from "vitest";
import { useSelection } from "../../src/stores/selection";

beforeEach(() => useSelection.setState(useSelection.getInitialState(), true));

describe("useSelection", () => {
  test("starts with nothing selected and no cursor", () => {
    expect(useSelection.getState().activePath).toBeNull();
    expect(useSelection.getState().cursorLatLon).toBeNull();
  });

  test("select sets and clears the active path", () => {
    useSelection.getState().select("*/Satellite/G01");
    expect(useSelection.getState().activePath).toBe("*/Satellite/G01");
    useSelection.getState().select(null);
    expect(useSelection.getState().activePath).toBeNull();
  });

  test("setCursor keeps the latitude/longitude pair and clears it with null", () => {
    useSelection.getState().setCursor([13.7, 100.5]);
    expect(useSelection.getState().cursorLatLon).toEqual([13.7, 100.5]);
    useSelection.getState().setCursor(null);
    expect(useSelection.getState().cursorLatLon).toBeNull();
  });
});
