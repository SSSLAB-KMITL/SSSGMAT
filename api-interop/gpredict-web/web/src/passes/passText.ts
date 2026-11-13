// The text of the files that Save writes in Pass details and Upcoming passes, in the layout of Gpredict's pass-to-txt.c and
// save-pass.c (ref-P §8): every space, separator and header is as Gpredict writes it. The builders are pure; `downloadText` at
// the end is the only function here that touches the page.
//
// Numbers are never converted (km, km/s), Lat and Lon are signed degrees, and the times are UTC in the default time format: the
// preferences "Use Imperial units", "Use N/S/E/W", "Show local time instead of UTC" and "Time format" come with sub-project 4
// (as in passCells.ts, whose cells this file reuses). Gpredict has no case where a number is missing; the "-" of passCells would
// show there (ของเรา).

import { passCell, rowCell } from "./passCells";
import type { PassInfo, PassQth, PassRow, PassSat } from "./types";

// ---------------------------------------------------------------- the "File contents:" choices (ref-P §8.1, §8.2)

/** Save Pass Details, in the order of the values 0-2 of `PREDICT/SAVE_CONTENTS` (`save-pass.c:159-173`). */
export const SAVE_CONTENTS_LABELS = ["Info+header+data", "Header + data", "Data only"] as const;

/** Save Passes: 0 is the complete report, 1 the summary (`save-pass.c:300-310`). */
export const SAVE_PASSES_LABELS = ["Complete report", "Summary"] as const;

export type OneContents = 0 | 1 | 2;

/** A value of `PREDICT/SAVE_CONTENTS`, or the index of a choice, as a choice of Save Pass Details: 0 to 2, anything else 0 (the default). */
export const oneContents = (v: unknown): OneContents => (v === 1 || v === 2 ? v : 0);

/** The same for Save Passes, which has two choices: 1 is the summary, anything else the complete report. */
export const listContents = (v: unknown): 0 | 1 => (v === 1 ? 1 : 0);

// ---------------------------------------------------------------- the table of one pass (pass-to-txt.c SPCT, COLW)

interface TextColumn {
  title: string;
  /** the title as the title line has it, with its padding */
  head: string;
  /** the width of the column: the separator line is as long as the columns and their spaces */
  width: number;
}

/** Az to Vis: Time is not here, it is always in the table and its width is that of the time. Gpredict's fixed order. */
const ONE_COLUMNS: readonly TextColumn[] = [
  { title: "Az", head: "  Az  ", width: 6 },
  { title: "El", head: "   El ", width: 6 },
  { title: "Ra", head: "  Ra  ", width: 6 },
  { title: "Dec", head: "  Dec ", width: 6 },
  { title: "Range", head: "Range", width: 5 },
  { title: "Rate", head: " Rate ", width: 6 },
  { title: "Lat", head: "  Lat ", width: 6 },
  { title: "Lon", head: "  Lon  ", width: 7 },
  { title: "SSP", head: " SSP  ", width: 6 },
  { title: "Footp", head: "Footp", width: 5 },
  { title: "Alt", head: " Alt ", width: 5 },
  { title: "Vel", head: " Vel ", width: 5 },
  { title: "Dop", head: " Dop ", width: 5 },
  { title: "Loss", head: " Loss ", width: 6 },
  { title: "Del", head: " Del ", width: 5 },
  { title: "MA", head: "  MA  ", width: 6 },
  { title: "Phase", head: " Pha  ", width: 6 },
  { title: "Vis", head: "Vis", width: 3 },
];

/** Duration to Vis of Upcoming passes (pass-to-txt.c MPCT, MCW): AOS, TCA and LOS are always in the table. */
const LIST_COLUMNS: readonly TextColumn[] = [
  { title: "Duration", head: "Duration", width: 8 },
  { title: "Max El", head: "Max El", width: 6 },
  { title: "AOS Az", head: "AOS Az", width: 6 },
  { title: "Max El Az", head: "Max El Az", width: 9 },
  { title: "LOS Az", head: "LOS Az", width: 6 },
  { title: "Orbit", head: "Orbit", width: 5 },
  { title: "Vis", head: "Vis", width: 3 },
];

