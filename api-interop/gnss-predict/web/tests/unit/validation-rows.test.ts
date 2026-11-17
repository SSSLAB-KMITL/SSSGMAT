// แถวและชุดข้อมูลของหน้า Validation (src/windows/Validation/rows.ts): ฟังก์ชันล้วนจาก history.jsonl, /validation/pending และ validation_<day>.json
// ตรวจการรวมประวัติกับวันที่ยังรอ การสลับ ΔEl/ΔAz การกรองรายดวง เส้นเกณฑ์ของกราฟแนวโน้ม และจุดของกราฟอายุกับความคลาด

import { describe, expect, test } from "vitest";
import {
  ageScatter, ageSummary, AGE_DAYS_LIMIT, comparePrn, dailyRows, parseDay, parseHistory, parsePending, satelliteRows, systemLetters, trendSeries, TREND_LIMITS,
  type HistoryRecord, type PendingDay,
} from "../../src/windows/Validation/rows";

const stats = (el_median: number, el_p99: number, az_median: number, az_p99: number, pass = true) =>
  ({ sats: 30, pairs: 1000, az_pairs: 900, el_median, el_p99, az_median, az_p99, pass });

const REC_09: HistoryRecord = {
  day: "2026-11-09", scenario: "E2E", ephem_hash: "aaa111", truth_file: "COD0MGXFIN_20263130000_01D_05M_ORB.SP3", pass: true,
  systems: { G: stats(0.011, 0.11, 0.021, 0.31), E: stats(0.012, 0.12, 0.022, 0.32) }, failing: [], created_utc: "2026-11-12T03:00:00Z",
};
const REC_10: HistoryRecord = {
  day: "2026-11-10", scenario: "E2E", ephem_hash: "bbb222", truth_file: "COD0MGXFIN_20263140000_01D_05M_ORB.SP3", pass: false,
  systems: { G: stats(0.03, 0.31, 0.04, 0.61, false), E: stats(0.013, 0.13, 0.023, 0.33) }, failing: ["G22"], created_utc: "2026-11-13T03:00:00Z",
};
const PENDING: PendingDay = { scenario: "daily_20261111", day: "2026-11-11", state: "pending", next_attempt_utc: "2026-11-12T06:00:00Z" };
const GAVE_UP: PendingDay = { scenario: "daily_20261108", day: "2026-11-08", state: "gave_up", next_attempt_utc: null };

