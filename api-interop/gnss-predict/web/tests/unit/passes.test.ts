// ground track ของหน้าต่าง 2D (src/cesium/passes.ts): คาบวงโคจรจากรัศมีเฉลี่ย, lead/trail ทุกแบบของหน้า 2D Graphics - Pass, จุดขึ้นของวงโคจร
// ค่าที่คาดเป็นสูตรปิด (ตัวเลขของบรีฟงาน 12 ตามตัว)

import { describe, expect, test } from "vitest";
import { ascendingNodeTimes, DEFAULT_PASS_S, estimatePeriod, extendNodes, leadTrailS, MU_KM3_S2, orbitPeriodS } from "../../src/cesium/passes";

const T = 43077.757;

test("GPS period from the mean radius", () => expect(orbitPeriodS(26560)).toBeCloseTo(43077.757, 2));

test("lead/trail types", () => {
  const ctx = { t: 10_000, start: 0, stop: 86_400, periodS: T, ascendingNodes: [5_000, 48_077.757] };
  expect(leadTrailS({ lead_type: "Time", lead_time_s: 1800, trail_type: "Same As Lead" }, ctx)).toEqual({ leadS: 1800, trailS: 1800 });
  const q = leadTrailS({ lead_type: "Quarter", trail_type: "Half" }, ctx); expect(q.leadS).toBeCloseTo(T / 4, 6); expect(q.trailS).toBeCloseTo(T / 2, 6);
  const p = leadTrailS({ lead_type: "Percent", lead_percent: 10, trail_type: "Full" }, ctx); expect(p.leadS).toBeCloseTo(4307.7757, 4); expect(p.trailS).toBeCloseTo(T, 6);
  expect(leadTrailS({ lead_type: "All", trail_type: "Current Interval" }, ctx)).toEqual({ leadS: 76_400, trailS: 10_000 });
  expect(leadTrailS({ lead_type: "None", trail_type: "None" }, ctx)).toEqual({ leadS: 0, trailS: 0 });
  const o = leadTrailS({ lead_type: "One Pass", trail_type: "One Pass" }, ctx); expect(o.leadS).toBeCloseTo(38_077.757, 6); expect(o.trailS).toBe(5_000);
});

test("ascending node by linear interpolation", () => expect(ascendingNodeTimes([{ t: 0, z: -1 }, { t: 100, z: 1 }, { t: 200, z: -1 }])).toEqual([50]));

describe("orbit period", () => {
  test("uses the WGS 84 gravitational parameter in km³/s²", () => {
    expect(MU_KM3_S2).toBe(398600.4418);
    expect(orbitPeriodS(42164.17)).toBeCloseTo(86_164.09, 0); // GEO: หนึ่งวันดาราคติ
  });

  test("estimatePeriod takes the mean radius (metres) of position samples", () => {
    const r = 26_560_000;
    const ring = Array.from({ length: 24 }, (_, i) => {
      const a = (2 * Math.PI * i) / 24;
      return { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 };
    });
    expect(estimatePeriod(ring)).toBeCloseTo(orbitPeriodS(26_560), 6);
    // วงรีเล็กน้อย: รัศมีเฉลี่ยของตัวอย่างยังให้คาบใกล้เคียง
    const squashed = ring.map((p) => ({ x: p.x * 1.001, y: p.y * 0.999, z: 0 }));
    expect(Math.abs(estimatePeriod(squashed)! - T)).toBeLessThan(10);
  });

  test("no samples or nonsense radii give no period", () => {
    expect(estimatePeriod([])).toBeNull();
    expect(estimatePeriod([{ x: 0, y: 0, z: 0 }])).toBeNull();
    expect(estimatePeriod([{ x: Number.NaN, y: 0, z: 0 }])).toBeNull();
  });
});

describe("ascendingNodeTimes", () => {
  test("only negative-to-positive crossings count, every one of them", () => {
    const samples = [{ t: 0, z: 3 }, { t: 10, z: -1 }, { t: 20, z: 3 }, { t: 30, z: 1 }, { t: 40, z: -3 }, { t: 50, z: 1 }];
    expect(ascendingNodeTimes(samples)).toEqual([12.5, 47.5]);
  });

  test("a sample exactly on the equator is the node and is not counted twice", () => {
    expect(ascendingNodeTimes([{ t: 0, z: -2 }, { t: 10, z: 0 }, { t: 20, z: 2 }])).toEqual([10]);
    // ขาลงที่แตะศูนย์พอดีไม่ใช่จุดขึ้น
    expect(ascendingNodeTimes([{ t: 0, z: 2 }, { t: 10, z: 0 }, { t: 20, z: -2 }])).toEqual([]);
  });

  test("fewer than two samples have no node", () => {
    expect(ascendingNodeTimes([])).toEqual([]);
    expect(ascendingNodeTimes([{ t: 0, z: -1 }])).toEqual([]);
  });
});

