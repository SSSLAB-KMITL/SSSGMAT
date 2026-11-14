import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrbitInfoTable, TransponderList } from "./components/SatInfoWindow";
import { DEFAULT_NF } from "./numfmt";
import type { NumberFormat } from "./numfmt";
import type { Transponder } from "./radio/types";
import {
  closeSatInfo,
  ORBIT_SEPARATOR_AFTER,
  openSatInfo,
  orbitInfoRows,
  scriptParts,
  statusText,
  transponderLines,
  unreadableRows,
  UNREADABLE_TEXT,
} from "./satInfo";
import type { InfoRow } from "./satInfo";
import type { OrbitInfo } from "./types";

/** The ISS of the server's tests (server/tests/test_satinfo.py): the orbit_info of GET /api/satellites/25544. */
const ISS: OrbitInfo = {
  name: "ISS (ZARYA)",
  status: "Operational",
  catnum: 25544,
  intl_designator: "98067A  ",
  element_set: 999,
  epoch: "2026-11-09T12:00:00.000Z",
  revnum: 1,
  incl_deg: 51.64,
  raan_deg: 208.9163,
  ecc: 0.0006317,
  argp_deg: 69.9862,
  ma_deg: 25.2906,
  mean_motion: 15.49438945,
  ndot2: 0.00016717,
  nddot6: 0,
  bstar: 0.30164e-3,
};

const info = (over: Partial<OrbitInfo> = {}): OrbitInfo => ({ ...ISS, ...over });
const nf = (over: Partial<NumberFormat> = {}): NumberFormat => ({ ...DEFAULT_NF, ...over });
const rowOf = (rows: readonly InfoRow[], label: string): InfoRow => {
  const row = rows.find((r) => r.label === label);
  if (row === undefined) throw new Error(`no row "${label}"`);
  return row;
};

const trsp = (over: Partial<Transponder> = {}): Transponder => ({
  name: "Mode U/V",
  up_low: 0,
  up_high: 0,
  down_low: 0,
  down_high: 0,
  invert: false,
  mode: "",
  baud: 0,
  ...over,
});

