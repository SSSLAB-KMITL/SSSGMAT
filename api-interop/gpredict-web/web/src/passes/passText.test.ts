import { describe, expect, it } from "vitest";
import { DEFAULT_NF } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import { pinTimeZone } from "../pinTimeZone";
import { MULTI_COLUMNS, SINGLE_COLUMNS } from "./passCells";
import {
  cleanFileName,
  defaultFileName,
  FILE_NAME_MAX,
  listContents,
  onePassText,
  oneContents,
  passListText,
  SAVE_CONTENTS_LABELS,
  SAVE_PASSES_LABELS,
  validFileName,
} from "./passText";
import type { OneContents } from "./passText";
import type { PassInfo, PassQth, PassSat } from "./types";

const SAT: PassSat = { norad: 25544, name: "ISS (ZARYA)" };
const QTH: PassQth = { name: "Bangkok", location: "Bangkok, Thailand", lat_deg: 13.7563, lon_deg: 100.5018, alt_m: 2 };

/** Gpredict's defaults (PREDICT/SINGLE_PASS_COL and PREDICT/MULTI_PASS_COL) */
const SINGLE = ["Time", "Az", "El", "Range", "Footp"];
const MULTI = ["AOS", "LOS", "Duration", "Max El", "AOS Az", "LOS Az"];
const ALL_SINGLE = SINGLE_COLUMNS.map((c) => c.title);
const ALL_MULTI = MULTI_COLUMNS.map((c) => c.title);

/** The first row is the example row of ref-P §8.3 (123.45 12.34 1234 4567), the first pass the example of §8.4. */
const PASS_A: PassInfo = {
  orbit: 12345,
  aos: "2026-11-12T10:00:00.000Z",
  tca: "2026-11-12T10:05:00.000Z",
  los: "2026-11-12T10:10:00.000Z",
  max_el: 45.67,
  aos_az: 12.34,
  max_el_az: 100,
  los_az: 200,
  vis: "V-E",
  rows: [
    { t: "2026-11-12T10:00:00.000Z", az: 123.45, el: 12.34, ra: 201.5, dec: -5.25, range_km: 1234, rate_kms: -3.4567, lat_deg: 13.75, lon_deg: 100.5, ssp: "OK03ab", footprint_km: 4567, alt_km: 420, vel_kms: 7.6543, doppler_hz: 1234, loss_db: 140.12, delay_ms: 4.12, ma: 45.5, phase_deg: 12.34, vis: "V" },
    { t: "2026-11-12T10:05:00.000Z", az: 150.007, el: 45.67, ra: 210.25, dec: 10.5, range_km: 678.4, rate_kms: 0.0004, lat_deg: -13.754, lon_deg: -100.499, ssp: "JG86xm", footprint_km: 4321, alt_km: 419.6, vel_kms: 7.6, doppler_hz: -56, loss_db: 135.5, delay_ms: 2.26, ma: 60, phase_deg: 130.5, vis: "D" },
    { t: "2026-11-12T10:10:00.000Z", az: 200.0, el: 3.1, ra: 220, dec: 15, range_km: 2345.5, rate_kms: 5.1234, lat_deg: -1.5, lon_deg: 8.25, ssp: "JJ98aa", footprint_km: 4999, alt_km: 421, vel_kms: 7.65, doppler_hz: -1700, loss_db: 147.33, delay_ms: 7.82, ma: 128, phase_deg: 255.99, vis: "-" },
  ],
};
const PASS_B: PassInfo = {
  orbit: 12346,
  aos: "2026-11-12T11:40:00.000Z",
  tca: "2026-11-12T11:46:30.000Z",
  los: "2026-11-12T11:52:15.000Z",
  max_el: 7.5,
  aos_az: 350.25,
  max_el_az: 80,
  los_az: 5,
  vis: "--E",
  rows: [
    { t: "2026-11-12T11:40:00.000Z", az: 350.25, el: 0.5, ra: 100, dec: 20, range_km: 2500, rate_kms: -6.7, lat_deg: 20, lon_deg: 90, ssp: "NK99ab", footprint_km: 5100, alt_km: 410, vel_kms: 7.5, doppler_hz: 2234, loss_db: 148, delay_ms: 8.34, ma: 200, phase_deg: 0.5, vis: "E" },
    { t: "2026-11-12T11:52:15.000Z", az: 5.5, el: 0.25, ra: 101, dec: 21, range_km: 2600, rate_kms: 6.6, lat_deg: 21, lon_deg: 91, ssp: "NK99ac", footprint_km: 5200, alt_km: 411, vel_kms: 7.51, doppler_hz: -2200, loss_db: 148.3, delay_ms: 8.67, ma: 201, phase_deg: 1.5, vis: "E" },
  ],
};

