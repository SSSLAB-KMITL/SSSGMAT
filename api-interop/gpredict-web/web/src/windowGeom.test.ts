import { describe, expect, it } from "vitest";
import { centerIn, clampToViewport } from "./windowGeom";

const viewport = { width: 1280, height: 800 };
const size = { width: 400, height: 300 };

describe("clampToViewport", () => {
  it("leaves a position inside the viewport alone", () => {
    expect(clampToViewport({ x: 100, y: 50 }, size, viewport)).toEqual({ x: 100, y: 50 });
    expect(clampToViewport({ x: 880, y: 500 }, size, viewport)).toEqual({ x: 880, y: 500 }); // flush with the far edges
  });

  it("keeps the whole window inside on every side", () => {
    expect(clampToViewport({ x: -30, y: -5 }, size, viewport)).toEqual({ x: 0, y: 0 });
    expect(clampToViewport({ x: 1000, y: 700 }, size, viewport)).toEqual({ x: 880, y: 500 });
  });

  it("puts a window bigger than the viewport at the top left, where its title bar and close button are", () => {
    expect(clampToViewport({ x: 300, y: 300 }, { width: 2000, height: 1000 }, viewport)).toEqual({ x: 0, y: 0 });
  });
});

describe("centerIn", () => {
  it("centres across and a third of the way down", () => {
    expect(centerIn(size, viewport)).toEqual({ x: 440, y: 167 });
  });

  it("never starts outside the viewport", () => {
    expect(centerIn({ width: 2000, height: 1000 }, viewport)).toEqual({ x: 0, y: 0 });
  });
});
