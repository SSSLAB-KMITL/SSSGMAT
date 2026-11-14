import { describe, expect, it } from "vitest";
import { boldSegments, tleDialogView, TLE_HEADING, TLE_HEADING_FILES } from "./tleUpdate";
import type { TleUpdateResult } from "./types";

const result = (over: Partial<TleUpdateResult> = {}): TleUpdateResult => ({ updated: 0, skipped: 0, missing: 0, new: 0, add_new: false, messages: [], ...over });

describe("tleDialogView (ref §1: dialog 'TLE Update')", () => {
  it("has the heading of Gpredict", () => {
    expect(TLE_HEADING).toBe("Updating TLE files from network");
  });

  it("files heading", () => {
    // menubar.c:746-747: the only text that differs from the network dialog
    expect(TLE_HEADING_FILES).toBe("Updating TLE files from files");
    expect(tleDialogView({ kind: "running" }, "files").heading).toBe("Updating TLE files from files");
    expect(tleDialogView({ kind: "running" }, "network").heading).toBe("Updating TLE files from network");
  });

  it("keeps the heading when the update is done or failed", () => {
    expect(tleDialogView({ kind: "done", result: result() }, "files").heading).toBe(TLE_HEADING_FILES);
    expect(tleDialogView({ kind: "failed", error: "x" }, "files").heading).toBe(TLE_HEADING_FILES);
  });

  it("while it runs: '...' and the three counts at 0, as Gpredict starts them", () => {
    expect(tleDialogView({ kind: "running" }, "network")).toEqual({
      heading: "Updating TLE files from network",
      activity: "...",
      stats: "Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n",
      finished: false,
      warnings: [],
      error: null,
    });
  });

  it("when done: 'Finished' and the counts of the server", () => {
    const view = tleDialogView({ kind: "done", result: result({ updated: 123, skipped: 4, missing: 5 }) }, "network");
    expect(view.activity).toBe("Finished");
    expect(view.stats).toBe("Satellites updated:\t 123\nSatellites skipped:\t 4\nMissing Satellites:\t 5\n");
    expect(view.finished).toBe(true);
    expect(view.error).toBeNull();
  });

  it("when done: the warnings and other messages of the server follow, in order and with their levels", () => {
    const messages = [
      { code: "ORBIT_DOWNLOAD_FAILED", level: "warning" as const, text: "ข้ามกลุ่ม gps-ops: ดึงไม่ได้และไม่มีไฟล์ใน cache", object: "gps-ops" },
      { code: "X", level: "info" as const, text: "ใช้ไฟล์ใน cache", object: null },
    ];
    expect(tleDialogView({ kind: "done", result: result({ messages }) }, "network").warnings).toEqual(messages);
  });

  it("when it failed: the Thai error text, the counts still at 0, and the dialog can be closed", () => {
    expect(tleDialogView({ kind: "failed", error: "ติดต่อ server ไม่ได้" }, "network")).toEqual({
      heading: "Updating TLE files from network",
      activity: "",
      stats: "Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n",
      finished: true,
      warnings: [],
      error: "ติดต่อ server ไม่ได้",
    });
  });

  it("result text with new satellites", () => {
    // tle-update.c:380-389: with add-new on the label is replaced by four lines, the last with two tabs and no line break after it
    const view = tleDialogView({ kind: "done", result: result({ updated: 1, skipped: 2, missing: 3, new: 4, add_new: true }) }, "network");
    expect(view.stats).toBe("Satellites updated:\t 1\nSatellites skipped:\t 2\nMissing Satellites:\t 3\nNew Satellites:\t\t 4");
  });

  it("result text without new satellites stays the three lines with the line break after the last", () => {
    // new is ignored when add_new is false (the server sends 0)
    const view = tleDialogView({ kind: "done", result: result({ updated: 1, skipped: 2, missing: 3, new: 4, add_new: false }) }, "files");
    expect(view.stats).toBe("Satellites updated:\t 1\nSatellites skipped:\t 2\nMissing Satellites:\t 3\n");
  });

  it("an update that no source answered shows the three lines at 0 (the server sends zeros and add_new false)", () => {
    const view = tleDialogView({ kind: "done", result: result() }, "network");
    expect(view.stats).toBe("Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n");
    expect(view.activity).toBe("Finished");
  });
});

describe("boldSegments (the text of the notice 'TLE files are getting out of date', Pango markup of main.c:519-527)", () => {
  const TEXT = "Your TLE files are getting out of date.\nYou can update them by selecting\n<b>Edit -> Update TLE</b>\nin the menubar.";

  it("splits the text of Gpredict into plain, bold and plain, keeping the line breaks", () => {
    expect(boldSegments(TEXT)).toEqual([
      { text: "Your TLE files are getting out of date.\nYou can update them by selecting\n", bold: false },
      { text: "Edit -> Update TLE", bold: true },
      { text: "\nin the menubar.", bold: false },
    ]);
  });

  it("gives one plain segment for text with no tag", () => {
    expect(boldSegments("hello\nworld")).toEqual([{ text: "hello\nworld", bold: false }]);
  });

  it("handles several bold parts and a bold part at either end", () => {
    expect(boldSegments("<b>a</b> and <b>b</b>")).toEqual([
      { text: "a", bold: true },
      { text: " and ", bold: false },
      { text: "b", bold: true },
    ]);
  });

  it("takes any other markup as plain text, never as HTML", () => {
    expect(boldSegments("x <i>y</i> <script>z</script>")).toEqual([{ text: "x <i>y</i> <script>z</script>", bold: false }]);
    expect(boldSegments("<b>a <i>b</i></b>")).toEqual([{ text: "a <i>b</i>", bold: true }]);
  });

  it("leaves a tag that is not closed as text", () => {
    expect(boldSegments("a <b>b")).toEqual([{ text: "a <b>b", bold: false }]);
    expect(boldSegments("a </b> b")).toEqual([{ text: "a </b> b", bold: false }]);
  });

  it("gives nothing for the empty text", () => {
    expect(boldSegments("")).toEqual([]);
  });
});