const nf = (over: Partial<NumberFormat> = {}): NumberFormat => ({ ...DEFAULT_NF, ...over });
const one = (pass: PassInfo, columns: readonly string[], contents: OneContents, f: NumberFormat = DEFAULT_NF): string =>
  onePassText({ sat: SAT, qth: QTH, pass }, columns, contents, f);
const list = (passes: PassInfo[], columns: readonly string[], contents: 0 | 1, single: readonly string[], f: NumberFormat = DEFAULT_NF): string =>
  passListText({ sat: SAT, qth: QTH, passes }, columns, contents, single, f);

/** Lines of a file; every line ends with a newline, as in Gpredict's files (the quotes make the trailing spaces visible). */
const file = (...lines: string[]): string => lines.map((l) => `${l}\n`).join("");

// The expected texts were produced by an independent port of Gpredict's pass-to-txt.c and save-pass.c (printf formats and all), not by this code.
const PAGE_HEADER_A = [
  "Pass details for ISS (ZARYA) (orbit 12345)",
  "Observer: Bangkok, Bangkok, Thailand",
  "LAT:13.76 LON:100.50",
  "AOS: 2026/11/12 10:00:00 UTC",
  "LOS: 2026/11/12 10:10:00 UTC",
];
const TABLE_HEADER_DEFAULT = [
  "----------------------------------------------",
  " Time                  Az      El  Range Footp",
  "----------------------------------------------",
];
const ROWS_A_DEFAULT = [
  " 2026/11/12 10:00:00 123.45  12.34  1234  4567",
  " 2026/11/12 10:05:00 150.01  45.67   678  4321",
  " 2026/11/12 10:10:00 200.00   3.10  2346  4999",
];
const EXPECTED_ONE_COMPLETE = file(...PAGE_HEADER_A, ...TABLE_HEADER_DEFAULT, ...ROWS_A_DEFAULT);

const LIST_HEADER = ["Upcoming passes for ISS (ZARYA)", "Observer: Bangkok, Bangkok, Thailand", "LAT:13.76 LON:100.50"];
const LIST_TABLE_DEFAULT = [
  "-------------------------------------------------------------------------------------------------",
  " AOS                  TCA                  LOS                  Duration  Max El  AOS Az  LOS Az",
  "-------------------------------------------------------------------------------------------------",
  " 2026/11/12 10:00:00  2026/11/12 10:05:00  2026/11/12 10:10:00  00:10:00   45.67   12.34  200.00",
  " 2026/11/12 11:40:00  2026/11/12 11:46:30  2026/11/12 11:52:15  00:12:15    7.50  350.25    5.00",
];
const EXPECTED_LIST_COMPLETE = file(
  ...LIST_HEADER,
  ...LIST_TABLE_DEFAULT,
  "",
  " Orbit 12345",
  ...TABLE_HEADER_DEFAULT,
  ...ROWS_A_DEFAULT,
  "",
  " Orbit 12346",
  ...TABLE_HEADER_DEFAULT,
  " 2026/11/12 11:40:00 350.25   0.50  2500  5100",
  " 2026/11/12 11:52:15   5.50   0.25  2600  5200",
);