describe("daily rows", () => {
  test("daily rows merge history and pending", () => {
    const rows = dailyRows([REC_09, REC_10], [PENDING, GAVE_UP], "el");
    // วันใหม่สุดก่อน
    expect(rows.map((r) => [r.day, r.scenario, r.result])).toEqual([
      ["2026-11-11", "daily_20261111", "pending"],
      ["2026-11-10", "E2E", "fail"],
      ["2026-11-09", "E2E", "pass"],
      ["2026-11-08", "daily_20261108", "gave_up"],
    ]);
    const [pending, fail, pass, gaveUp] = rows;
    expect(pending.nextAttempt).toBe("2026-11-12T06:00:00Z");
    expect(pending.truth).toBeNull();
    expect(pending.systems).toEqual([]);
    expect(gaveUp.nextAttempt).toBeNull();
    expect(fail.failing).toEqual(["G22"]);
    expect(fail.truth).toBe("COD0MGXFIN_20263140000_01D_05M_ORB.SP3");
    expect(pass.nextAttempt).toBeNull();
    expect(pass.failing).toEqual([]);
  });

  test("metric switch: el reads el_median/el_p99, az reads az_median/az_p99", () => {
    const el = dailyRows([REC_10], [], "el")[0];
    expect(el.systems).toEqual([
      { system: "G", median: 0.03, p99: 0.31, pass: false },
      { system: "E", median: 0.013, p99: 0.13, pass: true },
    ]);
    const az = dailyRows([REC_10], [], "az")[0];
    expect(az.systems).toEqual([
      { system: "G", median: 0.04, p99: 0.61, pass: false },
      { system: "E", median: 0.023, p99: 0.33, pass: true },
    ]);
  });

  test("systems come out in the order G R E C then any other letter, whatever the order in the file", () => {
    const rec: HistoryRecord = { ...REC_09, systems: { C: stats(1, 1, 1, 1), J: stats(1, 1, 1, 1), E: stats(1, 1, 1, 1), R: stats(1, 1, 1, 1), G: stats(1, 1, 1, 1) } };
    expect(dailyRows([rec], [], "el")[0].systems.map((s) => s.system)).toEqual(["G", "R", "E", "C", "J"]);
    expect(systemLetters(dailyRows([REC_09, rec], [], "el"))).toEqual(["G", "R", "E", "C", "J"]);
  });

  test("a day validated more than once shows the newest record only, and a validated day is not also pending", () => {
    const rerun: HistoryRecord = { ...REC_10, pass: true, failing: [], created_utc: "2026-11-14T03:00:00Z" };
    const rows = dailyRows([REC_10, rerun], [{ scenario: "E2E", day: "2026-11-10", state: "pending", next_attempt_utc: null }], "el");
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("pass");
    expect(rows[0].created).toBe("2026-11-14T03:00:00Z");
  });

  test("a pending day with no retry planned (daily job off) keeps a null next attempt", () => {
    const rows = dailyRows([], [{ ...PENDING, next_attempt_utc: null }], "el");
    expect(rows[0]).toMatchObject({ result: "pending", nextAttempt: null });
  });

  test("history without a pass flag counts as Fail, and missing numbers stay null", () => {
    const odd = parseHistory([{ day: "2026-11-05", scenario: "X", systems: { G: { el_median: null, el_p99: "x" } } }]);
    const row = dailyRows(odd, [], "el")[0];
    expect(row.result).toBe("fail");
    expect(row.systems).toEqual([{ system: "G", median: null, p99: null, pass: null }]);
    expect(row.truth).toBeNull();
    expect(row.failing).toEqual([]);
  });
});

// ข2: scenario ที่มีแต่ดาวถ่ายภาพ engine ข้าม X ทั้งหมด (Ruling u) ผลจึงไม่มีระบบ GNSS ใดใน systems และ pass เป็น false
describe("a validated day with no GNSS system", () => {
  test("an imaging-only day (systems has no GNSS letter) is neutral no_gnss, not Fail", () => {
    const rec: HistoryRecord = { ...REC_10, day: "2026-11-11", pass: false, systems: {}, failing: [] };
    const row = dailyRows([rec], [], "el")[0];
    expect(row.result).toBe("no_gnss");
    expect(row.systems).toEqual([]);
  });

  test("a day with any GNSS system keeps Pass / Fail from the pass flag", () => {
    expect(dailyRows([REC_09], [], "el")[0].result).toBe("pass");
    expect(dailyRows([REC_10], [], "el")[0].result).toBe("fail");
    expect(dailyRows([{ ...REC_10, systems: { C: stats(0.5, 0.9, 0.5, 0.9, false) } }], [], "el")[0].result).toBe("fail");
  });

  test("a parsed history line whose systems is empty or missing is no_gnss", () => {
    const rows = dailyRows(parseHistory([
      { day: "2026-11-05", scenario: "IMG", pass: false, systems: {}, failing: [] },
      { day: "2026-11-06", scenario: "IMG", pass: false },
    ]), [], "el");
    expect(rows.map((r) => r.result)).toEqual(["no_gnss", "no_gnss"]);
  });
});

