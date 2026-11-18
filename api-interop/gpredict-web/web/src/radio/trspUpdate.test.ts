import { describe, expect, it } from "vitest";
import { TRSP_HEADING, TRSP_STATS, TRSP_TITLE, trspDialogView } from "./trspUpdate";
import type { TrspUpdateAnswer } from "./types";

const answer = (over: Partial<TrspUpdateAnswer> = {}): TrspUpdateAnswer => ({
  status: "Finished",
  cached: false,
  fetched_at: "2026-11-14T03:00:00.000Z",
  satellites: 812,
  messages: [{ code: "TRSP_UPDATED", level: "info", text: "ดึงข้อมูล transponder จาก SatNOGS DB เมื่อ 2026-11-14 03:00:00 UTC", object: null }],
  ...over,
});

describe("the Transponder Update dialog (ref-R §11.1, spec §7.1)", () => {
  it("has Gpredict's title, its bold line and the statistics label that is never filled in", () => {
    expect(TRSP_TITLE).toBe("Transponder Update");
    expect(TRSP_HEADING).toBe("Updating transponder files from network");
    expect(TRSP_STATS).toBe("\n");
  });

  it("shows ... and then Fetching transmitters.json while it waits, with the bar empty and Close greyed out", () => {
    expect(trspDialogView({ kind: "start" })).toEqual({ activity: "...", progress: 0, finished: false, lines: [] });
    expect(trspDialogView({ kind: "fetching" })).toEqual({ activity: "Fetching transmitters.json", progress: 0, finished: false, lines: [] });
  });

  it("shows Finished, the bar at 100 % and Close when done, and the Thai lines of the answer under Finished", () => {
    const done = answer();
    expect(trspDialogView({ kind: "done", answer: done })).toEqual({ activity: "Finished", progress: 1, finished: true, lines: done.messages });
  });

  it("shows Finished for a download that failed as well, with the Thai reason (Gpredict shows Finished either way)", () => {
    const failed = answer({
      cached: true,
      satellites: 0,
      messages: [{ code: "TRSP_DOWNLOAD_FAILED", level: "warning", text: "ดึงข้อมูล transponder จาก SatNOGS DB ไม่สำเร็จ", object: null }],
    });
    expect(trspDialogView({ kind: "done", answer: failed })).toMatchObject({ activity: "Finished", progress: 1, finished: true, lines: failed.messages });
  });

  it("keeps every line of the answer in order: the rate limit, then a file that could not be written", () => {
    const messages = [
      { code: "TRSP_RATE_LIMITED_LOCAL", level: "info" as const, text: "ยังไม่ส่งคำขอใหม่", object: null },
      { code: "TRSP_WRITE_FAILED", level: "warning" as const, text: "เขียนไฟล์ transponder ไม่ได้ 1 ดวง", object: "25544" },
    ];
    expect(trspDialogView({ kind: "done", answer: answer({ cached: true, messages }) }).lines).toEqual(messages);
  });

  it("says when the data was fetched if the answer has no line (from fetched_at), and that it never was", () => {
    expect(trspDialogView({ kind: "done", answer: answer({ messages: [] }) }).lines).toEqual([
      { code: "TRSP_FETCHED_AT", level: "info", text: "ข้อมูล transponder ที่ใช้อยู่ดึงจาก SatNOGS DB เมื่อ 2026-11-14 03:00:00 UTC", object: null },
    ]);
    expect(trspDialogView({ kind: "done", answer: answer({ fetched_at: null, messages: [] }) }).lines).toEqual([
      { code: "TRSP_FETCHED_AT", level: "info", text: "ยังไม่เคยดึงข้อมูล transponder จาก SatNOGS DB", object: null },
    ]);
  });

  it("shows Finished and why when the server could not be asked", () => {
    expect(trspDialogView({ kind: "failed", error: "ติดต่อ server ไม่ได้" })).toEqual({
      activity: "Finished",
      progress: 1,
      finished: true,
      lines: [{ code: "REQUEST_FAILED", level: "error", text: "ติดต่อ server ไม่ได้", object: null }],
    });
  });
});
