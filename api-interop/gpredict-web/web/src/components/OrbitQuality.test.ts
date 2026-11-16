import { describe, it, expect } from "vitest";
import { qualityNumber, qualityTime, referenceLabel } from "./OrbitQuality";
describe("orbit reference presentation", () => {
  it("does not turn a missing reference into verified or zero error", () => {
    expect(referenceLabel(undefined)).toBe("ยังไม่มีอ้างอิง");
    expect(qualityNumber(null)).toBe("—");
  });
  it("states UTC so comparison times are not mistaken for local time", () => {
    expect(qualityTime("2026-11-17T01:02:03.000Z")).toBe("2026-11-17 01:02:03 UTC");
  });
});