describe("onePassText", () => {
  it("one pass, complete report", () => {
    expect(one(PASS_A, SINGLE, 0)).toBe(EXPECTED_ONE_COMPLETE);
  });

  it("one pass, info only and data only", () => {
    // contents 1 "Header + data": the table header and the rows; 2 "Data only": the rows
    expect(one(PASS_A, SINGLE, 1)).toBe(file(...TABLE_HEADER_DEFAULT, ...ROWS_A_DEFAULT));
    expect(one(PASS_A, SINGLE, 2)).toBe(file(...ROWS_A_DEFAULT));
  });

  it("the example of ref-P §8.3 comes out letter for letter", () => {
    const example: PassInfo = { ...PASS_A, rows: [PASS_A.rows[0]!] };
    expect(one(example, SINGLE, 1)).toBe(
      "----------------------------------------------\n" +
        " Time                  Az      El  Range Footp\n" +
        "----------------------------------------------\n" +
        " 2026/11/12 10:00:00 123.45  12.34  1234  4567\n",
    );
  });

  it("all 19 columns", () => {
    expect(one(PASS_A, ALL_SINGLE, 0)).toBe(
      file(
        ...PAGE_HEADER_A,
        "------------------------------------------------------------------------------------------------------------------------------------------",
        " Time                  Az      El    Ra     Dec  Range  Rate    Lat    Lon    SSP   Footp  Alt   Vel   Dop   Loss   Del    MA    Pha   Vis",
        "------------------------------------------------------------------------------------------------------------------------------------------",
        " 2026/11/12 10:00:00 123.45  12.34 201.50  -5.25  1234 -3.457  13.75  100.50 OK03ab  4567   420 7.654  1234 140.12  4.12  45.50  12.34  V",
        " 2026/11/12 10:05:00 150.01  45.67 210.25  10.50   678  0.000 -13.75 -100.50 JG86xm  4321   420 7.600   -56 135.50  2.26  60.00 130.50  D",
        " 2026/11/12 10:10:00 200.00   3.10 220.00  15.00  2346  5.123  -1.50    8.25 JJ98aa  4999   421 7.650 -1700 147.33  7.82 128.00 255.99  -",
      ),
    );
  });

  it("numbers have no degree sign, and Lat and Lon no N/S/E/W", () => {
    expect(one(PASS_A, ALL_SINGLE, 0)).not.toContain("°");
  });

  it("a row without a locator skips the SSP column without padding", () => {
    const pass: PassInfo = { ...PASS_A, rows: PASS_A.rows.map((r, i) => (i === 1 ? { ...r, ssp: "" } : r)) };
    expect(one(pass, ["Time", "Lon", "SSP", "Footp"], 1)).toBe(
      file(
        "-----------------------------------------",
        " Time                  Lon    SSP   Footp",
        "-----------------------------------------",
        " 2026/11/12 10:00:00  100.50 OK03ab  4567",
        " 2026/11/12 10:05:00 -100.50  4321",
        " 2026/11/12 10:10:00    8.25 JJ98aa  4999",
      ),
    );
  });

  it("Time is always there and the columns come in Gpredict's order whatever order they are given in", () => {
    const expected = file(
      "----------------------------------",
      " Time                  Az      El ",
      "----------------------------------",
      " 2026/11/12 10:00:00 123.45  12.34",
      " 2026/11/12 10:05:00 150.01  45.67",
      " 2026/11/12 10:10:00 200.00   3.10",
    );
    expect(one(PASS_A, ["El", "Az"], 1)).toBe(expected);
    expect(one(PASS_A, ["Az", "El", "Time"], 1)).toBe(expected);
  });

  it("only the Time column when none is chosen", () => {
    expect(one(PASS_A, [], 1)).toBe(
      file(
        "-".repeat(20),
        " Time" + " ".repeat(15), // " Time" and (19 - 4) spaces: the column is the length of the time + 1 wide
        "-".repeat(20),
        " 2026/11/12 10:00:00",
        " 2026/11/12 10:05:00",
        " 2026/11/12 10:10:00",
      ),
    );
  });

  it("the page header has the station as stored and no blank line after it", () => {
    const qth: PassQth = { name: "Home", location: "", lat_deg: -33.8688, lon_deg: -0.004, alt_m: 0 };
    const text = onePassText({ sat: SAT, qth, pass: PASS_A }, SINGLE, 0);
    expect(text.split("\n").slice(0, 6)).toEqual([
      "Pass details for ISS (ZARYA) (orbit 12345)",
      "Observer: Home, ", // "%s, %s" with an empty location
      "LAT:-33.87 LON:-0.00",
      "AOS: 2026/11/12 10:00:00 UTC",
      "LOS: 2026/11/12 10:10:00 UTC",
      TABLE_HEADER_DEFAULT[0],
    ]);
  });
});

