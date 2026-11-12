// แถวของ Timeline View (src/windows/TimelineView/rows.ts): ชื่อแถว สี ช่วงเวลา การดึง GET /access/intervals และ 409 RESULTS_NOT_CURRENT
// และตัวเลือกสีที่ไม่พึ่ง Cesium (src/cesium/colors.ts)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { effectiveColor, type ColorTokens } from "../../src/cesium/colors";
import { msg } from "../../src/labels/messages.th";
import type { ScenarioDoc } from "../../src/stores/scenario";
import { accessKey, fetchAccessResult, isTimelineAccess, timelineRows, type AccessResult, type IntervalsByAccess } from "../../src/windows/TimelineView/rows";
import { stubFetch } from "./helpers/fake-fetch";
import { makeDoc } from "./helpers/chrome";

const TOKENS: ColorTokens = {
  gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b",
};
const CTX = { tokens: TOKENS, prnByNorad: new Map([[40101, "G01"], [40102, "G02"], [40103, "G03"]]) };

const iv = (start: string, stop: string, maxEl = 55) => ({ start, stop, duration_s: (Date.parse(stop) - Date.parse(start)) / 1000, max_el_deg: maxEl });
const sec = (iso: string) => Date.parse(iso) / 1000;

/** THBK, Constellation GPS (G01 G02 G03), G01 มีสีของตัวเอง, G02/G03 ไม่มี (G02 อยู่ใน Constellation ที่มีสี) */
function makeScenario(accesses: object[]): ScenarioDoc {
  return makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", color: "#aabbcc", assigned_objects: ["*/Satellite/G01", "*/Satellite/G02"] },
      { class: "Satellite", name: "G01", norad: 40101, graphics2d: { inherit: false, color: "#123456" } },
      { class: "Satellite", name: "G02", norad: 40102 },
      { class: "Satellite", name: "G03", norad: 40103 },
    ] as never,
    accesses: accesses as never,
  });
}
const access = (over: object = {}) => ({
  from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true,
  graphics: { color_mode: "object", custom_color: null }, time_period: { mode: "object" }, ...over,
});
const ok = (bySat: Record<string, object[]>): AccessResult => ({ status: "ok", bySat: bySat as never });

