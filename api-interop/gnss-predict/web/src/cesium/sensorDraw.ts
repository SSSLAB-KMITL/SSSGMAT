// สิ่งที่หน้าต่าง 3D และ 2D (และ Sensor View) ใช้วาด sensor (spec §3, §5.3) ฟังก์ชันล้วน ไม่ import Cesium (ส่วนที่อ่านตำแหน่งจาก entity อยู่ใน graphics.ts)
//
// - sensorDrawState: ตำแหน่ง Earth-fixed (เมตร) ของดาวแม่ ณ t และ t ± 1 s → กรอบตัวดาว, boresight ตามหน้า Basic - Pointing และรอยบนพื้นโลก (72 เส้นรอบกรวย)
//   ความเร็ว (P9): มีทั้งสองข้าง = (p(t + 1) − p(t − 1)) / 2 s, ขอบช่วงที่ข้างหนึ่งไม่มีค่า = ผลต่างข้างเดียว 1 s
//   ไม่มีตำแหน่ง, ดาวอยู่บนหรือใต้พื้น (เหมือน swathShape: sensorFootprint ไม่กันกรณีนี้) หรือหากรอบตัวดาวไม่ได้ = null (ไม่วาด)
//   boresight ที่ชี้ลงศูนย์กลางโลก (isNadir: คลาดไม่เกิน 0.01°) มีมุมศูนย์กลางของรอย (nadirCentralAngleRad) ให้หน้าต่าง 2D เติมพื้นที่แบบ Swath (P2)
// - drawableSensors: sensor ที่วาดในหน้าต่างชนิดหนึ่ง = Show ของหน้านั้น (graphics2d / graphics3d ไม่มี = true) และดาวแม่แสดงอยู่ในหน้าต่างนั้น (ผู้เรียกบอก)
// - หน้าต่าง 3D (sensor3dParts): วงรอย, Show Radial Lines = 8 เส้นขอบกรวยจากดาวไปที่จุด 0, 9, 18, … ของวง 72 จุด (P6: เส้นที่ไม่โดนโลกจบที่
//   จุดสัมผัสขอบฟ้าของวง), Show Boresight Marker = จุดที่ boresight ตัดผิวโลก
//   boresight ไม่โดนโลกเลย (spec §3.3): ไม่วาดรอยและ marker วาดกรวยอย่างเดียว = Radial Lines ตามทิศของเส้นขอบกรวยจริง (coneRays เส้นเดียวกับจุด 0, 9, …)
//   ยาวเท่าระยะถึงขอบฟ้า √(|p|² − Re²) (จุดสัมผัสขอบฟ้าของวงอยู่คนละทิศกับกรวย ลากไปที่นั่นจะดูเหมือนกรวยชี้ลงโลก)
// - Sensor View (sensorViewPose, spec §5.4): กล้องที่ตำแหน่งดาว ทิศ boresight ด้านบน North / Velocity (cameraOrientation) fov จากกรวยและสัดส่วนภาพ
// - สี: หน้าต่าง 3D ใช้ graphics3d.color หน้าต่าง 2D ใช้ graphics2d.color ไม่มี = SENSOR_COLOR, ความทึบของ Fill = 1 − % Translucency / 100 (ไม่มี = 50%)
//   ช่องที่ไม่มีใช้ค่าตั้งต้นของ server: Cone Half Angle 45°, Azimuth 0°, Elevation 90°

import type { components } from "../api/types.gen";
import { SENSOR_COLOR } from "./colors";
import {
  bodyFrame, boresightOf, cameraOrientation, coneRays, isNadir, nadirCentralAngleRad, sensorFootprint, sensorViewFovDeg, type BodyFrame,
  type SensorFootprint, type Vec3,
} from "./sensorGeometry";
import { EARTH_RADIUS_KM, subSatellite, WGS84_E2 } from "./swath";

type ScenarioDoc = components["schemas"]["ScenarioDoc"];
export type SensorObj = components["schemas"]["SensorObj"];

/** ความเร็วของดาวหาจากตำแหน่งที่ t ± ค่านี้ (วินาที, P9) */
export const VELOCITY_STEP_S = 1;
const DEFAULT_CONE_HALF_ANGLE_DEG = 45;
const DEFAULT_AZIMUTH_DEG = 0;
const DEFAULT_ELEVATION_DEG = 90;
const DEFAULT_FILL_TRANSLUCENCY = 50;
/** จำนวน Radial Lines (P6) */
const RADIAL_LINES = 8;
/** รัศมีตามแนวศูนย์สูตรของทรงรี WGS 84 (เมตร) ทรงรีเดียวกับ globe ของ Cesium */
const WGS84_A = 6_378_137;
const RAD = Math.PI / 180;