describe("passListText", () => {
  it("pass list, complete report", () => {
    expect(list([PASS_A, PASS_B], MULTI, 0, SINGLE)).toBe(EXPECTED_LIST_COMPLETE);
  });

  it("pass list, summary", () => {
    expect(list([PASS_A, PASS_B], MULTI, 1, SINGLE)).toBe(file(...LIST_HEADER, ...LIST_TABLE_DEFAULT));
  });

  it("the example of ref-P §8.4 comes out letter for letter", () => {
    expect(list([PASS_A], MULTI, 1, SINGLE)).toBe(
      "Upcoming passes for ISS (ZARYA)\n" +
        "Observer: Bangkok, Bangkok, Thailand\n" +
        "LAT:13.76 LON:100.50\n" +
        "-------------------------------------------------------------------------------------------------\n" +
        " AOS                  TCA                  LOS                  Duration  Max El  AOS Az  LOS Az\n" +
        "-------------------------------------------------------------------------------------------------\n" +
        " 2026/11/12 10:00:00  2026/11/12 10:05:00  2026/11/12 10:10:00  00:10:00   45.67   12.34  200.00\n",
    );
  });

  it("all 10 columns", () => {
    expect(list([PASS_A, PASS_B], ALL_MULTI, 1, SINGLE)).toBe(
      file(
        ...LIST_HEADER,
        "------------------------------------------------------------------------------------------------------------------------",
        " AOS                  TCA                  LOS                  Duration  Max El  AOS Az  Max El Az  LOS Az  Orbit  Vis",
        "------------------------------------------------------------------------------------------------------------------------",
        " 2026/11/12 10:00:00  2026/11/12 10:05:00  2026/11/12 10:10:00  00:10:00   45.67   12.34     100.00  200.00  12345  V-E",
        " 2026/11/12 11:40:00  2026/11/12 11:46:30  2026/11/12 11:52:15  00:12:15    7.50  350.25      80.00    5.00  12346  --E",
      ),
    );
  });

  it("AOS, TCA and LOS are there even when no column is chosen, and the separator is one longer than the title line", () => {
    const [separator, title, , row] = list([PASS_A], [], 1, SINGLE).split("\n").slice(3);
    expect(separator).toBe("-".repeat(3 * (19 + 2)));
    expect(title).toBe(" AOS" + " ".repeat(16) + "  TCA" + " ".repeat(16) + "  LOS" + " ".repeat(16));
    expect(title).toHaveLength(separator!.length - 1);
    expect(row).toBe(" 2026/11/12 10:00:00  2026/11/12 10:05:00  2026/11/12 10:10:00");
  });

  it("the blocks of the complete report use the Single Pass columns, the summary the Multiple Passes columns", () => {
    expect(list([PASS_A, PASS_B], ["Orbit"], 0, ["Az"])).toBe(
      file(
        ...LIST_HEADER,
        "----------------------------------------------------------------------",
        " AOS                  TCA                  LOS                  Orbit",
        "----------------------------------------------------------------------",
        " 2026/11/12 10:00:00  2026/11/12 10:05:00  2026/11/12 10:10:00  12345",
        " 2026/11/12 11:40:00  2026/11/12 11:46:30  2026/11/12 11:52:15  12346",
        "",
        " Orbit 12345",
        "---------------------------",
        " Time                  Az  ",
        "---------------------------",
        " 2026/11/12 10:00:00 123.45",
        " 2026/11/12 10:05:00 150.01",
        " 2026/11/12 10:10:00 200.00",
        "",
        " Orbit 12346",
        "---------------------------",
        " Time                  Az  ",
        "---------------------------",
        " 2026/11/12 11:40:00 350.25",
        " 2026/11/12 11:52:15   5.50",
      ),
    );
  });

  it("a block of the complete report with every Single Pass column", () => {
    expect(list([PASS_B], ["Duration"], 0, ALL_SINGLE)).toBe(
      file(
        ...LIST_HEADER,
        "-------------------------------------------------------------------------",
        " AOS                  TCA                  LOS                  Duration",
        "-------------------------------------------------------------------------",
        " 2026/11/12 11:40:00  2026/11/12 11:46:30  2026/11/12 11:52:15  00:12:15",
        "",
        " Orbit 12346",
        "------------------------------------------------------------------------------------------------------------------------------------------",
        " Time                  Az      El    Ra     Dec  Range  Rate    Lat    Lon    SSP   Footp  Alt   Vel   Dop   Loss   Del    MA    Pha   Vis",
        "------------------------------------------------------------------------------------------------------------------------------------------",
        " 2026/11/12 11:40:00 350.25   0.50 100.00  20.00  2500 -6.700  20.00   90.00 NK99ab  5100   410 7.500  2234 148.00  8.34 200.00   0.50  E",
        " 2026/11/12 11:52:15   5.50   0.25 101.00  21.00  2600  6.600  21.00   91.00 NK99ac  5200   411 7.510 -2200 148.30  8.67 201.00   1.50  E",
      ),
    );
  });

  it("no passes gives no text", () => {
    expect(list([], MULTI, 0, SINGLE)).toBe("");
  });
});

