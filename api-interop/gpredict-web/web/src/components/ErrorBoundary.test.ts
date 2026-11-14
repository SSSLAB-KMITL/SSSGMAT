import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { ErrorBoundary, pageFailedText } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("turns an error into a state that shows a message", () => {
    const error = new Error("boom");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ failed: true, error });
  });

  it("says in Thai that the page failed, with the text of the error, and that the other pages still work", () => {
    expect(pageFailedText(new Error("boom"))).toBe("หน้านี้ทำงานผิดพลาด จึงแสดงไม่ได้ (boom) หน้าอื่นของ Preferences ยังใช้ได้");
    expect(pageFailedText(new ApiError("X", "ข้อความไทย", 500))).toContain("(ข้อความไทย)");
    expect(pageFailedText("plain")).toContain("(plain)");
  });
});