describe("tolerant parsing of what the server passes through", () => {
  test("parseHistory drops records without a day and scenario, and non-finite numbers become null", () => {
    const parsed = parseHistory([
      REC_09, null, 3, "x", [], { day: "2026-11-01" }, { scenario: "S" }, { day: 5, scenario: "S" },
      { day: "2026-11-02", scenario: "S", pass: true, failing: ["G01", 7], systems: { G: { el_p99: Infinity, az_p99: 0.4 }, bad: 3 } },
    ]);
    expect(parsed.map((r) => r.day)).toEqual(["2026-11-09", "2026-11-02"]);
    expect(parsed[1].failing).toEqual(["G01"]);
    const row = dailyRows(parsed, [], "el").find((r) => r.day === "2026-11-02")!;
    expect(row.systems).toEqual([{ system: "G", median: null, p99: null, pass: null }]);
    expect(parseHistory("nope")).toEqual([]);
    expect(parseHistory(undefined)).toEqual([]);
  });

  test("parsePending keeps well-formed days only", () => {
    expect(parsePending([
      PENDING, GAVE_UP, null, { scenario: "S", day: "2026-11-01", state: "weird", next_attempt_utc: null }, { scenario: "S", day: "x", state: "pending" },
      { scenario: "", day: "2026-11-01", state: "pending" }, { scenario: "S", day: "2026-11-02", state: "pending", next_attempt_utc: 5 },
    ])).toEqual([PENDING, GAVE_UP, { scenario: "S", day: "2026-11-02", state: "pending", next_attempt_utc: null }]);
    expect(parsePending({})).toEqual([]);
  });

  test("parseDay needs an object with satellites, else null", () => {
    expect(parseDay(null)).toBeNull();
    expect(parseDay([])).toBeNull();
    expect(parseDay({ day: "2026-11-10" })).toEqual({ day: "2026-11-10", satellites: {} });
    expect(parseDay({ day: "2026-11-10", satellites: { G01: { pairs: 5 }, G02: 7 } })?.satellites).toEqual({ G01: { pairs: 5 } });
  });
});

const DOC_10 = {
  day: "2026-11-10", scenario: "E2E",
  satellites: {
    R03: { truth: "unverified", pairs: 0, az_pairs: 0, el_median: null, el_p99: null, az_median: null, az_p99: null, d3_median_km: null, d3_max_km: null, age_days: null, flags: ["no_broadcast"], result: "unverified" },
    G22: { truth: "sp3", pairs: 800, az_pairs: 700, el_median: 0.03, el_p99: 0.31, az_median: 0.04, az_p99: 0.61, d3_median_km: 0.052, d3_max_km: 0.4, age_days: 1.5, flags: [], result: "fail" },
    G01: { truth: "sp3", pairs: 900, az_pairs: 800, el_median: 0.01, el_p99: 0.1, az_median: 0.02, az_p99: 0.3, d3_median_km: 0.011, d3_max_km: 0.09, age_days: 0.5, flags: [], result: "pass" },
    E05: { truth: "brdc", pairs: 500, az_pairs: 450, el_median: 0.02, el_p99: 0.15, az_median: 0.03, az_p99: 0.35, d3_median_km: 0.02, d3_max_km: 0.2, age_days: 3.25, flags: ["stale"], result: "fail" },
  },
};

describe("satellite rows", () => {
  const doc = parseDay(DOC_10)!;

  test("satellite filter: system and result, PRN order", () => {
    // ลำดับระบบ G R E C เหมือนทั้งหน้า แล้วตาม PRN (ไม่ใช่ตามตัวอักษร: E05 อยู่หลัง R03)
    expect(satelliteRows(doc).map((s) => s.prn)).toEqual(["G01", "G22", "R03", "E05"]);
    expect(satelliteRows(doc, { system: "G" }).map((s) => s.prn)).toEqual(["G01", "G22"]);
    expect(satelliteRows(doc, { result: "fail" }).map((s) => s.prn)).toEqual(["G22", "E05"]);
    expect(satelliteRows(doc, { system: "G", result: "fail" }).map((s) => s.prn)).toEqual(["G22"]);
    expect(satelliteRows(doc, { system: "C" })).toEqual([]);
    // ค่าว่าง = ไม่กรอง
    expect(satelliteRows(doc, { system: "", result: "" })).toHaveLength(4);
  });

  test("a row carries every column of the table", () => {
    const g22 = satelliteRows(doc, { system: "G", result: "fail" })[0];
    expect(g22).toEqual({
      prn: "G22", system: "G", truth: "sp3", pairs: 800, azPairs: 700, elMedian: 0.03, elP99: 0.31, azMedian: 0.04, azP99: 0.61,
      d3Median: 0.052, d3Max: 0.4, ageDays: 1.5, flags: [], result: "fail",
    });
    const r03 = satelliteRows(doc, { system: "R" })[0];
    expect(r03).toMatchObject({ truth: "unverified", elMedian: null, d3Median: null, ageDays: null, result: "unverified", flags: ["no_broadcast"] });
  });
});

