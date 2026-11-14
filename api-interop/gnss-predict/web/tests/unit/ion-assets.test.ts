// asset ตั้งต้นของ Cesium ion (spec ภาพละเอียด §4.1, src/cesium/ionAssets.ts)
// - ทุก preset มี Asset ID ที่ยืนยันจากต้นฉบับของ Cesium (verifiedFrom) ตรวจกับต้นฉบับ CesiumJS ที่ติดตั้งอยู่ใน node_modules (ไม่ต่อเน็ต)
// - ชื่อบนจอของ asset ที่ไม่ใช่ preset = "Cesium ion <id>"

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ION_PRESETS, ionAssetTitle } from "../../src/cesium/ionAssets";

const require = createRequire(import.meta.url);
const widgets = dirname(require.resolve("@cesium/widgets/package.json"));
const engine = dirname(require.resolve("@cesium/engine/package.json"));
const picker = readFileSync(resolve(widgets, "Source/BaseLayerPicker/createDefaultImageryProviderViewModels.js"), "utf8");
const worldStyle = readFileSync(resolve(engine, "Source/Scene/IonWorldImageryStyle.js"), "utf8");

/** Asset ID ที่ Base Layer Picker ของ Cesium ใช้สำหรับชื่อนั้น (Google: fromAssetId(<id>) ; Bing: IonWorldImageryStyle.<STYLE> ที่แปลงเป็นเลขจากไฟล์ของมัน) */
function pickerAssetId(name: string): number | null {
  const at = picker.indexOf(`name: "${name}"`);
  if (at < 0) return null;
  const block = picker.slice(at, picker.indexOf("new ProviderViewModel", at) === -1 ? undefined : picker.indexOf("new ProviderViewModel", at));
  const direct = /fromAssetId\((\d+)\)/.exec(block);
  if (direct) return Number(direct[1]);
  const style = /IonWorldImageryStyle\.([A-Z_]+)/.exec(block);
  if (!style) return null;
  const value = new RegExp(`${style[1]}: (\\d+),`).exec(worldStyle);
  return value ? Number(value[1]) : null;
}

describe("ION_PRESETS", () => {
  test("every preset is a whole-number asset id > 0 with a title and the page it was verified from; ids and titles are unique", () => {
    expect(ION_PRESETS.length).toBeGreaterThan(0);
    for (const p of ION_PRESETS) {
      expect(Number.isSafeInteger(p.id) && p.id > 0, String(p.id)).toBe(true);
      expect(p.title.trim()).not.toBe("");
      expect(p.verifiedFrom).toMatch(/^https:\/\//);
    }
    expect(new Set(ION_PRESETS.map((p) => p.id)).size).toBe(ION_PRESETS.length);
    expect(new Set(ION_PRESETS.map((p) => p.title)).size).toBe(ION_PRESETS.length);
  });

  test("each preset's id is the one Cesium's own Base Layer Picker uses for that name (CesiumJS source in node_modules)", () => {
    for (const p of ION_PRESETS) expect(pickerAssetId(p.title), p.title).toBe(p.id);
  });

  test("covers satellite, satellite with labels and road map from Google Maps 2D, with Bing Maps after them", () => {
    expect(ION_PRESETS.map((p) => [p.id, p.title])).toEqual([
      [3830182, "Google Maps Satellite"],
      [3830183, "Google Maps Satellite with Labels"],
      [3830184, "Google Maps Roadmap"],
      [2, "Bing Maps Aerial"],
      [3, "Bing Maps Aerial with Labels"],
      [4, "Bing Maps Roads"],
    ]);
  });
});

describe("ionAssetTitle", () => {
  test("a preset is named by its title; any other asset by its id", () => {
    expect(ionAssetTitle(3830182)).toBe("Google Maps Satellite");
    expect(ionAssetTitle(2)).toBe("Bing Maps Aerial");
    expect(ionAssetTitle(123456)).toBe("Cesium ion 123456");
  });
});