describe("orbitInfoRows (ref-D §8.1)", () => {
  it("orbit info rows: the 16 rows of the Orbit Info tab, in Gpredict's order and wording", () => {
    const rows = orbitInfoRows(ISS, nf());
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Satellite name:", "ISS (ZARYA)"],
      ["Operational Status:", "Operational"],
      ["Catalogue number:", "25544"],
      ["International designator:", "98067A  "],
      ["Element set number:", "999"],
      ["Epoch time:", "2026/11/09 12:00:00"],
      ["Orbit number @ epoch:", "1"],
      ["Inclination:", "51.6400°"],
      ["RAAN:", "208.9163°"],
      ["Eccentricity:", "0.0006317"],
      ["Arg. of perigee:", "69.9862°"],
      ["Mean anomaly:", "25.2906°"],
      ["Mean motion:", "15.49438945 [rev/day]"],
      ["½ d/dt (mean motion):", "1.67170e-04 [rev/day<sup>2</sup>]"],
      ["1/6 d<sup>2</sup>/dt<sup>2</sup> (mean motion):", "0.00000e+00 [rev/day<sup>3</sup>]"],
      ["B* drag term:", "3.01640e-04 [R<sub>E</sub><sup>-1</sup>]"],
    ]);
  });

  it("makes only the first row (the satellite name) bold, and the separator comes after the 7th row (orbit number)", () => {
    const rows = orbitInfoRows(ISS, nf());
    expect(rows.map((r) => r.bold === true)).toEqual([true, ...Array<boolean>(15).fill(false)]);
    expect(ORBIT_SEPARATOR_AFTER).toBe(6);
    expect(rows[ORBIT_SEPARATOR_AFTER]!.label).toBe("Orbit number @ epoch:");
    expect(rows[ORBIT_SEPARATOR_AFTER + 1]!.label).toBe("Inclination:");
  });

  it("marks as markup only the rows whose text has <sub> or <sup> (the satellite name is never markup)", () => {
    const marked = orbitInfoRows(ISS, nf())
      .filter((r) => r.markup === true)
      .map((r) => r.label);
    expect(marked).toEqual(["½ d/dt (mean motion):", "1/6 d<sup>2</sup>/dt<sup>2</sup> (mean motion):", "B* drag term:"]);
    expect(rowOf(orbitInfoRows(info({ name: "X<sup>2</sup>" }), nf()), "Satellite name:").markup).toBeUndefined();
  });

  it("keeps the 8 raw characters of the international designator, trailing spaces included", () => {
    expect(rowOf(orbitInfoRows(ISS, nf()), "International designator:").value).toBe("98067A  ");
    expect(rowOf(orbitInfoRows(info({ intl_designator: "        " }), nf()), "International designator:").value).toBe("        ");
  });

  it("writes the eccentricity with 7 decimals, the angles with 4 and the mean motion with 8", () => {
    const rows = orbitInfoRows(info({ ecc: 1e-6, incl_deg: 0.00005, raan_deg: 359.99999, mean_motion: 1.5 }), nf());
    expect(rowOf(rows, "Eccentricity:").value).toBe("0.0000010");
    expect(rowOf(rows, "Inclination:").value).toBe("0.0001°");
    expect(rowOf(rows, "RAAN:").value).toBe("360.0000°");
    expect(rowOf(rows, "Mean motion:").value).toBe("1.50000000 [rev/day]");
  });

  it("writes %.5e like C: the exponent has a sign and at least two digits, and a negative number keeps its sign", () => {
    const rows = orbitInfoRows(info({ ndot2: -0.00001234, nddot6: 6.789, bstar: 1.5e-120 }), nf());
    expect(rowOf(rows, "½ d/dt (mean motion):").value).toBe("-1.23400e-05 [rev/day<sup>2</sup>]");
    expect(rowOf(rows, "1/6 d<sup>2</sup>/dt<sup>2</sup> (mean motion):").value).toBe("6.78900e+00 [rev/day<sup>3</sup>]");
    expect(rowOf(rows, "B* drag term:").value).toBe("1.50000e-120 [R<sub>E</sub><sup>-1</sup>]");
  });

  it("epoch uses the time format: nf.timeFormat %Y gives the year only", () => {
    expect(rowOf(orbitInfoRows(ISS, nf({ timeFormat: "%Y" })), "Epoch time:").value).toBe("2026");
    expect(rowOf(orbitInfoRows(ISS, nf({ timeFormat: "%d.%m.%y %H:%M" })), "Epoch time:").value).toBe("09.11.26 12:00");
  });

  it("floors the epoch to the second (Gpredict floors the fraction of the day), also with a time format that shows seconds", () => {
    const rows = orbitInfoRows(info({ epoch: "2026-11-09T12:34:56.999Z" }), nf({ timeFormat: "%H:%M:%S" }));
    expect(rowOf(rows, "Epoch time:").value).toBe("12:34:56");
  });

  it("shows the epoch in local time when the number format says so", () => {
    const local = rowOf(orbitInfoRows(ISS, nf({ timeFormat: "%H:%M", local: true })), "Epoch time:").value;
    const utc = rowOf(orbitInfoRows(ISS, nf({ timeFormat: "%H:%M", local: false })), "Epoch time:").value;
    const expected = new Date("2026-11-09T12:00:00.000Z");
    expect(utc).toBe("12:00");
    expect(local).toBe(`${String(expected.getHours()).padStart(2, "0")}:${String(expected.getMinutes()).padStart(2, "0")}`);
  });

  it("cuts a long time format to 49 characters and does not fail on an epoch it cannot read", () => {
    expect(rowOf(orbitInfoRows(ISS, nf({ timeFormat: "%Y".repeat(30) })), "Epoch time:").value).toHaveLength(49);
    expect(rowOf(orbitInfoRows(info({ epoch: "garbage" }), nf()), "Epoch time:").value).toBe("--/--/-- --:--:--");
  });

  it("says the status in Gpredict's words, and Unknown for anything else", () => {
    for (const s of ["Operational", "Non-operational", "Partially operational", "Backup/Standby", "Spare", "Extended Mission", "Unknown"]) {
      expect(statusText(s)).toBe(s);
    }
    expect(statusText("")).toBe("Unknown");
    expect(statusText("Decayed")).toBe("Unknown");
    expect(rowOf(orbitInfoRows(info({ status: "Spare" }), nf()), "Operational Status:").value).toBe("Spare");
  });

  it("writes - for a value that is not a number instead of NaN or Infinity", () => {
    const rows = orbitInfoRows(info({ incl_deg: Number.NaN, bstar: Number.POSITIVE_INFINITY, mean_motion: Number.NaN }), nf());
    expect(rowOf(rows, "Inclination:").value).toBe("-");
    expect(rowOf(rows, "B* drag term:").value).toBe("-");
    expect(rowOf(rows, "Mean motion:").value).toBe("-");
  });
});

describe("unreadableRows (orbit_info is null)", () => {
  it("shows the rows Gpredict can still show: the name, the status and the catalogue number", () => {
    const rows = unreadableRows({ norad: 25544, name: "ISS (ZARYA)", status: "Spare" });
    expect(rows).toEqual([
      { label: "Satellite name:", value: "ISS (ZARYA)", bold: true },
      { label: "Operational Status:", value: "Spare" },
      { label: "Catalogue number:", value: "25544" },
    ]);
  });

  it("is Unknown without a status (a server that does not send one), and has a Thai line to say why the rest is missing", () => {
    expect(unreadableRows({ norad: 1, name: "X" })[1]).toEqual({ label: "Operational Status:", value: "Unknown" });
    expect(UNREADABLE_TEXT).toMatch(/TLE/);
  });
});