export interface SensorDrawState {
  sensor: SensorObj;
  /** ตำแหน่งของดาวแม่ ณ t (Earth-fixed, เมตร) */
  pos: Vec3;
  frame: BodyFrame;
  /** ทิศหนึ่งหน่วยของ boresight ในกรอบ Earth-fixed */
  boresight: Vec3;
  footprint: SensorFootprint;
  /** boresight ชี้ลงศูนย์กลางโลก */
  nadir: boolean;
  /** มุมศูนย์กลาง (เรเดียน) จากจุดใต้ดาวถึงขอบรอย เฉพาะ boresight ที่ชี้ลงศูนย์กลางโลก ไม่งั้น null */
  centralAngleRad: number | null;
}

/** Cone Half Angle (องศา) ของ sensor */
export const coneHalfAngleOf = (sensor: SensorObj): number => sensor.definition?.cone_half_angle ?? DEFAULT_CONE_HALF_ANGLE_DEG;

const rate = (a: Vec3, b: Vec3, seconds: number): Vec3 => ({ x: (a.x - b.x) / seconds, y: (a.y - b.y) / seconds, z: (a.z - b.z) / seconds });

/** ความเร็ว Earth-fixed (m/s) จากตำแหน่ง t − 1 s, t, t + 1 s (P9) ไม่มีทั้งสองข้าง = null */
function velocityOf(p: Vec3, prev: Vec3 | null, next: Vec3 | null): Vec3 | null {
  if (prev !== null && next !== null) return rate(next, prev, 2 * VELOCITY_STEP_S);
  if (next !== null) return rate(next, p, VELOCITY_STEP_S);
  if (prev !== null) return rate(p, prev, VELOCITY_STEP_S);
  return null;
}

/**
 * สถานะสำหรับวาดของ sensor จากตำแหน่งดาวแม่ ณ t (p) และ t ∓ 1 s (pPrev, pNext; ไม่มีค่า = null)
 * ไม่มี p, ดาวไม่อยู่เหนือพื้น หรือหากรอบตัวดาวไม่ได้ (ไม่มีตำแหน่งข้างเคียงเลย หรือความเร็วเฉื่อยขนานกับทิศลงโลก) = null
 */
export function sensorDrawState(sensor: SensorObj, p: Vec3 | null, pPrev: Vec3 | null, pNext: Vec3 | null): SensorDrawState | null {
  if (p === null) return null;
  const sub = subSatellite(p);
  if (!(sub.altKm > 0)) return null;
  const v = velocityOf(p, pPrev, pNext);
  const frame = v === null ? null : bodyFrame(p, v);
  if (frame === null) return null;
  const halfAngle = coneHalfAngleOf(sensor);
  const boresight = boresightOf(frame, sensor.pointing?.azimuth ?? DEFAULT_AZIMUTH_DEG, sensor.pointing?.elevation ?? DEFAULT_ELEVATION_DEG);
  const nadir = isNadir(p, boresight);
  return {
    sensor,
    pos: p,
    frame,
    boresight,
    footprint: sensorFootprint(p, boresight, halfAngle),
    nadir,
    centralAngleRad: nadir ? nadirCentralAngleRad(sub.altKm, halfAngle) : null,
  };
}

/**
 * sensor ใน doc ที่วาดในหน้าต่างชนิด view (ตามลำดับใน doc): Show ของหน้านั้นเปิดอยู่ (ไม่มี = true)
 * และ parentShown(path ของดาวแม่) บอกว่าดาวแม่แสดงอยู่ในหน้าต่างนั้น (spec §5.3: ซ่อนเมื่อ show เป็น false หรือดาวแม่ถูกซ่อน)
 */
export function drawableSensors(doc: ScenarioDoc, view: "2d" | "3d", parentShown: (parentPath: string) => boolean): SensorObj[] {
  const out: SensorObj[] = [];
  for (const obj of doc.objects) {
    if (obj.class !== "Sensor") continue;
    const sensor = obj as SensorObj;
    const show = (view === "3d" ? sensor.graphics3d?.show : sensor.graphics2d?.show) ?? true;
    if (show && parentShown(sensor.parent)) out.push(sensor);
  }
  return out;
}

/** สีของ sensor ในหน้าต่างชนิด view (#rrggbb) */
export const sensorColor = (sensor: SensorObj, view: "2d" | "3d"): string =>
  (view === "3d" ? sensor.graphics3d?.color : sensor.graphics2d?.color) ?? SENSOR_COLOR;

/** ความทึบของ Fill ในหน้าต่าง 2D (0–1): 1 − % Translucency / 100 (100% = มองไม่เห็น ตาม STK) */
export function sensorFillAlpha(sensor: SensorObj): number {
  const translucency = sensor.graphics2d?.fill_translucency ?? DEFAULT_FILL_TRANSLUCENCY;
  return 1 - Math.min(100, Math.max(0, translucency)) / 100;
}

