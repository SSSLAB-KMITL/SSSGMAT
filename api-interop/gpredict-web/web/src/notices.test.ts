import { describe, expect, it } from "vitest";
import { pruneDismissed, startupNotices, tickNotices, visibleNotices } from "./notices";
import type { Tick } from "./types";

const baseTick: Tick = {
  t: "2026-11-12T07:00:00.000Z",
  clock: { state: "forward", throttle: 1, label: "Real-Time" },
  status: "ok",
  qth: { name: "THBK", location: "Bangkok", lat_deg: 13.7, lon_deg: 100.7, alt_m: 6.4 },
  sun: { lat_deg: 0, lon_deg: 0 },
  window: { start: "2026-11-12T05:00:00.000Z", stop: "2026-11-12T21:00:00.000Z" },
  sats: [],
  messages: [],
};

describe("startupNotices (messages of GET /api/modules)", () => {
  it("turns each message into a notice with its level and text", () => {
    const notices = startupNotices([
      { code: "ORBIT_DOWNLOAD_FAILED", level: "warning", text: "ดึง TLE ไม่ได้ ให้กด Edit → Update TLE data from network", object: null },
      { code: "X", level: "info", text: "ข้อมูล", object: "amateur" },
    ]);
    expect(notices.map((n) => [n.level, n.text])).toEqual([
      ["warning", "ดึง TLE ไม่ได้ ให้กด Edit → Update TLE data from network"],
      ["info", "ข้อมูล"],
    ]);
    expect(new Set(notices.map((n) => n.id)).size).toBe(2);
    expect(notices.every((n) => n.retryModule === undefined)).toBe(true);
  });
});

describe("tickNotices (GMAT_FAILED on an ok tick)", () => {
  const failed = { code: "GMAT_FAILED", level: "error" as const, text: "GMAT ล้มเหลว", object: null };

  it("shows a GMAT_FAILED message of an ok tick, with Retry for that module", () => {
    const notices = tickNotices("Amateur", { ...baseTick, messages: [failed] });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ level: "error", text: "GMAT ล้มเหลว", retryModule: "Amateur" });
  });

  it("ignores other messages (TLE_OLD etc. belong to the views) and ticks that are not ok (the overlay handles those)", () => {
    const old = { code: "TLE_OLD", level: "warning" as const, text: "TLE เก่า", object: "25544" };
    expect(tickNotices("Amateur", { ...baseTick, messages: [old] })).toEqual([]);
    expect(tickNotices("Amateur", { ...baseTick, status: "failed", messages: [failed] })).toEqual([]);
    expect(tickNotices("Amateur", { ...baseTick, status: "computing", messages: [failed] })).toEqual([]);
    expect(tickNotices("Amateur", null)).toEqual([]);
  });

  it("gives the same message the same id on every tick, and another module another id", () => {
    const a = tickNotices("A", { ...baseTick, messages: [failed] });
    const a2 = tickNotices("A", { ...baseTick, t: "2026-11-12T07:00:00.300Z", messages: [failed] });
    const b = tickNotices("B", { ...baseTick, messages: [failed] });
    expect(a[0]!.id).toBe(a2[0]!.id);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
});

describe("dismissing", () => {
  const n = (id: string) => ({ id, level: "info" as const, text: id });

  it("visibleNotices drops the dismissed ones", () => {
    expect(visibleNotices([n("a"), n("b")], new Set(["a"])).map((x) => x.id)).toEqual(["b"]);
  });

  it("pruneDismissed forgets notices that are gone, so they show again if they come back", () => {
    const dismissed = new Set(["a", "gone"]);
    expect([...pruneDismissed(dismissed, [n("a"), n("b")])]).toEqual(["a"]);
  });

  it("pruneDismissed returns the same Set when nothing changed (no needless re-render)", () => {
    const dismissed = new Set(["a"]);
    expect(pruneDismissed(dismissed, [n("a")])).toBe(dismissed);
  });
});