describe("number formats in the saved text (ref-D §2.1, ref-P §8.3)", () => {
  pinTimeZone("Asia/Bangkok"); // UTC+7, no daylight saving

  it("saved text keeps km and signed lat/lon", () => {
    // Imperial and N/S/E/W change nothing in a file: every number is what DEFAULT_NF writes ("Not affected")
    const both = nf({ imperial: true, nsew: true });
    expect(one(PASS_A, ALL_SINGLE, 0, both)).toBe(one(PASS_A, ALL_SINGLE, 0, DEFAULT_NF));
    expect(one(PASS_A, ALL_SINGLE, 0, both)).toContain(" 1234 -3.457  13.75  100.50 OK03ab  4567   420 7.654");
    expect(list([PASS_A, PASS_B], ALL_MULTI, 0, ALL_SINGLE, both)).toBe(list([PASS_A, PASS_B], ALL_MULTI, 0, ALL_SINGLE, DEFAULT_NF));
    expect(list([PASS_A, PASS_B], ALL_MULTI, 1, ALL_SINGLE, both)).toBe(list([PASS_A, PASS_B], ALL_MULTI, 1, ALL_SINGLE, DEFAULT_NF));
  });

  it("saved text has no degree sign or hemisphere letter when N/S/E/W is on", () => {
    const rows = one(PASS_A, ALL_SINGLE, 2, nf({ nsew: true })).split("\n"); // contents 2: the data rows only
    expect(rows).toHaveLength(PASS_A.rows.length + 1); // and the empty text after the last newline
    for (const row of rows) expect(row).not.toMatch(/°|\d[NSEW]\b/);
    expect(rows[1]).toContain(" -13.75 -100.50 JG86xm"); // signed, as in the file with the default format
    expect(one(PASS_A, ALL_SINGLE, 0, nf({ nsew: true }))).not.toContain("°");
  });

  it("saved text says Local or UTC", () => {
    const local = one(PASS_A, SINGLE, 0, nf({ local: true })).split("\n");
    expect(local.slice(3, 5)).toEqual(["AOS: 2026/11/12 17:00:00 Local", "LOS: 2026/11/12 17:10:00 Local"]);
    // the table times are local too
    expect(local[8]).toBe(" 2026/11/12 17:00:00 123.45  12.34  1234  4567");
    const utc = one(PASS_A, SINGLE, 0, nf({ local: false })).split("\n");
    expect(utc.slice(3, 5)).toEqual(["AOS: 2026/11/12 10:00:00 UTC", "LOS: 2026/11/12 10:10:00 UTC"]);
  });

  it("the time format is the one of Preferences, and the Time column is as wide as the time", () => {
    const f = nf({ timeFormat: "%H:%M", local: true });
    expect(one(PASS_A, ["Az"], 0, f)).toBe(
      file(
        ...PAGE_HEADER_A.slice(0, 3),
        "AOS: 17:00 Local",
        "LOS: 17:10 Local",
        "-------------",
        " Time    Az  ",
        "-------------",
        " 17:00 123.45",
        " 17:05 150.01",
        " 17:10 200.00",
      ),
    );
  });

  it("the pass list has the time format and zone in every time column", () => {
    const f = nf({ timeFormat: "%d %H:%M", local: true });
    expect(list([PASS_A, PASS_B], [], 1, SINGLE, f)).toBe(
      file(
        ...LIST_HEADER,
        "-".repeat(30), // 3 x (8 + 2): "12 17:00" is 8 characters
        ` AOS${" ".repeat(5)}  TCA${" ".repeat(5)}  LOS${" ".repeat(5)}`,
        "-".repeat(30),
        " 12 17:00  12 17:05  12 17:10",
        " 12 18:40  12 18:46  12 18:52",
      ),
    );
  });
});

