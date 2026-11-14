import { describe, expect, it } from "vitest";
import {
  currentLogPath,
  LEVEL_NAMES,
  logBrowserTitle,
  logFileTooLarge,
  logFileTooLargeText,
  LOG_CORRUPT_TEXT,
  LOG_FILE_MAX,
  logSummary,
  parseLog,
  parseLogLine,
} from "./logParse";

describe("LEVEL_NAMES (ref-D §7.3)", () => {
  it("is Gpredict's level text, indexed by the numeric level", () => {
    expect(LEVEL_NAMES).toEqual(["NONE", "ERROR", "WARNING", "INFO", "DEBUG"]);
  });
});

describe("parseLogLine (ref-D §7.3, sat-log-browser.c:140-181)", () => {
  it("three fields", () => {
    expect(parseLogLine("2026/11/12 05:06:07|2|f: a")).toEqual({ time: "2026/11/12 05:06:07", level: 2, message: "f: a" });
  });

  it("message with a bar", () => {
    // Gpredict splits at every bar and so reads "t|3|f: a|b" as the old four-field format (a level of "f: a" is 0 for it, and the
    // message is cut at the bar); the message is everything after the level here
    expect(parseLogLine("t|3|f: a|b")).toEqual({ time: "t", level: 3, message: "f: a|b" });
    expect(parseLogLine("t|3|a|b|c")).toEqual({ time: "t", level: 3, message: "a|b|c" });
    expect(parseLogLine("t|3|f: |")).toEqual({ time: "t", level: 3, message: "f: |" });
  });

  it("old four-field format", () => {
    expect(parseLogLine("t|src|1|msg")).toEqual({ time: "t", level: 1, message: "msg" });
    // the message of an old line can have a bar as well
    expect(parseLogLine("t|src|4|a|b")).toEqual({ time: "t", level: 4, message: "a|b" });
  });

  it("one field", () => {
    expect(parseLogLine("garbage")).toEqual({ time: "", level: 1, message: "garbage" });
  });

  it("corrupt", () => {
    // the level is not a number: Gpredict reads it as 0 (NONE), the brief makes the row "Log file is corrupt" at ERROR
    expect(parseLogLine("t|x|y")).toEqual({ time: "", level: 1, message: "Log file is corrupt" });
    expect(LOG_CORRUPT_TEXT).toBe("Log file is corrupt");
  });

  it("two fields, or a level that is not a number in the old format, are corrupt too", () => {
    const corrupt = { time: "", level: 1, message: LOG_CORRUPT_TEXT };
    expect(parseLogLine("t|3")).toEqual(corrupt);
    expect(parseLogLine("t|src|x|msg")).toEqual(corrupt);
    expect(parseLogLine("t|src|3")).toEqual(corrupt);
    expect(parseLogLine("t||msg")).toEqual(corrupt);
  });

  it("a level that has no name is corrupt (Gpredict reads past its table of names)", () => {
    const corrupt = { time: "", level: 1, message: LOG_CORRUPT_TEXT };
    expect(parseLogLine("t|5|msg")).toEqual(corrupt);
    expect(parseLogLine("t|-1|msg")).toEqual(corrupt);
    expect(parseLogLine("t|2.5|msg")).toEqual(corrupt);
    expect(parseLogLine("t|99999999999999999999|msg")).toEqual(corrupt);
  });

  it("level 0 is NONE and an empty message is a message", () => {
    expect(parseLogLine("t|0|m")).toEqual({ time: "t", level: 0, message: "m" });
    expect(parseLogLine("t|3|")).toEqual({ time: "t", level: 3, message: "" });
  });

  it("an empty line is corrupt (g_strsplit of \"\" has no field)", () => {
    expect(parseLogLine("")).toEqual({ time: "", level: 1, message: LOG_CORRUPT_TEXT });
  });

  it("keeps the text exactly as it is, markup included", () => {
    expect(parseLogLine("t|1|f: <b>x</b> & \"y\"")).toEqual({ time: "t", level: 1, message: "f: <b>x</b> & \"y\"" });
  });
});

