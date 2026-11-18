import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { toLocator } from "../locator";
import { DEFAULT_NF, ftToM, mToFt } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import type { Qth } from "../types";
import { GENERAL_TABS } from "./generalPrefs";
import {
  altHeader,
  checkStations,
  commitStations,
  deleteStation,
  GROUND_STATIONS_TAB,
  initialDraft,
  LAST_STATION_MESSAGE,
  putStation,
  setDefault,
  STATION_BUTTONS,
  stationColumns,
  stationRows,
  stationsBody,
  stationsChanged,
} from "./groundStations";
import type { StationsDraft } from "./groundStations";
import { TabError } from "./prefPlaces";

const nf = (over: Partial<NumberFormat> = {}): NumberFormat => ({ ...DEFAULT_NF, ...over });

const q = (name: string, over: Partial<Qth> = {}): Qth => ({
  name,
  description: "",
  location: `${name} city`,
  lat_deg: 10,
  lon_deg: 20,
  alt_m: 5,
  weather_station: "",
  ...over,
});

const SAMPLE = q("sample", { location: "Copenhagen, Denmark", lat_deg: 55.6167, lon_deg: 12.65, alt_m: 5, weather_station: "EKCH" });
const THBK = q("THBK", { location: "Bangkok, Thailand", lat_deg: 13.729779, lon_deg: 100.781151, alt_m: 6, weather_station: "VTBS" });
const SOUTH = q("alpha", { location: "Buenos Aires", lat_deg: -13.72979, lon_deg: -58.4, alt_m: 100 });

const draft = (stations: Qth[], def: string): StationsDraft => ({ stations, default: def });

describe("tab and buttons (ref §10)", () => {
  it("is the second tab of the General group", () => {
    expect(GROUND_STATIONS_TAB).toBe("Ground Stations");
    expect(GENERAL_TABS[1]).toBe(GROUND_STATIONS_TAB);
  });

  it("has Gpredict's buttons and tooltips, word for word", () => {
    expect(STATION_BUTTONS).toEqual({
      add: { label: "Add new", tip: "Add a new ground station to the list" },
      edit: { label: "Edit", tip: "Edit the selected ground station" },
      delete: { label: "Delete", tip: "Delete selected ground station" },
    });
  });

  it("has Gpredict's message for the last station, line breaks and all", () => {
    expect(LAST_STATION_MESSAGE).toBe(
      "Can not delete ground station!\n\n" +
        "You need to have at least one ground\n" +
        "station set up, otherwise gpredict may\n" +
        "not work properly.",
    );
  });
});

describe("the table", () => {
  it("rows sorted with formats", () => {
    const rows = stationRows(draft([THBK, SOUTH, SAMPLE], "sample"), nf());
    expect(rows.map((r) => r.name)).toEqual(["alpha", "sample", "THBK"]); // by name, not by code point (Gpredict sorts by locale)
    expect(rows[0]).toEqual({
      name: "alpha",
      location: "Buenos Aires",
      lat: "-13.7298° ", // %.4f°, and a space where N/S/E/W is off
      lon: "-58.4000° ",
      alt: "100",
      qra: toLocator(-13.72979, -58.4),
      isDefault: false,
    });
    expect(rows[1]).toMatchObject({ name: "sample", lat: "55.6167° ", lon: "12.6500° ", alt: "5", qra: toLocator(55.6167, 12.65), isDefault: true });
    expect(rows[2]!.qra).toBe("OK03jr");
  });

  it("shows N/S/E/W when it is on", () => {
    const [row] = stationRows(draft([SOUTH], "alpha"), nf({ nsew: true }));
    expect(row).toMatchObject({ lat: "13.7298°S", lon: "58.4000°W" });
  });

  it("shows the altitude in feet when Imperial is on", () => {
    const [row] = stationRows(draft([SOUTH], "alpha"), nf({ imperial: true }));
    expect(row!.alt).toBe("328"); // 100 m
    expect(stationRows(draft([SAMPLE], "sample"), nf({ imperial: true }))[0]!.alt).toBe("16"); // 5 m = 16.4 ft
  });

  it("imperial renames the Alt column", () => {
    expect(altHeader(false)).toBe("Alt\n(m)");
    expect(altHeader(true)).toBe("Alt\n(ft)");
    expect(stationColumns(false)).toEqual(["Name", "Location", "Lat", "Lon", "Alt\n(m)", "QRA", "Default"]);
    expect(stationColumns(true)).toEqual(["Name", "Location", "Lat", "Lon", "Alt\n(ft)", "QRA", "Default"]); // Lon is not renamed
  });

  it("marks exactly the default station", () => {
    const rows = stationRows(draft([SAMPLE, THBK], "THBK"), nf());
    expect(rows.map((r) => [r.name, r.isDefault])).toEqual([
      ["sample", false],
      ["THBK", true],
    ]);
  });
});