describe("timelineRows", () => {
  test("an access THBK -> GPS with G01 in the reply gives the row THBK-To-G01 in the colour of G01", () => {
    const doc = makeScenario([access()]);
    const rows = timelineRows(doc, { [accessKey(doc.accesses![0])]: ok({ G01: [iv("2026-11-12T01:00:00.000Z", "2026-11-12T02:30:00.000Z")] }) }, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("THBK-To-G01");
    expect(rows[0].color).toBe("#123456"); // G01's own colour (Inherit from Constellation off)
    expect(rows[0].intervals).toEqual([{ start: sec("2026-11-12T01:00:00Z"), stop: sec("2026-11-12T02:30:00Z"), maxElDeg: 55 }]);
    expect(rows[0].unavailable).toBeUndefined();
  });

  test("one row per satellite of the reply, in the order of the reply, for each access in the order of the doc", () => {
    const doc = makeScenario([access(), access({ from: "*/Facility/HOME", to: ["*/Satellite/G03"], graphics: undefined })]);
    const rows = timelineRows(doc, {
      [accessKey(doc.accesses![0])]: ok({ G02: [], G01: [], G03: [] }),
      [accessKey(doc.accesses![1])]: ok({ G03: [iv("2026-11-12T03:00:00Z", "2026-11-12T03:10:00Z")] }),
    }, CTX);
    expect(rows.map((r) => r.name)).toEqual(["THBK-To-G02", "THBK-To-G01", "THBK-To-G03", "HOME-To-G03"]);
  });

  test("Use Object Colors: own colour, then the Constellation's colour, then the colour of the system", () => {
    const doc = makeScenario([access()]);
    const rows = timelineRows(doc, { [accessKey(doc.accesses![0])]: ok({ G01: [], G02: [], G03: [] }) }, CTX);
    expect(rows.map((r) => r.color)).toEqual(["#123456", "#aabbcc", TOKENS.gps]);
  });

  test("a custom colour is used for every row of the access; without a valid one the access colour is used", () => {
    const doc = makeScenario([
      access({ graphics: { color_mode: "custom", custom_color: "#AA00FF" } }),
      access({ to: ["*/Satellite/G03"], graphics: { color_mode: "custom", custom_color: null } }),
    ]);
    const rows = timelineRows(doc, {
      [accessKey(doc.accesses![0])]: ok({ G01: [], G02: [] }),
      [accessKey(doc.accesses![1])]: ok({ G03: [] }),
    }, CTX);
    expect(rows.map((r) => r.color)).toEqual(["#aa00ff", "#aa00ff", TOKENS.access]);
  });

  test("an access without graphics uses the access colour, and so does a satellite that is not in the scenario", () => {
    const doc = makeScenario([access({ graphics: null }), access({ to: ["*/Constellation/GPS", "*/Satellite/X99"] })]);
    const rows = timelineRows(doc, {
      [accessKey(doc.accesses![0])]: ok({ G01: [] }),
      [accessKey(doc.accesses![1])]: ok({ X99: [] }),
    }, CTX);
    expect(rows.map((r) => r.color)).toEqual([TOKENS.access, TOKENS.access]);
  });

  test("accesses with timeline false are not rows; a missing timeline follows the server default (shown)", () => {
    const doc = makeScenario([access({ timeline: false }), access({ from: "*/Facility/HOME", timeline: undefined })]);
    expect(doc.accesses!.map(isTimelineAccess)).toEqual([false, true]);
    const rows = timelineRows(doc, {
      [accessKey(doc.accesses![0])]: ok({ G01: [] }),
      [accessKey(doc.accesses![1])]: ok({ G02: [] }),
    }, CTX);
    expect(rows.map((r) => r.name)).toEqual(["HOME-To-G02"]);
  });

  test("a reply that has not arrived yet gives no rows", () => {
    const doc = makeScenario([access()]);
    expect(timelineRows(doc, {}, CTX)).toEqual([]);
    expect(timelineRows(null, {}, CTX)).toEqual([]);
  });

  test("409 RESULTS_NOT_CURRENT gives one empty hatched row for the access with a Thai note", () => {
    const doc = makeScenario([access(), access({ from: "*/Facility/HOME", to: ["*/Satellite/G01", "*/Satellite/G02"] })]);
    const rows = timelineRows(doc, {
      [accessKey(doc.accesses![0])]: { status: "notCurrent" },
      [accessKey(doc.accesses![1])]: { status: "notCurrent" },
    }, CTX);
    expect(rows.map((r) => r.name)).toEqual(["THBK-To-GPS", "HOME-To-G01,G02"]);
    for (const r of rows) {
      expect(r.intervals).toEqual([]);
      expect(r.unavailable).toBe("notCurrent");
      expect(r.note).toBe(msg("timeline.notCurrent"));
      expect(r.color).toBe(TOKENS.access);
    }
    expect(msg("timeline.notCurrent")).toMatch(/[฀-๿]/);
  });

  test("another failure gives the same kind of row with the failure in the note", () => {
    const doc = makeScenario([access()]);
    const rows = timelineRows(doc, { [accessKey(doc.accesses![0])]: { status: "error", message: "boom" } }, CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].unavailable).toBe("error");
    expect(rows[0].note).toContain("boom");
  });

  test("intervals are sorted by start and unreadable times are dropped", () => {
    const doc = makeScenario([access()]);
    const rows = timelineRows(doc, {
      [accessKey(doc.accesses![0])]: ok({ G01: [iv("2026-11-12T05:00:00Z", "2026-11-12T06:00:00Z"), { start: "yesterday", stop: "x" }, iv("2026-11-12T01:00:00Z", "2026-11-12T02:00:00Z")] }),
    }, CTX);
    expect(rows[0].intervals.map((i) => i.start)).toEqual([sec("2026-11-12T01:00:00Z"), sec("2026-11-12T05:00:00Z")]);
  });

  test("accessKey tells accesses apart by from and targets", () => {
    const keys = [access(), access({ to: ["*/Constellation/GLONASS"] }), access({ from: "*/Facility/HOME" })].map((a) => accessKey(a as never));
    expect(new Set(keys).size).toBe(3);
  });
});

