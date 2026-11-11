import { describe, expect, it } from "vitest";
import {
  canSaveQth,
  clearQthForm,
  editCoordinates,
  editLocator,
  EMPTY_QTH_FORM,
  formToQth,
  NO_CITY_LIST_TIP,
  NO_WEATHER_LIST_TIP,
  QTH_LIMITS,
  QTH_TIPS,
  qthNameError,
  qthToForm,
} from "./qthForm";
import type { Qth } from "./types";

const THBK: Qth = {
  name: "THBK",
  description: "Bangkok",
  location: "Bangkok, Thailand",
  lat_deg: 13.729779,
  lon_deg: 100.781151,
  alt_m: 6,
  weather_station: "VTBS",
};

describe("limits and tooltips (ref §10)", () => {
  it("has the limits of Gpredict's editor", () => {
    expect(QTH_LIMITS).toEqual({ name: 25, description: 256, location: 50, weather: 4, locator: 6, lat: 90, lon: 180, alt: 5000 });
  });

  it("has Gpredict's tooltips, word for word", () => {
    expect(QTH_TIPS.name).toBe("Enter a short name for this ground station, e.g. callsign.\nAllowed characters: 0..9, a..z, A..Z, - and _");
    expect(QTH_TIPS.description).toBe("Enter an optional description for this ground station.");
    expect(QTH_TIPS.location).toBe("Optional location of the ground station, e.g. Copenhagen, Denmark.");
    expect(QTH_TIPS.selectLocation).toBe("Select a location from a list");
    expect(QTH_TIPS.lat).toBe("Select the latitude of the ground station in decimal degrees.");
    expect(QTH_TIPS.lon).toBe("Select the longitude of the ground station in decimal degrees.");
    expect(QTH_TIPS.locator).toBe("Maidenhead locator grid.");
    expect(QTH_TIPS.alt).toBe("Select the altitude of the ground station in meters or feet depending on your settings");
    expect(QTH_TIPS.weather).toBe("Four letter code for weather station");
    expect(QTH_TIPS.selectWeather).toBe("Select a weather station");
  });

  it("says in Thai why the two Select buttons cannot be used (ของเรา)", () => {
    expect(NO_CITY_LIST_TIP).toMatch(/[฀-๿]/);
    expect(NO_WEATHER_LIST_TIP).toMatch(/[฀-๿]/);
  });
});

describe("qthToForm and formToQth", () => {
  it("shows a station in the north and east with the sign in North / East", () => {
    const f = qthToForm(THBK);
    expect(f).toMatchObject({
      name: "THBK",
      lat: 13.729779,
      south: false,
      lon: 100.781151,
      west: false,
      alt: 6,
      weather: "VTBS",
      locator: "OK03jr",
    });
  });

  it("shows the south and west as South / West with the number without its sign", () => {
    const f = qthToForm({ ...THBK, lat_deg: -34.6, lon_deg: -58.4 });
    expect(f).toMatchObject({ lat: 34.6, south: true, lon: 58.4, west: true });
  });

  it("rounds the altitude to metres, as Gpredict's spin button does", () => {
    expect(qthToForm({ ...THBK, alt_m: 6.4 }).alt).toBe(6);
  });

  it("gives the station back for the server, with South and West as negative degrees", () => {
    expect(formToQth(qthToForm(THBK))).toEqual({ ...THBK });
    const f = qthToForm({ ...THBK, lat_deg: -34.6, lon_deg: -58.4 });
    expect(formToQth(f)).toMatchObject({ lat_deg: -34.6, lon_deg: -58.4 });
  });

  it("starts an empty form with nothing in it, North and East", () => {
    expect(EMPTY_QTH_FORM).toEqual({
      name: "",
      description: "",
      location: "",
      lat: 0,
      south: false,
      lon: 0,
      west: false,
      alt: 0,
      weather: "",
      locator: "",
    });
  });
});

