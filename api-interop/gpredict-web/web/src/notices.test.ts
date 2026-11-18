import { describe, expect, it } from "vitest";
import { pruneDismissed, rememberNames, startupNotices, TLE_OLD_DAYS, tickNotices, visibleNotices } from "./notices";
import type { ApiMessage, SatState, Tick } from "./types";

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

  it("leaves GMAT_FAILED of ticks that are not ok to the overlay, and shows nothing without a tick or other messages", () => {
    expect(tickNotices("Amateur", { ...baseTick, status: "failed", messages: [failed] })).toEqual([]);
    expect(tickNotices("Amateur", { ...baseTick, status: "computing", messages: [failed] })).toEqual([]);
    expect(tickNotices("Amateur", null)).toEqual([]);
    const computing = { code: "EPHEM_COMPUTING", level: "info" as const, text: "กำลังคำนวณ", object: null };
    expect(tickNotices("Amateur", { ...baseTick, messages: [computing] })).toEqual([]);
  });

  it("gives the same message the same id on every tick, and another module another id", () => {
    const a = tickNotices("A", { ...baseTick, messages: [failed] });
    const a2 = tickNotices("A", { ...baseTick, t: "2026-11-12T07:00:00.300Z", messages: [failed] });
    const b = tickNotices("B", { ...baseTick, messages: [failed] });
    expect(a[0]!.id).toBe(a2[0]!.id);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
});

const msg = (code: string, norad: number | string, text = `${code} ${norad}`, level: ApiMessage["level"] = "warning"): ApiMessage => ({
  code,
  level,
  text,
  object: String(norad),
});
const oldTle = (norad: number, days = 8.2): ApiMessage =>
  msg("TLE_OLD", norad, `TLE ของ SAT (NORAD ${norad}) อายุ ${days} วัน เกิน 7 วัน`);
const names = new Map([
  [25544, "ISS (ZARYA)"],
  [43013, "NOAA 20"],
  [7530, "OSCAR 7"],
]);
const NAMES_OF_12 = Array.from({ length: 12 }, (_, i) => 40000 + i);