describe("leadTrailS beyond the brief", () => {
  const ctx = { t: 10_000, start: 0, stop: 86_400, periodS: T, ascendingNodes: [5_000, 48_077.757] };

  test("trail Time and Percent use the trail fields", () => {
    expect(leadTrailS({ lead_type: "None", trail_type: "Time", trail_time_s: 600 }, ctx)).toEqual({ leadS: 0, trailS: 600 });
    expect(leadTrailS({ lead_type: "None", trail_type: "Percent", trail_percent: 50 }, ctx).trailS).toBeCloseTo(T / 2, 6);
  });

  test("Same As Lead copies a time-dependent lead too", () => {
    const o = leadTrailS({ lead_type: "One Pass", trail_type: "Same As Lead" }, ctx);
    expect(o.trailS).toBe(o.leadS);
    expect(leadTrailS({ lead_type: "All", trail_type: "Same As Lead" }, ctx)).toEqual({ leadS: 76_400, trailS: 76_400 });
  });

  test("a missing pass or an empty time is the template default of the server (Time, 1800 s), an empty percent is 0", () => {
    expect(DEFAULT_PASS_S).toBe(1800);
    expect(leadTrailS(null, ctx)).toEqual({ leadS: 1800, trailS: 1800 });
    expect(leadTrailS(undefined, ctx)).toEqual({ leadS: 1800, trailS: 1800 });
    expect(leadTrailS({ lead_type: "Time", lead_time_s: null, trail_type: "Time" }, ctx)).toEqual({ leadS: 1800, trailS: 1800 });
    expect(leadTrailS({ lead_type: "Percent", lead_percent: null, trail_type: "None" }, ctx)).toEqual({ leadS: 0, trailS: 0 });
  });

  test("All and Current Interval never go negative outside the analysis period", () => {
    expect(leadTrailS({ lead_type: "All", trail_type: "Current Interval" }, { ...ctx, t: 90_000 })).toEqual({ leadS: 0, trailS: 90_000 });
    expect(leadTrailS({ lead_type: "All", trail_type: "All" }, { ...ctx, t: -50 })).toEqual({ leadS: 86_450, trailS: 0 });
  });

  test("One Pass on a node starts the next pass; past the last node it extrapolates one period", () => {
    const on = leadTrailS({ lead_type: "One Pass", trail_type: "One Pass" }, { ...ctx, t: 5_000 });
    expect(on.trailS).toBe(0);
    expect(on.leadS).toBeCloseTo(43_077.757, 6);
    const after = leadTrailS({ lead_type: "One Pass", trail_type: "One Pass" }, { ...ctx, t: 50_000 });
    expect(after.trailS).toBeCloseTo(50_000 - 48_077.757, 6);
    expect(after.leadS).toBeCloseTo(48_077.757 + T - 50_000, 6);
    const before = leadTrailS({ lead_type: "One Pass", trail_type: "One Pass" }, { ...ctx, t: 1_000 });
    expect(before.leadS).toBe(4_000);
    expect(before.trailS).toBeCloseTo(1_000 - (5_000 - T), 6);
  });

  test("One Pass without any node is centred on now: half a period each side", () => {
    expect(leadTrailS({ lead_type: "One Pass", trail_type: "One Pass" }, { ...ctx, ascendingNodes: [] })).toEqual({ leadS: T / 2, trailS: T / 2 });
  });
});

describe("extendNodes", () => {
  test("adds nodes one period apart until every time in the period has a node at or before it and one after it", () => {
    expect(extendNodes([150, 250], 100, 0, 400)).toEqual([-50, 50, 150, 250, 350, 450]);
    expect(extendNodes([0], 100, 0, 100)).toEqual([0, 100, 200]);
  });

  test("no nodes or no period: nothing to extend", () => {
    expect(extendNodes([], 100, 0, 400)).toEqual([]);
    expect(extendNodes([150], 0, 0, 400)).toEqual([150]);
  });
});