describe("the locator follows latitude and longitude (ref §10)", () => {
  it("is worked out when a coordinate changes", () => {
    const f = editCoordinates(EMPTY_QTH_FORM, { lat: 13.729779, lon: 100.781151 });
    expect(f.locator).toBe("OK03jr");
  });

  it("changes when North / South or East / West changes", () => {
    const f = editCoordinates(qthToForm(THBK), { south: true });
    expect(f.south).toBe(true);
    expect(f.locator).toBe("OH06jg");
    const g = editCoordinates(f, { south: false });
    expect(g.locator).toBe("OK03jr");
  });

  it("leaves the other fields alone", () => {
    const f = editCoordinates({ ...EMPTY_QTH_FORM, name: "X", alt: 5 }, { lon: 10 });
    expect(f).toMatchObject({ name: "X", alt: 5, lon: 10, lat: 0 });
  });
});

describe("latitude and longitude follow the locator (ref §10)", () => {
  it("takes the centre of the subsquare, to four decimals", () => {
    const f = editLocator(EMPTY_QTH_FORM, "OK03jr");
    expect(f.lat).toBeCloseTo(13.7292, 4);
    expect(f.lon).toBeCloseTo(100.7917, 4);
    expect(f.south).toBe(false);
    expect(f.west).toBe(false);
  });

  it("sets South and West for a locator in the south-west", () => {
    const f = editLocator(EMPTY_QTH_FORM, "GF05tj");
    expect(f.south).toBe(true);
    expect(f.west).toBe(true);
    expect(f.lat).toBeGreaterThan(0);
    expect(f.lon).toBeGreaterThan(0);
  });

  it("writes what is typed in the usual case and keeps six characters at most", () => {
    expect(editLocator(EMPTY_QTH_FORM, "ok03JRxx").locator).toBe("OK03jr");
  });

  it("follows a short locator by its whole pairs", () => {
    const f = editLocator(EMPTY_QTH_FORM, "ok");
    expect(f.lat).toBe(15);
    expect(f.lon).toBe(110);
    expect(f.locator).toBe("OK");
  });

  it("keeps the text but leaves the coordinates alone while it is not a locator", () => {
    const start = qthToForm(THBK);
    const f = editLocator(start, "O");
    expect(f.locator).toBe("O");
    expect(f.lat).toBe(start.lat);
    expect(f.lon).toBe(start.lon);
    const g = editLocator(start, "ZZ03");
    expect(g.locator).toBe("ZZ03");
    expect(g.lat).toBe(start.lat);
  });

  it("can be emptied", () => {
    expect(editLocator(qthToForm(THBK), "").locator).toBe("");
  });
});

describe("Clear", () => {
  it("empties every field, as Gpredict's Clear button does", () => {
    expect(clearQthForm()).toEqual(EMPTY_QTH_FORM);
  });
});

describe("OK and the name", () => {
  it("is off until a name has been entered", () => {
    expect(canSaveQth(EMPTY_QTH_FORM)).toBe(false);
    expect(canSaveQth({ ...EMPTY_QTH_FORM, name: "THBK" })).toBe(true);
  });

  it("refuses a name that is not valid", () => {
    expect(canSaveQth({ ...EMPTY_QTH_FORM, name: "a b" })).toBe(false);
    expect(canSaveQth({ ...EMPTY_QTH_FORM, name: "a".repeat(26) })).toBe(false);
  });

  it("qthNameError names the station that has the name already, ignoring case (ของเรา: Gpredict would overwrite its file without a word)", () => {
    expect(qthNameError("THBK", ["THBK", "OZ1"])).toBe("มี ground station ชื่อ THBK อยู่แล้ว");
    expect(qthNameError("thbk", ["THBK"])).toBe("มี ground station ชื่อ THBK อยู่แล้ว");
    expect(qthNameError("NEW", ["THBK"])).toBeNull();
    expect(qthNameError("", ["THBK"])).toBeNull();
  });
});