describe("tickNotices (the warnings the server sends once per satellite)", () => {
  it("counts and names the satellites of TLE_OLD in one notice", () => {
    const notices = tickNotices("Amateur", { ...baseTick, messages: [oldTle(43013), oldTle(25544)] }, names);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ level: "warning" });
    expect(notices[0]!.retryModule).toBeUndefined();
    expect(notices[0]!.text).toBe(
      `TLE ของ 2 ดวงเก่ากว่า ${TLE_OLD_DAYS} วัน: ISS (ZARYA), NOAA 20 (ควรอัปเดตที่ Edit → Update TLE data from network)`,
    );
    expect(TLE_OLD_DAYS).toBe(7);
  });

  it("counts and names SAT_MISSING_FROM_GMAT and SAT_STATE_INVALID, one notice per code", () => {
    const notices = tickNotices(
      "Amateur",
      { ...baseTick, messages: [msg("SAT_MISSING_FROM_GMAT", 43013), msg("SAT_STATE_INVALID", 25544), msg("SAT_STATE_INVALID", 7530)] },
      names,
    );
    expect(notices.map((n) => n.text)).toEqual([
      "2 ดวงมีค่าวงโคจรที่ใช้ไม่ได้: OSCAR 7, ISS (ZARYA)",
      "GMAT ไม่คืนค่าของ 1 ดวง: NOAA 20",
    ]);
    expect(new Set(notices.map((n) => n.id)).size).toBe(2);
  });

  it("falls back to the NORAD number for a satellite whose name is not known", () => {
    const [n] = tickNotices("Amateur", { ...baseTick, messages: [msg("SAT_MISSING_FROM_GMAT", 99999), msg("SAT_MISSING_FROM_GMAT", 25544)] }, names);
    expect(n!.text).toBe("GMAT ไม่คืนค่าของ 2 ดวง: ISS (ZARYA), NORAD 99999");
    const [m] = tickNotices("Amateur", { ...baseTick, messages: [msg("TLE_OLD", 99999)] });
    expect(m!.text).toContain("1 ดวง");
    expect(m!.text).toContain("NORAD 99999");
  });

  it("shortens a long list and keeps the whole one as the tooltip", () => {
    const [n] = tickNotices("Amateur", { ...baseTick, messages: NAMES_OF_12.map((x) => oldTle(x)) });
    expect(n!.text).toContain("TLE ของ 12 ดวงเก่ากว่า 7 วัน: NORAD 40000, NORAD 40001, NORAD 40002, NORAD 40003, NORAD 40004 และอีก 7 ดวง");
    expect(n!.detail).toContain("NORAD 40011 (NORAD 40011)");
    expect(n!.detail).not.toContain("และอีก");
    const [short] = tickNotices("Amateur", { ...baseTick, messages: [oldTle(40000)] });
    expect(short!.detail).toBeUndefined();
  });

  it("shows them in any status of the tick (the strip is above the overlay), GMAT_FAILED first", () => {
    for (const status of ["ok", "computing", "failed"] as const) {
      const notices = tickNotices("A", { ...baseTick, status, messages: [oldTle(25544), msg("SAT_MISSING_FROM_GMAT", 43013)] }, names);
      expect(notices.map((n) => n.text.slice(0, 4)), status).toEqual(["GMAT", "TLE "]);
    }
    const failed = { code: "GMAT_FAILED", level: "error" as const, text: "GMAT ล้มเหลว", object: null };
    const notices = tickNotices("A", { ...baseTick, messages: [oldTle(25544), failed] }, names);
    expect(notices.map((n) => n.level)).toEqual(["error", "warning"]);
    expect(notices[0]!.retryModule).toBe("A");
  });

  it("keys the id on the module, the code and the sorted set of satellites, not on the text", () => {
    const id = (messages: ApiMessage[], module = "A") => tickNotices(module, { ...baseTick, messages }, names)[0]!.id;
    const base = id([oldTle(25544, 8.2), oldTle(43013, 9.1)]);
    expect(id([oldTle(43013, 12.7), oldTle(25544, 9.9)])).toBe(base); // other day counts, other order
    expect(id([oldTle(25544), oldTle(25544), oldTle(43013)])).toBe(base); // a repeated object counts once
    expect(id([oldTle(25544), oldTle(43013), oldTle(7530)])).not.toBe(base); // the set grew
    expect(id([oldTle(25544)])).not.toBe(base); // the set shrank
    expect(id([oldTle(25544, 8.2), oldTle(43013, 9.1)], "B")).not.toBe(base); // another module
    expect(id([msg("SAT_MISSING_FROM_GMAT", 25544), msg("SAT_MISSING_FROM_GMAT", 43013)])).not.toBe(base); // another code
  });

  it("sorts the satellites by number, not by text, so 9 comes before 10", () => {
    const [a] = tickNotices("A", { ...baseTick, messages: [oldTle(10), oldTle(9)] });
    const [b] = tickNotices("A", { ...baseTick, messages: [oldTle(9), oldTle(10)] });
    expect(a!.id).toBe(b!.id);
    expect(a!.text).toContain("NORAD 9, NORAD 10");
  });

  it("a dismissed notice stays dismissed while the set is the same and is forgotten when it goes away", () => {
    const tick = (days: number, messages = [oldTle(25544, days), oldTle(43013, days)]) => ({ ...baseTick, messages });
    const first = tickNotices("A", tick(8.2), names);
    let dismissed: ReadonlySet<string> = new Set([first[0]!.id]);
    const later = tickNotices("A", tick(8.4), names); // 0.2 days later: the text changed, the set did not
    dismissed = pruneDismissed(dismissed, later);
    expect(visibleNotices(later, dismissed)).toEqual([]);
    const grown = tickNotices("A", tick(8.5, [oldTle(25544), oldTle(43013), oldTle(7530)]), names);
    expect(visibleNotices(grown, dismissed)).toHaveLength(1); // the set changed: shown again
    expect([...pruneDismissed(dismissed, grown)]).toEqual([]);
  });

  it("takes the highest level of the messages of a code", () => {
    const [n] = tickNotices("A", { ...baseTick, messages: [msg("TLE_OLD", 1, "x", "info"), msg("TLE_OLD", 2, "y", "error")] });
    expect(n!.level).toBe("error");
  });
});

describe("rememberNames", () => {
  const sat = (norad: number, name: string) => ({ norad, name }) as SatState;
  const withSats = (...sats: SatState[]): Tick => ({ ...baseTick, sats });

  it("adds the names a tick shows, and keeps the ones it does not (a satellite that dropped out of the ticks)", () => {
    const known = rememberNames(new Map(), withSats(sat(1, "ONE"), sat(2, "TWO")));
    expect([...known]).toEqual([[1, "ONE"], [2, "TWO"]]);
    const later = rememberNames(known, withSats(sat(2, "TWO"), sat(3, "THREE")));
    expect([...later]).toEqual([[1, "ONE"], [2, "TWO"], [3, "THREE"]]);
    expect([...rememberNames(later, withSats(sat(3, "THREE (RENAMED)")))].find(([k]) => k === 3)).toEqual([3, "THREE (RENAMED)"]);
  });

  it("returns the same map when nothing is new, for a tick without sats and for no tick", () => {
    const known = new Map([[1, "ONE"]]);
    expect(rememberNames(known, withSats(sat(1, "ONE")))).toBe(known);
    expect(rememberNames(known, baseTick)).toBe(known);
    expect(rememberNames(known, null)).toBe(known);
    expect(known.size).toBe(1);
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