const spaces = (n: number): string => " ".repeat(Math.max(0, n));

/** A cell of passCells as a bare number: no degree sign, and none of the space after it that stands for N/S/E/W. */
const bare = (cell: string): string => cell.replace(/°\s*$/, "");

/** The separator, the title line and the separator again (every line ends with a newline). */
const tableHead = (title: string, length: number): string => `${"-".repeat(length)}\n${title}\n${"-".repeat(length)}\n`;

/** The lines of a table, each with its newline. */
const lines = (rows: readonly string[]): string => rows.map((r) => `${r}\n`).join("");

/** The three lines of the table header of one pass (`pass_to_txt_tblheader`): the Time column, then each of `columns` in the fixed order. */
function oneTableHeader(pass: PassInfo, columns: readonly string[]): string {
  const size = passCell(pass, "AOS").length; // the time of AOS gives the width of the Time column
  let title = ` Time${spaces(size - 4)}`;
  let length = size + 1;
  for (const c of ONE_COLUMNS) {
    if (!columns.includes(c.title)) continue;
    title += ` ${c.head}`;
    length += c.width + 1;
  }
  return tableHead(title, length);
}

/** One cell of a row of one pass, with its separator, or "" for a column that has nothing to write (an SSP that could not be found). */
function oneCell(row: PassRow, c: TextColumn): string {
  switch (c.title) {
    case "SSP":
      return row.ssp === "" ? "" : ` ${row.ssp}`; // no padding when there is no locator
    case "Vis":
      return `  ${row.vis}`; // two spaces and the character
    default:
      return ` ${bare(rowCell(row, c.title)).padStart(c.width)}`;
  }
}

/** The rows of one pass (`pass_to_txt_tblcontents`). */
function oneRows(pass: PassInfo, columns: readonly string[]): string {
  const shown = ONE_COLUMNS.filter((c) => columns.includes(c.title));
  return lines(pass.rows.map((row) => ` ${rowCell(row, "Time")}${shown.map((c) => oneCell(row, c)).join("")}`));
}

/** The "Observer:" and "LAT:" lines that both page headers have. */
const observerLines = (qth: PassQth): string => `Observer: ${qth.name}, ${qth.location}\nLAT:${qth.lat_deg.toFixed(2)} LON:${qth.lon_deg.toFixed(2)}\n`;

// ---------------------------------------------------------------- one pass (ref-P §8.3)

/**
 * The file of Save Pass Details. `columns` are the titles of the Single Pass columns that are on (`PREDICT/SINGLE_PASS_COL`);
 * Time is always written, and the order is Gpredict's whatever the order of `columns`. `contents` is `PREDICT/SAVE_CONTENTS`:
 * 0 the page header (5 lines), the table header and the rows; 1 the table header and the rows; 2 the rows.
 */
export function onePassText(a: { sat: PassSat; qth: PassQth; pass: PassInfo }, columns: readonly string[], contents: OneContents): string {
  const { sat, qth, pass } = a;
  const rows = oneRows(pass, columns);
  if (contents === 2) return rows;
  const table = oneTableHeader(pass, columns) + rows;
  if (contents === 1) return table;
  const header =
    `Pass details for ${sat.name} (orbit ${pass.orbit})\n` +
    observerLines(qth) +
    `AOS: ${passCell(pass, "AOS")} UTC\n` +
    `LOS: ${passCell(pass, "LOS")} UTC\n`;
  return header + table;
}

// ---------------------------------------------------------------- the pass list (ref-P §8.4)

/** The table header of the list (`passes_to_txt_tblheader`): AOS, TCA and LOS, then each of `columns` from Duration on, in the fixed order. */
function listTableHeader(first: PassInfo, columns: readonly string[]): string {
  const size = passCell(first, "AOS").length; // the width of the three time columns comes from the AOS of the first pass
  const pad = spaces(size - 3);
  let title = ` AOS${pad}  TCA${pad}  LOS${pad}`;
  let length = 3 * (size + 2);
  for (const c of LIST_COLUMNS) {
    if (!columns.includes(c.title)) continue;
    title += `  ${c.head}`;
    length += c.width + 2;
  }
  return tableHead(title, length);
}

