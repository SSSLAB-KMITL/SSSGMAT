import { describe, expect, it } from "vitest";
import { COMPUTING_TEXT, overlayFor } from "./overlay";
import type { Tick } from "./types";

const tick = (over: Partial<Tick> = {}): Tick => ({
  t: "2026-11-12T07:00:00.000Z",
  clock: { state: "forward", throttle: 1, label: "Real-Time" },
  status: "ok",
  qth: { name: "THBK", location: "Bangkok", lat_deg: 13.7, lon_deg: 100.7, alt_m: 6.4 },
  sun: { lat_deg: 0, lon_deg: 0 },
  window: { start: "2026-11-12T05:00:00.000Z", stop: "2026-11-12T21:00:00.000Z" },
  messages: [],
  ...over,
});

describe("overlayFor", () => {
  it("is nothing while the module is ok and connected", () => {
    expect(overlayFor(tick({ sats: [] }), true, null)).toBeNull();
  });

  it("status computing: the Thai GMAT text, no Retry", () => {
    const o = overlayFor(tick({ status: "computing" }), true, null);
    expect(o).toEqual({ kind: "computing", text: "กำลังคำนวณวงโคจรด้วย GMAT…" });
    expect(COMPUTING_TEXT).toBe("กำลังคำนวณวงโคจรด้วย GMAT…");
  });

  it("status failed: a Thai message with the server's detail, and Retry", () => {
    const o = overlayFor(
      tick({
        status: "failed",
        messages: [
          { code: "EPHEM_COMPUTING", level: "info", text: "ไม่เกี่ยว", object: null },
          { code: "GMAT_FAILED", level: "error", text: "GMAT หมดเวลา", object: null },
        ],
      }),
      true,
      null,
    );
    expect(o?.kind).toBe("failed");
    if (o?.kind === "failed") {
      expect(o.text).toBe("คำนวณวงโคจรด้วย GMAT ไม่สำเร็จ");
      expect(o.detail).toBe("GMAT หมดเวลา");
    }
  });

  it("status failed because GmatConsole is missing", () => {
    const o = overlayFor(
      tick({ status: "failed", messages: [{ code: "GMAT_NOT_FOUND", level: "error", text: "ไม่พบ GmatConsole", object: null }] }),
      true,
      null,
    );
    expect(o).toMatchObject({ kind: "failed", text: "ไม่พบ GMAT (GmatConsole)", detail: "ไม่พบ GmatConsole" });
  });

  it("status failed without any error message still gets a Retry and a text", () => {
    const o = overlayFor(tick({ status: "failed" }), true, null);
    expect(o).toMatchObject({ kind: "failed", text: "คำนวณวงโคจรด้วย GMAT ไม่สำเร็จ", detail: null });
  });

  it("not connected: connecting before the first tick, reconnecting after it", () => {
    expect(overlayFor(null, false, null)?.kind).toBe("connecting");
    expect(overlayFor(tick(), false, null)?.kind).toBe("disconnected");
    expect(overlayFor(tick({ status: "computing" }), false, 1006)?.kind).toBe("disconnected");
  });

  it("closed by the server with 1000 or 1008: says so, no reconnecting text", () => {
    expect(overlayFor(tick(), false, 1000)?.kind).toBe("gone");
    expect(overlayFor(null, false, 1008)?.kind).toBe("gone");
  });

  it("connected but no tick yet: still connecting", () => {
    expect(overlayFor(null, true, null)?.kind).toBe("connecting");
  });
});