describe("parseLog", () => {
  const T = "2026/11/12 05:06:07";

  it("one row for each line, in the order of the file", () => {
    const text = `${T}|3|sat_log_init: Session started\n${T}|2|f: careful\n${T}|1|g: broken\n`;
    expect(parseLog(text).map((r) => [r.level, r.message])).toEqual([
      [3, "sat_log_init: Session started"],
      [2, "f: careful"],
      [1, "g: broken"],
    ]);
  });

  it("has no rows for a file that is empty (the server gives \"\" when there is no file)", () => {
    expect(parseLog("")).toEqual([]);
  });

  it("the newline that ends the last line does not start another line, and a last line without one is read", () => {
    expect(parseLog(`${T}|3|f: a\n`)).toHaveLength(1);
    expect(parseLog(`${T}|3|f: a`)).toHaveLength(1);
    expect(parseLog(`${T}|3|f: a\n${T}|3|f: b`)).toHaveLength(2);
  });

  it("splits at \\n, \\r\\n and \\r, as g_io_channel_read_line does", () => {
    expect(parseLog(`${T}|3|a\r\n${T}|3|b\r${T}|3|c\n`).map((r) => r.message)).toEqual(["a", "b", "c"]);
  });

  it("a blank line in the middle is a corrupt row, as in Gpredict", () => {
    expect(parseLog(`${T}|3|a\n\n${T}|3|b\n`).map((r) => r.message)).toEqual(["a", LOG_CORRUPT_TEXT, "b"]);
  });

  it("each line of a message that is written on several lines is a row of its own, with the same time and level", () => {
    const rows = parseLog(`${T}|2|f: first\n${T}|2|f: second\n`);
    expect(rows).toEqual([
      { time: T, level: 2, message: "f: first" },
      { time: T, level: 2, message: "f: second" },
    ]);
  });
});

describe("logSummary (ref-D §7.3)", () => {
  const T = "2026/11/12 05:06:07";
  const text = [1, 1, 2, 3, 3, 3, 4, 4, 4, 4].map((l, i) => `${T}|${l}|f: m${i}`).join("\n");

  it("counts the rows of each level and the total", () => {
    expect(logSummary(parseLog(text))).toEqual({ errors: 2, warnings: 1, info: 3, debug: 4, total: 10 });
  });

  it("starts at 0 for no rows", () => {
    expect(logSummary([])).toEqual({ errors: 0, warnings: 0, info: 0, debug: 0, total: 0 });
  });

  it("total is the sum of the four counts: NONE rows are in the list but not in the summary", () => {
    const rows = parseLog(`${T}|0|f: none\n${T}|3|f: info\n`);
    expect(rows).toHaveLength(2);
    expect(logSummary(rows)).toEqual({ errors: 0, warnings: 0, info: 1, debug: 0, total: 1 });
  });

  it("counts a row that is corrupt as an error", () => {
    expect(logSummary(parseLog("garbage\nt|x|y\n"))).toEqual({ errors: 2, warnings: 0, info: 0, debug: 0, total: 2 });
  });

  it("summary and clear", () => {
    // Gpredict's Clear forgets to zero the Info counter (sat-log-browser.c:97-112), so its label says 0 while the next file is counted
    // from the old number. Here the counts come from the rows alone: Clear shows 0 for every one, Info too, and a file read again counts from 0
    const rows = parseLog(text);
    expect(logSummary(rows).info).toBe(3);
    const cleared = logSummary([]);
    expect(cleared).toEqual({ errors: 0, warnings: 0, info: 0, debug: 0, total: 0 });
    expect(logSummary(parseLog(text))).toEqual({ errors: 2, warnings: 1, info: 3, debug: 4, total: 10 });
  });
});

describe("logBrowserTitle (ref-D §7.3)", () => {
  it("is \"Log Browser\" with no file read, and \"Log Browser: <file>\" with one", () => {
    expect(logBrowserTitle(null)).toBe("Log Browser");
    expect(logBrowserTitle("gpredict-1700000000.log")).toBe("Log Browser: gpredict-1700000000.log");
  });
});

describe("currentLogPath", () => {
  it("is the file gpredict.log in the folder of the logs", () => {
    expect(currentLogPath("/home/me/data/logs")).toBe("/home/me/data/logs/gpredict.log");
    expect(currentLogPath("/home/me/data/logs/")).toBe("/home/me/data/logs/gpredict.log");
  });

  it("uses the separator of the folder it is given", () => {
    expect(currentLogPath("C:\\Users\\me\\logs")).toBe("C:\\Users\\me\\logs\\gpredict.log");
  });
});

describe("logFileTooLarge (ของเรา: the Open button takes any file the user picks)", () => {
  it("the limit is 10 MB: a file of exactly that size is read, one byte more is refused", () => {
    expect(LOG_FILE_MAX).toBe(10 * 1024 * 1024);
    expect(logFileTooLarge(0)).toBe(false);
    expect(logFileTooLarge(LOG_FILE_MAX)).toBe(false);
    expect(logFileTooLarge(LOG_FILE_MAX + 1)).toBe(true);
    expect(logFileTooLarge(50 * 1024 * 1024)).toBe(true);
  });

  it("says in Thai which file is refused and the limit", () => {
    expect(logFileTooLargeText("big.log")).toBe("ไฟล์ big.log ใหญ่เกิน 10 MB เปิดใน Log Browser ไม่ได้");
  });
});