/** ปลายของ Radial Lines บนวงรอย [lon, lat] (P6: จุด 0, 9, 18, … ของวง 72 จุด) */
export function radialLinePoints(footprint: SensorFootprint): [number, number][] {
  const n = footprint.horizon.length;
  return Array.from({ length: RADIAL_LINES }, (_, i) => footprint.ring[Math.round((i * n) / RADIAL_LINES)]);
}

/** จุดบนผิวทรงรี WGS 84 ที่ [lon, lat] geodetic (องศา) เป็นตำแหน่ง Earth-fixed (เมตร): จุดเดียวกับ Cartesian3.fromDegrees(lon, lat, 0) ที่วงรอยใช้ */
export function groundPointEcef([lon, lat]: [number, number]): Vec3 {
  const φ = lat * RAD;
  const λ = lon * RAD;
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(φ) ** 2);
  return { x: n * Math.cos(φ) * Math.cos(λ), y: n * Math.cos(φ) * Math.sin(λ), z: n * (1 - WGS84_E2) * Math.sin(φ) };
}

/**
 * ปลายของ Radial Lines 8 เส้น (Earth-fixed, เมตร; เส้นเริ่มที่ตำแหน่งดาว): boresight โดนโลก = จุด 0, 9, 18, … ของวงรอยบนผิวทรงรี (P6)
 * ไม่โดนโลก (ไม่มีรอย) = ตามทิศของเส้นขอบกรวยเส้นเดียวกัน ยาวเท่าระยะถึงขอบฟ้า
 */
export function radialLineEnds(st: SensorDrawState): Vec3[] {
  if (st.footprint.boresightHit !== null) return radialLinePoints(st.footprint).map(groundPointEcef);
  const p = st.pos;
  const re = EARTH_RADIUS_KM * 1000;
  const length = Math.sqrt(Math.max(0, p.x * p.x + p.y * p.y + p.z * p.z - re * re));
  return coneRays(st.boresight, coneHalfAngleOf(st.sensor), RADIAL_LINES).map((d) => ({ x: p.x + d.x * length, y: p.y + d.y * length, z: p.z + d.z * length }));
}

/** สิ่งที่หน้าต่าง 3D วาดของ sensor หนึ่งตัว (วงและ marker เป็น [lon, lat] geodetic องศาบนพื้นโลก) */
export interface Sensor3DParts {
  /** วงรอยปิดวง (boresight ไม่โดนโลก = null) */
  ring: [number, number][] | null;
  /** ปลายของ Radial Lines (radialLineEnds) Show Radial Lines ปิด = ว่าง */
  radials: Vec3[];
  /** จุดที่ boresight ตัดผิวโลก Show Boresight Marker ปิด (ค่าตั้งต้น) หรือไม่โดนโลก = null */
  marker: [number, number] | null;
  /** graphics3d.color */
  color: string;
}

/** 3D Graphics - Attributes ของ sensor → สิ่งที่วาด (Show ของหน้า 3D และดาวแม่ ผู้เรียกกรองแล้วด้วย drawableSensors) */
export function sensor3dParts(st: SensorDrawState): Sensor3DParts {
  const g3 = st.sensor.graphics3d;
  const hit = st.footprint.boresightHit;
  return {
    ring: hit === null ? null : st.footprint.ring,
    radials: (g3?.show_radial_lines ?? true) ? radialLineEnds(st) : [],
    marker: (g3?.show_boresight_marker ?? false) ? hit : null,
    color: sensorColor(st.sensor, "3d"),
  };
}

/** กล้องของ Sensor View: ตำแหน่ง Earth-fixed (เมตร) ทิศหนึ่งหน่วย และ fov (องศา) ของ PerspectiveFrustum.fov (ด้านยาวของภาพ) */
export interface SensorViewPose {
  position: Vec3;
  direction: Vec3;
  up: Vec3;
  /** ภาพไม่มีขนาด (aspect เป็น 0, ∞, NaN หรือติดลบ เช่นแท็บที่ยุบ) = null: ผู้เรียกคง fov เดิมไว้ ไม่ตั้ง fov 180° หรือ NaN */
  fovDeg: number | null;
}

/**
 * กล้องของ Sensor View (spec §5.4) จากสถานะของ sensor: ตำแหน่ง = ตำแหน่งดาว, ทิศ = boresight, ด้านบน = up (cameraOrientation)
 * fov ด้านสั้น = min(2α × 1.05, 120°) แปลงเป็นด้านยาวตาม aspect = กว้าง / สูง (sensorViewFovDeg)
 */
export function sensorViewPose(st: SensorDrawState, up: "north" | "velocity", aspect: number): SensorViewPose {
  const o = cameraOrientation(st.pos, st.boresight, st.frame, up);
  const sized = Number.isFinite(aspect) && aspect > 0;
  return { position: st.pos, direction: o.direction, up: o.up, fovDeg: sized ? sensorViewFovDeg(coneHalfAngleOf(st.sensor), aspect) : null };
}