describe("effectiveColor", () => {
  test("the colour that graphicsFor gives a satellite", () => {
    const doc = makeScenario([]);
    const sats = doc.objects.filter((o) => o.class === "Satellite");
    expect(sats.map((s) => effectiveColor(s, doc, CTX))).toEqual(["#123456", "#aabbcc", TOKENS.gps]);
  });

  test("the timeline modules and the colour module do not import Cesium", () => {
    for (const file of ["src/cesium/colors.ts", "src/windows/TimelineView/rows.ts", "src/windows/TimelineView/scale.ts"]) {
      const source = readFileSync(resolve(__dirname, "../..", file), "utf8");
      expect(source, file).not.toMatch(/from\s+["']cesium["']/);
      expect(source, file).not.toMatch(/from\s+["'](\.\.?\/)+(cesium\/)?(graphics|czml|viewer|scene3d|scene2d|passes|overlay2d|swath)["']/);
    }
  });
});

describe("fetchAccessResult", () => {
  afterEach(() => vi.unstubAllGlobals());
  const THBK_GPS = access() as never;

  test("asks for one access with from and every to, and reads the satellites of the reply", async () => {
    const reply = { G01: [iv("2026-11-12T01:00:00.000Z", "2026-11-12T02:00:00.000Z")], G02: [] };
    const { calls } = stubFetch({ "GET /api/scenarios/S1/access/intervals": { json: reply } });
    const result = await fetchAccessResult("S1", access({ to: ["*/Constellation/GPS", "*/Satellite/G03"] }) as never);
    expect(result).toEqual({ status: "ok", bySat: reply });
    expect(calls).toHaveLength(1);
    expect(calls[0].query.get("from")).toBe("*/Facility/THBK");
    expect(calls[0].query.getAll("to")).toEqual(["*/Constellation/GPS", "*/Satellite/G03"]);
  });

  test("409 RESULTS_NOT_CURRENT is notCurrent", async () => {
    stubFetch({ "GET /api/scenarios/S1/access/intervals": { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "ผลไม่ตรง", field: null, detail: null } } });
    expect(await fetchAccessResult("S1", THBK_GPS)).toEqual({ status: "notCurrent" });
  });

  test("another server answer is an error carrying the server text", async () => {
    stubFetch({ "GET /api/scenarios/S1/access/intervals": { status: 422, json: { code: "VALIDATION", text: "ไม่พบ object", field: "to", detail: null } } });
    expect(await fetchAccessResult("S1", THBK_GPS)).toEqual({ status: "error", code: "VALIDATION", message: "ไม่พบ object" });
  });

  test("a reply that is not a map of interval lists is an error", async () => {
    stubFetch({ "GET /api/scenarios/S1/access/intervals": { json: [1, 2, 3] } });
    expect((await fetchAccessResult("S1", THBK_GPS)).status).toBe("error");
  });

  test("a cancelled request is thrown, not turned into a row", async () => {
    stubFetch({ "GET /api/scenarios/S1/access/intervals": { json: {} } });
    const ctl = new AbortController();
    ctl.abort();
    await expect(fetchAccessResult("S1", THBK_GPS, ctl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

test("types: IntervalsByAccess is a plain map", () => {
  const empty: IntervalsByAccess = {};
  expect(Object.keys(empty)).toEqual([]);
});