describe("the default station", () => {
  it("untick default is ignored", () => {
    const d = draft([SAMPLE, THBK], "sample");
    expect(setDefault(d, "sample")).toBe(d); // the same draft, nothing changed
  });

  it("ticking another row makes it the only default", () => {
    const d = setDefault(draft([SAMPLE, THBK], "sample"), "THBK");
    expect(d.default).toBe("THBK");
    expect(stationRows(d, nf()).filter((r) => r.isDefault).map((r) => r.name)).toEqual(["THBK"]);
  });

  it("ignores a name that is not in the list", () => {
    const d = draft([SAMPLE], "sample");
    expect(setDefault(d, "nobody")).toBe(d);
  });
});

describe("delete", () => {
  it("cannot delete the last station", () => {
    expect(deleteStation(draft([SAMPLE], "sample"), "sample")).toBe("last");
    expect(deleteStation(draft([], ""), "sample")).toBe("last"); // Gpredict counts rows, not the selection
  });

  it("removes a station that is not the default and keeps the default", () => {
    const d = deleteStation(draft([SAMPLE, THBK, SOUTH], "sample"), "THBK");
    expect(d).toEqual(draft([SAMPLE, SOUTH], "sample"));
  });

  it("deleting the default moves it to the first by name", () => {
    const d = deleteStation(draft([SAMPLE, THBK, SOUTH], "sample"), "sample");
    expect(d).toEqual(draft([THBK, SOUTH], "alpha"));
    const e = deleteStation(draft([SAMPLE, THBK], "sample"), "sample");
    expect(e).toEqual(draft([THBK], "THBK"));
  });

  it("leaves the draft alone for a name that is not there", () => {
    const d = draft([SAMPLE, THBK], "sample");
    expect(deleteStation(d, "nobody")).toBe(d);
  });
});

describe("add and edit", () => {
  it("adds a new station, never as the default, and keeps the list sorted", () => {
    const d = putStation(draft([SAMPLE, THBK], "sample"), null, SOUTH);
    expect(d.stations.map((s) => s.name)).toEqual(["alpha", "sample", "THBK"]);
    expect(d.default).toBe("sample");
  });

  it("edits a station in place", () => {
    const d = putStation(draft([SAMPLE, THBK], "sample"), "THBK", { ...THBK, description: "home" });
    expect(d.stations.find((s) => s.name === "THBK")!.description).toBe("home");
    expect(d.stations).toHaveLength(2);
  });

  it("renaming the default keeps it the default", () => {
    const d = putStation(draft([SAMPLE, THBK], "sample"), "sample", { ...SAMPLE, name: "zulu" });
    expect(d.stations.map((s) => s.name)).toEqual(["THBK", "zulu"]);
    expect(d.default).toBe("zulu");
  });

  it("renaming another station leaves the default alone", () => {
    const d = putStation(draft([SAMPLE, THBK], "sample"), "THBK", { ...THBK, name: "ZZ" });
    expect(d.default).toBe("sample");
    expect(d.stations.map((s) => s.name)).toEqual(["sample", "ZZ"]);
  });

  it("does not change the draft it was given", () => {
    const d = draft([SAMPLE, THBK], "sample");
    putStation(d, "sample", { ...SAMPLE, name: "zulu" });
    expect(d).toEqual(draft([SAMPLE, THBK], "sample"));
  });
});

