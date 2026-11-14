// File → Log browser (ref-D §7.3, sat-log-browser.c): the lines of a log file as rows, and the counts of the Summary frame. Pure;
// components/LogBrowser.tsx shows it. The line format is the one the server writes (ref-D §7.2): `YYYY/MM/DD HH:MM:SS|<level>|<message>`.

/** The text of the Level column, indexed by the numeric level (sat-log-browser.c:53-59). */
export const LEVEL_NAMES = ["NONE", "ERROR", "WARNING", "INFO", "DEBUG"] as const;

/** The message of a line that is not a log line (`:174-178`). */
export const LOG_CORRUPT_TEXT = "Log file is corrupt";

/** One row of the list. `time` is the text of the file as it is (empty for a line with no time); `level` is an index of LEVEL_NAMES. */
export interface LogRow {
  time: string;
  level: number;
  message: string;
}

/** The counts of the Summary frame: Errors, Warnings, Info, Debug and Total. */
export interface LogSummary {
  errors: number;
  warnings: number;
  info: number;
  debug: number;
  total: number;
}

const SEPARATOR = "|";
const ERROR = 1;
const WARNING = 2;
const INFO = 3;
const DEBUG = 4;

const corrupt = (): LogRow => ({ time: "", level: ERROR, message: LOG_CORRUPT_TEXT });

/**
 * The level of a field of a line: its digits, as a number, when that is a level that has a name in LEVEL_NAMES, else null.
 * (ของเรา) Gpredict reads the field with g_ascii_strtod, so a field that is not a number is the level 0 for it and one above 4 reads
 * past its table of names; both make the row "Log file is corrupt" here.
 */
function levelOf(field: string): number | null {
  if (!/^\d+$/.test(field)) return null;
  const level = Number(field);
  return level < LEVEL_NAMES.length ? level : null;
}

/**
 * One line of a log file as a row (`:140-181`). Three fields, `time|level|message`, are the format of Gpredict 1.4 and later; four,
 * `time|source|level|message`, that of 1.3 and earlier (the source is not shown); a line with no bar is a message with no time, at ERROR;
 * anything else, and any field of a level that is not a level, is the row "Log file is corrupt" at ERROR.
 *
 * (ของเรา) Gpredict splits the line at every bar, so a message that has a bar in it (the server writes any text it is given) is cut
 * there or taken for the old format. Here the line is split at the first two bars (three in the old format) and the message is the rest:
 * "t|3|f: a|b" is the message "f: a|b".
 */
export function parseLogLine(line: string): LogRow {
  const timeEnd = line.indexOf(SEPARATOR);
  if (timeEnd < 0) return line === "" ? corrupt() : { time: "", level: ERROR, message: line };
  const time = line.slice(0, timeEnd);
  const afterTime = line.slice(timeEnd + 1);
  const secondEnd = afterTime.indexOf(SEPARATOR);
  if (secondEnd < 0) return corrupt();
  const second = afterTime.slice(0, secondEnd);
  const afterSecond = afterTime.slice(secondEnd + 1);
  const level = levelOf(second);
  if (level !== null) return { time, level, message: afterSecond };
  // the second field is the message source of the old format: the level is the third
  const thirdEnd = afterSecond.indexOf(SEPARATOR);
  if (thirdEnd < 0) return corrupt();
  const oldLevel = levelOf(afterSecond.slice(0, thirdEnd));
  return oldLevel === null ? corrupt() : { time, level: oldLevel, message: afterSecond.slice(thirdEnd + 1) };
}

const LINE_END = /\r\n|\r|\n/;

/**
 * The rows of a log file, one for each line, in the order of the file. The lines end at "\n", "\r\n" or "\r" (what g_io_channel_read_line
 * takes for the end of a line); the end of the last line is not the start of another one. A blank line in the middle is a row of its own
 * (it is "Log file is corrupt": g_strsplit of an empty line gives no field). A text with no line, a file that is empty, has no rows.
 */
export function parseLog(text: string): LogRow[] {
  const lines = text.split(LINE_END);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map(parseLogLine);
}

/**
 * The counts of the Summary frame (`:299-371`, `:540-585`): the rows of each level, and the total of those four. A NONE row is in the list
 * and not in the counts. (ของเรา) Gpredict's Clear leaves the Info count where it was (`:97-112`, so the label says 0 and the next file is
 * counted from the old number); here every count is made from the rows that are in the list, so Clear zeroes all of them and a file read
 * again counts from 0.
 */
export function logSummary(rows: readonly LogRow[]): LogSummary {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  let debug = 0;
  for (const { level } of rows) {
    if (level === ERROR) errors++;
    else if (level === WARNING) warnings++;
    else if (level === INFO) info++;
    else if (level === DEBUG) debug++;
  }
  return { errors, warnings, info, debug, total: errors + warnings + info + debug };
}

/** The title of the window: "Log Browser", and "Log Browser: <file>" while a file that was read is shown (`:511-523`). */
export const logBrowserTitle = (file: string | null): string => (file === null ? "Log Browser" : `Log Browser: ${file}`);

/** The file the server writes (`gpredict.log` in its folder of logs, GET /api/meta `log_dir`), written with the separator the folder uses. */
export function currentLogPath(logDir: string): string {
  const sep = logDir.includes("/") || !logDir.includes("\\") ? "/" : "\\";
  return logDir.endsWith(sep) ? `${logDir}gpredict.log` : `${logDir}${sep}gpredict.log`;
}
