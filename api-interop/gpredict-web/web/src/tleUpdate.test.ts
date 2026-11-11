import { describe, expect, it } from "vitest";
import { tleDialogView, TLE_HEADING } from "./tleUpdate";
import type { TleUpdateResult } from "./types";

const result = (over: Partial<TleUpdateResult> = {}): TleUpdateResult => ({ updated: 0, skipped: 0, missing: 0, messages: [], ...over });

describe("tleDialogView (ref §1: dialog 'TLE Update')", () => {
  it("has the heading of Gpredict", () => {
    expect(TLE_HEADING).toBe("Updating TLE files from network");
  });

  it("while it runs: '...' and the three counts at 0, as Gpredict starts them", () => {
    expect(tleDialogView({ kind: "running" })).toEqual({
      activity: "...",
      stats: "Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n",
      finished: false,
      warnings: [],
      error: null,
    });
  });

  it("when done: 'Finished' and the counts of the server", () => {
    const view = tleDialogView({ kind: "done", result: result({ updated: 123, skipped: 4, missing: 5 }) });
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
    expect(tleDialogView({ kind: "done", result: result({ messages }) }).warnings).toEqual(messages);
  });

  it("when it failed: the Thai error text, the counts still at 0, and the dialog can be closed", () => {
    expect(tleDialogView({ kind: "failed", error: "ติดต่อ server ไม่ได้" })).toEqual({
      activity: "",
      stats: "Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n",
      finished: true,
      warnings: [],
      error: "ติดต่อ server ไม่ได้",
    });
  });
});