describe("what the server had", () => {
  it("starts from the stations and the default of GET /api/qth, sorted", () => {
    expect(initialDraft({ qth: [THBK, SAMPLE], default: "THBK" })).toEqual(draft([SAMPLE, THBK], "THBK"));
  });

  it("takes the first station by name as the default when the server has none or names one that is not there", () => {
    expect(initialDraft({ qth: [THBK, SAMPLE], default: null }).default).toBe("sample");
    expect(initialDraft({ qth: [THBK, SAMPLE], default: "gone" }).default).toBe("sample");
    expect(initialDraft({ qth: [], default: null })).toEqual(draft([], ""));
  });

  it("reports a change only when the stations or the default differ", () => {
    const a = draft([SAMPLE, THBK], "sample");
    expect(stationsChanged(a, draft([THBK, SAMPLE], "sample"))).toBe(false); // the order is not a change
    expect(stationsChanged(a, { ...a })).toBe(false);
    expect(stationsChanged(a, draft([SAMPLE, THBK], "THBK"))).toBe(true);
    expect(stationsChanged(a, draft([SAMPLE], "sample"))).toBe(true);
    expect(stationsChanged(a, draft([SAMPLE, { ...THBK, alt_m: 7 }], "sample"))).toBe(true);
    expect(stationsChanged(a, draft([SAMPLE, { ...THBK, weather_station: "VTBD" }], "sample"))).toBe(true);
    expect(stationsChanged(a, draft([SAMPLE, { ...THBK, name: "THBK2" }], "sample"))).toBe(true);
  });

  it("a station that is edited and put back is not a change", () => {
    const a = draft([SAMPLE, THBK], "sample");
    const edited = putStation(a, "THBK", { ...THBK, description: "x" });
    expect(stationsChanged(a, edited)).toBe(true);
    expect(stationsChanged(a, putStation(edited, "THBK", THBK))).toBe(false);
  });
});

describe("what OK sends", () => {
  it("is the draft when it differs from what the server had, and nothing when it does not", () => {
    const original = draft([SAMPLE, THBK], "sample");
    const edited = setDefault(original, "THBK");
    expect(stationsBody(original, edited)).toBe(edited);
    expect(stationsBody(original, original)).toBeNull();
    expect(stationsBody(original, setDefault(edited, "sample"))).toBeNull(); // changed and changed back
  });
});

describe("feet and metres", () => {
  it("feet round trip keeps metres", () => {
    expect(ftToM(mToFt(100))).toBeCloseTo(100, 9); // not Gpredict's 99 after an integer truncation
    expect(Math.abs(ftToM(mToFt(100)) - 100)).toBeLessThan(1e-9);
  });
});

describe("checking and writing the stations (PUT /api/qth/batch)", () => {
  const d = draft([SAMPLE, THBK], "THBK");

  it("checks with a dry run of the whole draft", async () => {
    const put = vi.fn().mockResolvedValue({});
    await checkStations(d, put);
    expect(put).toHaveBeenCalledExactlyOnceWith(d, { dryRun: true });
  });

  it("writes the whole draft", async () => {
    const put = vi.fn().mockResolvedValue({});
    await commitStations(d, put);
    expect(put).toHaveBeenCalledExactlyOnceWith(d);
  });

  it("names the Ground Stations tab in the failure of the server", async () => {
    const refusal = new ApiError("QTH_INVALID", "ชื่อซ้ำ", 422, "error", "name");
    const put = vi.fn().mockRejectedValue(refusal);
    const e = await checkStations(d, put).then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(TabError);
    expect(e).toMatchObject({ tab: "Ground Stations", message: "ชื่อซ้ำ" });
    const f = await commitStations(d, put).then(
      () => null,
      (x: unknown) => x,
    );
    expect(f).toMatchObject({ tab: "Ground Stations", message: "ชื่อซ้ำ" });
  });

  it("lets a failure that is not a refusal through as it is", async () => {
    const down = new ApiError("NETWORK_ERROR", "ติดต่อ server ไม่ได้", 0);
    await expect(checkStations(d, vi.fn().mockRejectedValue(down))).rejects.toBe(down);
    await expect(commitStations(d, vi.fn().mockRejectedValue(down))).rejects.toBe(down);
  });
});
