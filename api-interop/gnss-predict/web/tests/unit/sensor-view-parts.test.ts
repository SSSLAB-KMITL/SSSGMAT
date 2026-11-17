// ชิ้นของ sensor ที่หน้าต่าง 3D วาด (scene3d.ts sensorPartsOf) โดยไม่มี WebGL
// - หน้าต่าง 3D หลัก: ทุก sensor วาดวงรอย Radial Lines และ Boresight Marker ตามหน้า 3D Graphics
// - Sensor View ของ sensor หนึ่ง: sensor ตัวนั้นไม่วาดอะไรเลย (วงขอบกรวยที่เห็นคือวงบน HUD ซึ่งเป็นภาพที่แน่นอนของขอบกรวย ส่วนกราฟิกของ sensor วาดใหม่ช้ากว่ากล้อง
//   วงกับจุดจึงแกว่งรอบวง HUD ตอน animation) ส่วน sensor ตัวอื่นยังวาดครบ

import { describe, expect, test } from "vitest";
import { sensorDrawState, viewHalfAngleOf, type SensorObj } from "../../src/cesium/sensorDraw";
import { sensorViewShortFovDeg, type Vec3 } from "../../src/cesium/sensorGeometry";
import { sceneStyleFrom } from "../../src/cesium/graphics";
import { EARTH_RADIUS_KM } from "../../src/cesium/swath";
import { sensorPartsOf } from "../../src/windows/Graphics3D/scene3d";
import { sensorObj } from "./helpers/objects";

const R = (EARTH_RADIUS_KM + 20180) * 1000;
const P: Vec3 = { x: R, y: 0, z: 0 };
const PREV: Vec3 = { x: R, y: -2000, z: 0 };
const NEXT: Vec3 = { x: R, y: 0, z: 2000 };
const STYLE = sceneStyleFrom(() => "");

/** sensor ชี้ลงศูนย์กลางโลก (boresight ตกบนโลก) เปิดทั้ง Radial Lines และ Boresight Marker */
const sensor = (name: string): SensorObj =>
  ({
    ...sensorObj(name, "G01"),
    definition: { type: "Simple Conic", cone_half_angle: 10 },
    graphics3d: { show: true, color: "#00ff00", show_radial_lines: true, show_boresight_marker: true },
  }) as SensorObj;
const state = (name: string) => sensorDrawState(sensor(name), P, PREV, NEXT)!;

const idsOf = (parts: ReadonlyMap<string, unknown>, name: string): string[] => [...parts.keys()].filter((id) => id.startsWith(`sensor/${name}/`)).sort();
const ALL = (name: string) => [`sensor/${name}/marker`, `sensor/${name}/radial/0`, `sensor/${name}/radial/1`, `sensor/${name}/radial/2`, `sensor/${name}/radial/3`,
  `sensor/${name}/radial/4`, `sensor/${name}/radial/5`, `sensor/${name}/radial/6`, `sensor/${name}/radial/7`, `sensor/${name}/ring`];

describe("sensorPartsOf", () => {
  const states = [state("S1"), state("S2")];

  test("a normal 3D window draws the ring, the 8 radial lines and the boresight marker of every sensor", () => {
    const parts = sensorPartsOf(states, null, STYLE);
    expect(idsOf(parts, "S1")).toEqual(ALL("S1"));
    expect(idsOf(parts, "S2")).toEqual(ALL("S2"));
  });

  test("in the own Sensor View of S1, S1 draws no ring, no radial lines and no boresight marker; S2 is still drawn in full", () => {
    const parts = sensorPartsOf(states, "*/Sensor/S1", STYLE);
    expect(idsOf(parts, "S1")).toEqual([]);
    expect(idsOf(parts, "S2")).toEqual(ALL("S2"));
  });

  test("the Sensor View of S2 hides S2 and keeps S1", () => {
    const parts = sensorPartsOf(states, "*/Sensor/S2", STYLE);
    expect(idsOf(parts, "S2")).toEqual([]);
    expect(idsOf(parts, "S1")).toEqual(ALL("S1"));
  });

  test("the sensor of a Sensor View that is not in the list changes nothing", () => {
    expect(idsOf(sensorPartsOf(states, "*/Sensor/Other", STYLE), "S1")).toEqual(ALL("S1"));
  });
});

// ข2 Ruling e, k: Rectangular วาดวงรอย 4 ด้านกับ Radial Lines 4 เส้นไปที่มุม และ Sensor View ใช้ max(V, H) เป็นครึ่งมุมของภาพ
describe("Rectangular sensors in the 3D window and the Sensor View", () => {
  const rect = (name: string, v: number, h: number): SensorObj =>
    ({ ...sensor(name), definition: { type: "Rectangular", vertical_half_angle: v, horizontal_half_angle: h } }) as SensorObj;

  test("a Rectangular sensor draws its ring, 4 radial lines to the corners and the marker", () => {
    const parts = sensorPartsOf([sensorDrawState(rect("R", 10, 5), P, PREV, NEXT)!], null, STYLE);
    expect(idsOf(parts, "R")).toEqual(["sensor/R/marker", "sensor/R/radial/0", "sensor/R/radial/1", "sensor/R/radial/2", "sensor/R/radial/3", "sensor/R/ring"]);
  });

  test("short-side fov: MODIS 115.5°, VIIRS 118.188°, AHI 8.7° gives 18.27°", () => {
    expect(sensorViewShortFovDeg(viewHalfAngleOf(rect("MODIS", 55.0, 0.41)))).toBeCloseTo(115.5, 9);
    expect(sensorViewShortFovDeg(viewHalfAngleOf(rect("VIIRS", 56.28, 0.42)))).toBeCloseTo(118.188, 9);
    const ahi = { ...sensor("AHI"), definition: { type: "Simple Conic", cone_half_angle: 8.7 } } as SensorObj;
    expect(sensorViewShortFovDeg(viewHalfAngleOf(ahi))).toBeCloseTo(18.27, 9);
  });
});