describe("scriptParts", () => {
  it("splits text with <sub> and <sup> into plain, subscript and superscript parts", () => {
    expect(scriptParts("1.0e-4 [R<sub>E</sub><sup>-1</sup>]")).toEqual([
      { text: "1.0e-4 [R" },
      { text: "E", script: "sub" },
      { text: "-1", script: "sup" },
      { text: "]" },
    ]);
  });

  it("is one plain part without markup, and nothing for an empty text", () => {
    expect(scriptParts("15.49438945 [rev/day]")).toEqual([{ text: "15.49438945 [rev/day]" }]);
    expect(scriptParts("")).toEqual([]);
  });

  it("leaves a tag it does not know, and an unclosed one, as text", () => {
    expect(scriptParts("a<b>c</b>")).toEqual([{ text: "a<b>c</b>" }]);
    expect(scriptParts("x<sup>2")).toEqual([{ text: "x<sup>2" }]);
  });
});

describe("transponderLines (ref-D §8.2)", () => {
  it("transponder lines: a range up and down, inverting", () => {
    const lines = transponderLines(trsp({ up_low: 145.8e6, up_high: 145.9e6, down_low: 435.8e6, down_high: 435.9e6, invert: true }));
    expect(lines).toEqual(["Uplink: 145.8000 ‒ 145.9000 MHz", "Downlink: 435.8000 ‒ 435.9000 MHz", "Inverting: YES"]);
  });

  it("uses the figure dash U+2012 (bytes E2 80 92), not a hyphen or an en dash", () => {
    const [up] = transponderLines(trsp({ up_low: 1e6, up_high: 2e6 }));
    expect(up).toContain("‒");
    expect(up).not.toContain("-");
    expect(up).not.toContain("–");
  });

  it("writes Inverting: NO for a non-inverting transponder with both ranges", () => {
    const lines = transponderLines(trsp({ up_low: 145.8e6, up_high: 145.9e6, down_low: 435.8e6, down_high: 435.9e6, invert: false }));
    expect(lines[2]).toBe("Inverting: NO");
  });

  it("a beacon (one downlink frequency, no uplink) has only the Downlink line, and no Uplink", () => {
    expect(transponderLines(trsp({ down_low: 435.8e6, down_high: 435.8e6 }))).toEqual(["Downlink: 435.8000 MHz"]);
  });

  it("says Inverting only when both the uplink and the downlink are ranges", () => {
    const some = (over: Partial<Transponder>) => transponderLines(trsp({ invert: true, ...over })).some((l) => l.startsWith("Inverting"));
    expect(some({ up_low: 145.8e6, up_high: 145.9e6, down_low: 435.8e6, down_high: 435.8e6 })).toBe(false);
    expect(some({ up_low: 145.8e6, up_high: 145.8e6, down_low: 435.8e6, down_high: 435.9e6 })).toBe(false);
    expect(some({ down_low: 435.8e6, down_high: 435.9e6 })).toBe(false);
  });

  it("writes a single frequency for an equal pair, and nothing for a frequency that is 0", () => {
    expect(transponderLines(trsp({ up_low: 145.9e6, up_high: 145.9e6 }))).toEqual(["Uplink: 145.9000 MHz"]);
    expect(transponderLines(trsp({ up_low: 0, up_high: 145.9e6 }))).toEqual([]);
    expect(transponderLines(trsp())).toEqual([]);
  });

  it("writes the frequencies in MHz with 4 decimals", () => {
    expect(transponderLines(trsp({ down_low: 145_825_000 }))).toEqual(["Downlink: 145.8250 MHz"]);
    expect(transponderLines(trsp({ down_low: 1_234_567, down_high: 7_654_321 }))).toEqual(["Downlink: 1.2346 ‒ 7.6543 MHz"]);
  });

  it("writes the mode when there is one, also the number 0 that Gpredict writes when SatNOGS gave none", () => {
    expect(transponderLines(trsp({ mode: "FM" }))).toEqual(["Mode: FM"]);
    expect(transponderLines(trsp({ mode: "0" }))).toEqual(["Mode: 0"]);
    expect(transponderLines(trsp({ mode: "" }))).toEqual([]);
  });

  it("baud rate: 9600 is written as %9.2f", () => {
    expect(transponderLines(trsp({ baud: 9600 }))).toEqual(["Baudrate:   9600.00"]);
    expect(transponderLines(trsp({ baud: 1200.5 }))).toEqual(["Baudrate:   1200.50"]);
    expect(transponderLines(trsp({ baud: 1234567.891 }))).toEqual(["Baudrate: 1234567.89"]);
    expect(transponderLines(trsp({ baud: 12345678.9 }))).toEqual(["Baudrate: 12345678.90"]); // wider than 9: no cut
    expect(transponderLines(trsp({ baud: 0 }))).toEqual([]);
  });

  it("puts the lines in Gpredict's order: Uplink, Downlink, Inverting, Mode, Baudrate", () => {
    const lines = transponderLines(
      trsp({ up_low: 145.8e6, up_high: 145.9e6, down_low: 435.8e6, down_high: 435.9e6, invert: true, mode: "SSB", baud: 300 }),
    );
    expect(lines.map((l) => l.split(":")[0])).toEqual(["Uplink", "Downlink", "Inverting", "Mode", "Baudrate"]);
  });
});

