import { beforeEach, describe, expect, test } from "vitest";
import { describeSatellite, satelliteInfo, type CatalogEntry } from "../../src/data/catalog";
import { useScenario } from "../../src/stores/scenario";

const entry = (norad: number, flags: string[]): CatalogEntry => ({
  prn: "G01", system: "G", svn: "063", norad, block: "IIF", celestrak_name: "GPS BIIF-1 (PRN 25)",
  omm_epoch: "2026-11-10T12:00:00.000Z", age_days: 0.5, flags,
});

function open(entries: CatalogEntry[], filter?: { show_too_old?: boolean; show_no_broadcast?: boolean } | null) {
  useScenario.setState({
    catalog: new Map(entries.map((e) => [e.norad, e])),
    doc: { satellite_filter: filter, name: "E2E" } as never,
  });
}

beforeEach(() => useScenario.setState(useScenario.getInitialState(), true));

describe("satelliteInfo", () => {
  test("a no_broadcast satellite is hidden while show_no_broadcast is off and shown when it is on", () => {
    open([entry(1, ["no_broadcast"])], { show_too_old: false, show_no_broadcast: false });
    expect(satelliteInfo(1)?.hidden).toBe(true);
    open([entry(1, ["no_broadcast"])], { show_too_old: false, show_no_broadcast: true });
    expect(satelliteInfo(1)?.hidden).toBe(false);
  });

  test("a too_old satellite follows show_too_old, not show_no_broadcast", () => {
    open([entry(1, ["too_old"])], { show_too_old: false, show_no_broadcast: true });
    expect(satelliteInfo(1)?.hidden).toBe(true);
    open([entry(1, ["too_old"])], { show_too_old: true, show_no_broadcast: false });
    expect(satelliteInfo(1)?.hidden).toBe(false);
  });

  test("a satellite with both flags is hidden unless both filters are on", () => {
    const both = entry(1, ["too_old", "no_broadcast"]);
    open([both], { show_too_old: true, show_no_broadcast: false });
    expect(satelliteInfo(1)?.hidden).toBe(true);
    open([both], { show_too_old: false, show_no_broadcast: true });
    expect(satelliteInfo(1)?.hidden).toBe(true);
    open([both], { show_too_old: true, show_no_broadcast: true });
    expect(satelliteInfo(1)?.hidden).toBe(false);
  });

  test("a scenario with no satellite_filter uses the defaults (both off)", () => {
    open([entry(1, ["no_broadcast"]), entry(2, ["too_old"]), entry(3, [])], null);
    expect(satelliteInfo(1)?.hidden).toBe(true);
    expect(satelliteInfo(2)?.hidden).toBe(true);
    expect(satelliteInfo(3)?.hidden).toBe(false);
  });

  test("flags that do not hide never hide", () => {
    open([entry(1, ["stale", "unhealthy", "prn_changed", "name_mismatch"])], {});
    expect(satelliteInfo(1)?.hidden).toBe(false);
  });

  test("name_mismatch alone is not a warning, but with another flag it is", () => {
    open([entry(1, ["name_mismatch"]), entry(2, ["name_mismatch", "stale"]), entry(3, []), entry(4, ["unhealthy"])], {});
    expect(satelliteInfo(1)?.warn).toBe(false);
    expect(satelliteInfo(2)?.warn).toBe(true);
    expect(satelliteInfo(3)?.warn).toBe(false);
    expect(satelliteInfo(4)?.warn).toBe(true);
  });

  test("keeps the catalog fields and is undefined for an unknown NORAD or with nothing open", () => {
    open([entry(1, ["stale"])], {});
    expect(satelliteInfo(1)).toMatchObject({ prn: "G01", norad: 1, block: "IIF", flags: ["stale"] });
    expect(satelliteInfo(999)).toBeUndefined();
    useScenario.setState(useScenario.getInitialState(), true);
    expect(satelliteInfo(1)).toBeUndefined();
  });

  test("describeSatellite is the same rule without the store", () => {
    expect(describeSatellite(entry(1, ["too_old"]), { show_too_old: false }).hidden).toBe(true);
    expect(describeSatellite(entry(1, ["too_old"]), undefined).warn).toBe(true);
  });
});