/** The rows of the list (`passes_to_txt_tblcontents`): a line for each pass. */
function listRows(passes: readonly PassInfo[], columns: readonly string[]): string {
  const shown = LIST_COLUMNS.filter((c) => columns.includes(c.title));
  return lines(
    passes.map(
      (p) =>
        ` ${passCell(p, "AOS")}  ${passCell(p, "TCA")}  ${passCell(p, "LOS")}` +
        shown.map((c) => `  ${bare(passCell(p, c.title)).padStart(c.width)}`).join(""),
    ),
  );
}

/**
 * The file of Save Passes. `columns` are the Multiple Passes columns that are on (`PREDICT/MULTI_PASS_COL`; AOS, TCA and LOS are
 * always written); `singleColumns` are the Single Pass columns, for the block of every pass in the complete report. `contents`:
 * 0 the complete report (the summary, then for each pass an empty line, " Orbit <n>" and that pass's table of §8.3), 1 the summary
 * (the page header of 3 lines, the table header and a line for each pass). An empty list gives no text: the server never sends one.
 *
 * The complete report needs both sets of columns (`save-pass.c:448-480`), so there are two. Nothing in the file is the current time:
 * Gpredict writes no date, every time is the pass's own.
 */
export function passListText(
  a: { sat: PassSat; qth: PassQth; passes: PassInfo[] },
  columns: readonly string[],
  contents: 0 | 1,
  singleColumns: readonly string[],
): string {
  const { sat, qth, passes } = a;
  const first = passes[0];
  if (first === undefined) return "";
  let text = `Upcoming passes for ${sat.name}\n${observerLines(qth)}${listTableHeader(first, columns)}${listRows(passes, columns)}`;
  if (contents === 0) {
    for (const pass of passes) text += `\n Orbit ${pass.orbit}\n${oneTableHeader(pass, singleColumns)}${oneRows(pass, singleColumns)}`;
  }
  return text;
}

// ---------------------------------------------------------------- file names (ref-P §8.1, §8.2)

/** The entry "Save using file name:" takes at most this many characters (`gtk_entry_set_max_length(..., 100)`). */
export const FILE_NAME_MAX = 100;

/** The characters Gpredict turns into "_" in the default name (`g_strdelimit(..., "!?/\\()*&%$#@[]{}=+<>,.|:;", '_')`). */
const REPLACED = /[!?/\\()*&%$#@[\]{}=+<>,.|:;]/g;

/**
 * What the entry keeps of a text while it is typed (`gpredict_legal_char`): ASCII letters, digits, "-" and "_", at most 100
 * characters. Gpredict deletes any other character with a beep.
 */
export const cleanFileName = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, FILE_NAME_MAX);

/** Whether the Save button works: the name is 1 to 100 characters of A-Z a-z 0-9 - _ . */
export const validFileName = (s: string): boolean => /^[A-Za-z0-9_-]{1,100}$/.test(s);

/**
 * The name the entry starts with, without ".txt": `<satellite>-<orbit>` for one pass (Save Pass Details), `<satellite>-passes` for the
 * list. Spaces become "-", the characters of `REPLACED` become "_", and what is left that the entry would not take is dropped.
 */
export function defaultFileName(kind: "one", satName: string, orbit: number): string;
export function defaultFileName(kind: "list", satName: string): string;
export function defaultFileName(kind: "one" | "list", satName: string, orbit?: number): string {
  const name = kind === "one" ? `${satName}-${orbit}` : `${satName}-passes`;
  return cleanFileName(name.replace(/ /g, "-").replace(REPLACED, "_"));
}

// ---------------------------------------------------------------- the file

/**
 * Hand `text` to the browser as the file `<name>.txt` (it goes to the browser's download folder: a page cannot choose a folder, and
 * Gpredict's overwrite without asking is the browser's business, ของเรา). The only function of this file that uses the page: it
 * is not tested here, the file itself is checked in the browser.
 */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.txt`;
  document.body.appendChild(link); // some browsers ignore the click on a link that is not in the page
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // not at once: the download may not have started
}
