import { describe, expect, it } from "vitest";
import { DEFAULT_NF } from "../numfmt";
import { LINES_PER_PAGE, printDocument, printLines, printPages } from "./printPass";
import type { PassInfo, PassQth, PassSat } from "./types";

const lineList = (n: number): string[] => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe("printPages", () => {
  it("print pages", () => {
    // 120 lines make 3 pages of 50, 50 and 20; no lines make one empty page
    expect(printPages(lineList(120)).map((p) => p.length)).toEqual([50, 50, 20]);
    expect(printPages([])).toEqual([[]]);
  });

  it("keeps every line, in order", () => {
    const lines = lineList(120);
    expect(printPages(lines).flat()).toEqual(lines);
  });

  it("no lines make one empty page", () => {
    expect(printPages([])).toEqual([[]]);
  });

  it("exactly one page of lines is one page, one line more is two", () => {
    expect(printPages(lineList(50))).toHaveLength(1);
    expect(printPages(lineList(51)).map((p) => p.length)).toEqual([50, 1]);
  });

  it("takes the number of lines per page as a second argument", () => {
    expect(printPages(lineList(7), 3).map((p) => p.length)).toEqual([3, 3, 1]);
  });

  it("is 50 lines per page (plan decision 9)", () => {
    expect(LINES_PER_PAGE).toBe(50);
  });
});

const SAT: PassSat = { norad: 25544, name: "ISS (ZARYA)" };
const QTH: PassQth = { name: "Bangkok", location: "Bangkok, Thailand", lat_deg: 13.7563, lon_deg: 100.5018, alt_m: 2 };
// the first two rows of the example of ref-P §8.3
const PASS: PassInfo = {
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
  ],
};
const DEFAULT_COLUMNS = ["Time", "Az", "El", "Range", "Footp"];

describe("printLines", () => {
  it("print lines are the data table", () => {
    // ref-P §8.5: separator, title, separator and the rows, without the 5 header lines
    expect(printLines({ sat: SAT, qth: QTH, pass: PASS }, DEFAULT_COLUMNS)).toEqual([
      "----------------------------------------------",
      " Time                  Az      El  Range Footp",
      "----------------------------------------------",
      " 2026/11/12 10:00:00 123.45  12.34  1234  4567",
      " 2026/11/12 10:05:00 150.01  45.67   678  4321",
    ]);
  });

  it("have no line of the page header (title, observer, LAT/LON, AOS, LOS)", () => {
    const text = printLines({ sat: SAT, qth: QTH, pass: PASS }, DEFAULT_COLUMNS).join("\n");
    for (const label of ["Pass details for", "Observer:", "LAT:", "AOS:", "LOS:"]) expect(text).not.toContain(label);
  });

  it("have a row for every row of the pass, and no empty line at the end", () => {
    const lines = printLines({ sat: SAT, qth: QTH, pass: PASS }, DEFAULT_COLUMNS);
    expect(lines).toHaveLength(3 + PASS.rows.length);
    expect(lines.at(-1)).not.toBe("");
  });

  it("follow the columns of Single Pass, in Gpredict's fixed order", () => {
    const lines = printLines({ sat: SAT, qth: QTH, pass: PASS }, ["Vis", "Time", "SSP"]);
    expect(lines[1]).toBe(` Time${" ".repeat(15)}  SSP   Vis`); // " Time" is padded to the width of the time, then the titles of SSP and Vis
    expect(lines[3]).toBe(" 2026/11/12 10:00:00 OK03ab  V");
  });

  it("have the time format of Preferences, and km and signed Lat and Lon whatever else is set", () => {
    const f = { ...DEFAULT_NF, timeFormat: "%d %H:%M", imperial: true, nsew: true };
    const lines = printLines({ sat: SAT, qth: QTH, pass: PASS }, ["Time", "Range", "Lat"], f);
    expect(lines[1]).toBe(` Time${" ".repeat(4)} Range   Lat `); // the Time column is the width of "12 10:00"
    expect(lines[3]).toBe(" 12 10:00  1234  13.75");
  });
});

describe("the printed document", () => {
  const lines = lineList(120);
  const html = printDocument("Pass details for ISS (ZARYA) (orbit 12345)", lines);

  it("has a header band with the title and n/N on every page", () => {
    expect(html.match(/class="band"/g)).toHaveLength(3);
    for (const n of ["1/3", "2/3", "3/3"]) expect(html).toContain(n);
    expect(html.match(/Pass details for ISS \(ZARYA\) \(orbit 12345\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("is A4 with 10 mm margins, a 10 mm grey band and the table in 12 pt monospace (ref-P §8.5)", () => {
    expect(html).toContain("size: A4");
    expect(html).toContain("margin: 10mm");
    expect(html).toMatch(/height:\s*10mm/);
    expect(html).toContain("#cccccc");
    expect(html).toMatch(/14pt\s+sans-serif/);
    expect(html).toMatch(/12pt\/12pt\s+monospace/);
  });

  it("keeps the grey band when the print dialog has Background graphics off (its default): the band asks for exact colours", () => {
    // without print-color-adjust the browser leaves out the grey fill of the band (ref-P §8.5 has it light grey, 0.8)
    const band = /\.band\s*\{[^}]*\}/.exec(html)?.[0] ?? "";
    expect(band).toContain("background: #cccccc");
    expect(band).toContain("print-color-adjust: exact");
    expect(band).toContain("-webkit-print-color-adjust: exact");
  });

  it("writes every line once", () => {
    for (const l of lines) expect(html.match(new RegExp(`${l}(\\n|<)`, "g"))).toHaveLength(1);
  });

  it("writes an empty list as one page with a band and 1/1", () => {
    const empty = printDocument("Title", []);
    expect(empty.match(/class="band"/g)).toHaveLength(1);
    expect(empty).toContain("1/1");
  });

  it("escapes what it writes: a satellite name must not become markup", () => {
    const risky = printDocument("Pass details for <b>&X (orbit 1)", ["a < b && c > d"]);
    expect(risky).not.toContain("<b>");
    expect(risky).toContain("&lt;b&gt;&amp;X");
    expect(risky).toContain("a &lt; b &amp;&amp; c &gt; d");
  });

  it("keeps the spaces of the table (the lines are in a pre)", () => {
    expect(printDocument("T", ["  Az   El"])).toContain("<pre");
    expect(printDocument("T", ["  Az   El"])).toContain("  Az   El");
  });
});