describe("the Transponders tab", () => {
  it("transponder name is shown as text: markup characters in a name are written, not interpreted", () => {
    const html = renderToStaticMarkup(createElement(TransponderList, { transponders: [trsp({ name: "<b>A & B</b>", down_low: 435.8e6 })] }));
    expect(html).toContain("<b>&lt;b&gt;A &amp; B&lt;/b&gt;</b>"); // one bold element, with the characters of the name inside
    expect(html).not.toContain("<b><b>");
    expect(html).toContain("Downlink: 435.8000 MHz");
  });

  it("writes No transponders for an empty list", () => {
    expect(renderToStaticMarkup(createElement(TransponderList, { transponders: [] }))).toContain("No transponders");
  });

  it("lists every transponder in the order given, each with its name before its lines", () => {
    const html = renderToStaticMarkup(
      createElement(TransponderList, {
        transponders: [trsp({ name: "First", down_low: 435.8e6 }), trsp({ name: "Second", up_low: 145.9e6, mode: "FM" })],
      }),
    );
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Downlink: 435.8000 MHz"));
    expect(html.indexOf("Downlink: 435.8000 MHz")).toBeLessThan(html.indexOf("Second"));
    expect(html.indexOf("Second")).toBeLessThan(html.indexOf("Uplink: 145.9000 MHz"));
    expect(html).not.toContain("No transponders");
  });
});

describe("the Orbit Info tab", () => {
  it("writes the satellite name as text, and the exponent units as real sub- and superscripts", () => {
    const rows = orbitInfoRows(info({ name: "X<sup>2</sup> & Y" }), nf());
    const html = renderToStaticMarkup(createElement(OrbitInfoTable, { rows }));
    expect(html).toContain("X&lt;sup&gt;2&lt;/sup&gt; &amp; Y");
    expect(html).toContain("[rev/day<sup>2</sup>]");
    expect(html).toContain("R<sub>E</sub><sup>-1</sup>");
    expect(html).not.toContain("&lt;sub&gt;");
  });

  it("has a separator after the 7th row, and the names in bold in the first row", () => {
    const html = renderToStaticMarkup(createElement(OrbitInfoTable, { rows: orbitInfoRows(ISS, nf()) }));
    expect(html.match(/satinfo-separator/g)).toHaveLength(1);
    expect(html.indexOf("Orbit number @ epoch:")).toBeLessThan(html.indexOf("satinfo-separator"));
    expect(html.indexOf("satinfo-separator")).toBeLessThan(html.indexOf("Inclination:"));
    expect(html).toContain("<b>Satellite name:</b>");
    expect(html).toContain("<b>ISS (ZARYA)</b>");
  });

  it("has no separator when there are fewer rows than the separator comes after (the unreadable TLE's three rows)", () => {
    const html = renderToStaticMarkup(createElement(OrbitInfoTable, { rows: unreadableRows({ norad: 1, name: "X" }) }));
    expect(html).not.toContain("satinfo-separator");
  });
});

describe("the open Satellite Info windows", () => {
  it("opening adds a window at the end (in front) for the satellite", () => {
    const list = openSatInfo([], 25544);
    expect(list.map((w) => w.norad)).toEqual([25544]);
  });

  it("opens a window of its own every time, also for a satellite that already has one (Gpredict opens a new dialog each time)", () => {
    const list = openSatInfo(openSatInfo(openSatInfo([], 25544), 25544), 7530);
    expect(list.map((w) => w.norad)).toEqual([25544, 25544, 7530]);
    expect(new Set(list.map((w) => w.id)).size).toBe(3);
  });

  it("closing removes only that window", () => {
    const list = openSatInfo(openSatInfo([], 1), 2);
    const [first, second] = list;
    expect(closeSatInfo(list, first!.id).map((w) => w.id)).toEqual([second!.id]);
  });

  it("closing a window that is not open leaves the list as it is", () => {
    const list = openSatInfo([], 1);
    expect(closeSatInfo(list, "satinfo:nope")).toBe(list);
  });
});