describe("labels of File contents", () => {
  it("Save Pass Details, in the order of PREDICT/SAVE_CONTENTS 0-2", () => {
    expect(SAVE_CONTENTS_LABELS).toEqual(["Info+header+data", "Header + data", "Data only"]);
  });

  it("Save Passes", () => {
    expect(SAVE_PASSES_LABELS).toEqual(["Complete report", "Summary"]);
  });

  it("the stored choice is 0 to 2, anything else is the default", () => {
    expect([0, 1, 2].map(oneContents)).toEqual([0, 1, 2]);
    expect([3, -1, 1.5, "1", true, null, undefined].map(oneContents)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("Save Passes has two choices", () => {
    expect([0, 1, 2, undefined].map(listContents)).toEqual([0, 1, 0, 0]);
  });
});

describe("file names", () => {
  it("default file names", () => {
    // "<satellite>-<orbit>": spaces become "-", !?/\()*&%$#@[]{}=+<>,.|:; become "_" (ref-P §8.1)
    expect(defaultFileName("one", "ISS (ZARYA)", 12345)).toBe("ISS-_ZARYA_-12345");
    expect(defaultFileName("list", "ISS (ZARYA)")).toBe("ISS-_ZARYA_-passes");
    expect(defaultFileName("one", "NOAA 15", 7)).toBe("NOAA-15-7");
    expect(defaultFileName("one", "AO-7", 0)).toBe("AO-7-0");
  });

  it("every character Gpredict replaces becomes an underscore", () => {
    expect(defaultFileName("list", "x!?/\\()*&%$#@[]{}=+<>,.|:;y")).toBe(`x${"_".repeat(25)}y-passes`);
  });

  it("any other character that cannot be typed in the entry is dropped, and the name is at most 100 characters", () => {
    expect(defaultFileName("one", "SAT~1 é", 5)).toBe("SAT1--5");
    expect(defaultFileName("list", "a".repeat(120))).toHaveLength(FILE_NAME_MAX);
  });

  it("while typing, only letters, digits, - and _ stay, up to 100", () => {
    expect(cleanFileName("ISS-25544_x")).toBe("ISS-25544_x");
    expect(cleanFileName("a b.c$é/ท")).toBe("abc");
    expect(cleanFileName("a".repeat(150))).toBe("a".repeat(100));
    expect(cleanFileName("")).toBe("");
  });

  it("file name validation", () => {
    expect(validFileName("")).toBe(false);
    expect(validFileName("a".repeat(101))).toBe(false);
    expect(validFileName("a b")).toBe(false);
    expect(validFileName("a.b")).toBe(false);
    expect(validFileName("a\nb")).toBe(false);
    expect(validFileName("ISS-25544_x")).toBe(true);
    expect(validFileName("a".repeat(100))).toBe(true);
    expect(validFileName("-")).toBe(true);
  });
});
