import { describe, expect, it } from "vitest";
import { laterTooltip } from "./later";

describe("laterTooltip", () => {
  it("names the sub-project that has the feature", () => {
    expect(laterTooltip(2)).toBe("อยู่ในงานย่อยที่ 2: Pass predictions");
    expect(laterTooltip(3)).toBe("อยู่ในงานย่อยที่ 3: Radio & Rotator");
    expect(laterTooltip(4)).toBe("อยู่ในงานย่อยที่ 4: Data & Preferences");
  });
});
