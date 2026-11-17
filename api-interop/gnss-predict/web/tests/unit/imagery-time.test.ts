// เวลาของชั้นภาพ GIBS (spec imagery §3.3): token ของ URL ชิ้นภาพ คิดเป็น UTC เสมอ ไม่ขึ้นกับเขตเวลาของเครื่อง
// static = "default", daily = วันที่ UTC, 10min = ปัดลงทุก 10 นาที UTC

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { timeToken, tokenLabel } from "../../src/cesium/imageryTime";

const at = (iso: string) => new Date(iso);

describe("timeToken", () => {
  const savedTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  test("the machine really is in New York for these tests (local date differs from UTC around midnight UTC)", () => {
    expect(at("2026-11-12T00:00:00Z").getDate()).toBe(11);
  });

  test("daily uses the UTC date, not the local one", () => {
    expect(timeToken("daily", at("2026-11-11T23:59:59Z"))).toBe("2026-11-11");
    expect(timeToken("daily", at("2026-11-12T00:00:00Z"))).toBe("2026-11-12");
  });

  test("10min floors to the 10 minutes in UTC", () => {
    expect(timeToken("10min", at("2026-11-11T03:19:59Z"))).toBe("2026-11-11T03:10:00Z");
    expect(timeToken("10min", at("2026-11-11T03:20:00Z"))).toBe("2026-11-11T03:20:00Z");
    expect(timeToken("10min", at("2026-11-11T23:59:59.999Z"))).toBe("2026-11-11T23:50:00Z");
    expect(timeToken("10min", at("2026-01-02T00:00:00Z"))).toBe("2026-01-02T00:00:00Z");
  });

  test("static is always default", () => {
    expect(timeToken("static", at("2026-11-11T03:19:59Z"))).toBe("default");
    expect(timeToken("static", at("1999-01-01T00:00:00Z"))).toBe("default");
  });
});

describe("tokenLabel", () => {
  test("static has no label, daily shows the date, 10min shows date and time in UTC", () => {
    expect(tokenLabel("static", "default")).toBe("");
    expect(tokenLabel("daily", "2026-11-11")).toBe("2026-11-11");
    expect(tokenLabel("10min", "2026-11-11T03:10:00Z")).toBe("2026-11-11 03:10 UTC");
  });
});