describe("trend", () => {
  test("trend thresholds: the P99 limit is 0.2 for el and 0.5 for az", () => {
    expect(TREND_LIMITS).toEqual({ el: 0.2, az: 0.5 });
    expect(trendSeries([REC_09, REC_10], "el").limit).toBe(0.2);
    expect(trendSeries([REC_09, REC_10], "az").limit).toBe(0.5);
  });

  test("one P99 value per system per day, oldest day first, null where a system has no value that day", () => {
    const onlyG: HistoryRecord = { ...REC_09, day: "2026-11-08", systems: { G: stats(0.01, 0.09, 0.02, 0.29) } };
    const el = trendSeries([REC_10, REC_09, onlyG], "el");
    expect(el.days).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(el.series).toEqual([
      { system: "G", values: [0.09, 0.11, 0.31] },
      { system: "E", values: [null, 0.12, 0.13] },
    ]);
    expect(trendSeries([REC_10, REC_09, onlyG], "az").series[0].values).toEqual([0.29, 0.31, 0.61]);
  });

  test("two scenarios on one day: the newest record of that day is the point", () => {
    const other: HistoryRecord = { ...REC_10, scenario: "daily_20261110", systems: { G: stats(0, 0.5, 0, 0.9) }, created_utc: "2026-11-15T03:00:00Z" };
    const trend = trendSeries([REC_10, other], "el");
    expect(trend.days).toEqual(["2026-11-10"]);
    expect(trend.series).toEqual([{ system: "G", values: [0.5] }]);
  });

  test("no history: no days and no series, but the limit is still there", () => {
    expect(trendSeries([], "el")).toEqual({ metric: "el", limit: 0.2, days: [], series: [] });
  });
});

describe("age against error", () => {
  test("age scatter pools every day and skips satellites with no age or no 3D median", () => {
    const other = parseDay({
      day: "2026-11-09",
      satellites: {
        G01: { age_days: 0.25, d3_median_km: 0.01, result: "pass" },
        C06: { age_days: 6.5, d3_median_km: 0.31, result: "fail" },
        C07: { age_days: null, d3_median_km: 0.31, result: "fail" },
        C08: { age_days: 2, d3_median_km: null, result: "unverified" },
      },
    })!;
    const points = ageScatter([parseDay(DOC_10)!, other]);
    // ตามลำดับเอกสารที่ส่งให้ แล้วตามลำดับ PRN (G R E C) ในเอกสารนั้น: [อายุ (วัน), ค่ากลางระยะ 3D (km), PRN]
    expect(points).toEqual([
      [0.5, 0.011, "G01"], [1.5, 0.052, "G22"], [3.25, 0.02, "E05"],
      [0.25, 0.01, "G01"], [6.5, 0.31, "C06"],
    ]);
  });

  test("the age summary counts the satellites, the days that gave any, and the median age", () => {
    const a = parseDay({ day: "2026-11-10", satellites: { G01: { age_days: 1, d3_median_km: 0.1 }, G02: { age_days: 3, d3_median_km: 0.1 }, G03: { age_days: null, d3_median_km: 0.1 } } })!;
    const b = parseDay({ day: "2026-11-09", satellites: { G01: { age_days: 5, d3_median_km: 0.1 } } })!;
    const empty = parseDay({ day: "2026-11-08", satellites: { G01: { age_days: null, d3_median_km: null } } })!;
    expect(ageSummary([a, b, empty])).toEqual({ points: 3, days: 2, medianAge: 3 });
    // จำนวนคู่: ค่ากลางคือค่าเฉลี่ยของสองตัวกลาง
    expect(ageSummary([a])).toEqual({ points: 2, days: 1, medianAge: 2 });
    expect(ageSummary([])).toEqual({ points: 0, days: 0, medianAge: null });
    expect(AGE_DAYS_LIMIT).toBe(180);
  });

  test("comparePrn orders by system G R E C, then by number", () => {
    expect(["E05", "C01", "R03", "G22", "G01", "J01"].sort(comparePrn)).toEqual(["G01", "G22", "R03", "E05", "C01", "J01"]);
  });

  test("no docs, no points", () => {
    expect(ageScatter([])).toEqual([]);
  });
});
