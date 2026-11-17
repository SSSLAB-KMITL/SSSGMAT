import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TLE_OLD_NAME, TleOldNotice } from "./TleOldNotice";

describe("TleOldNotice (the notice that the TLE data is old)", () => {
  it("has no title, as Gpredict's, but has an accessible name", () => {
    const html = renderToStaticMarkup(createElement(TleOldNotice, { text: "Your TLE files are getting out of date.", onClose: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain(`aria-label="${TLE_OLD_NAME}"`);
    expect(html).not.toContain("aria-labelledby");
    expect(TLE_OLD_NAME).toBe("ข้อมูล TLE เก่า");
  });
});
