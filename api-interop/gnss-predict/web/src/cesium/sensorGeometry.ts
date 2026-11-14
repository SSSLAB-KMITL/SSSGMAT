// เรขาคณิตของ sensor บนดาว (spec §3): กรอบตัวดาว, boresight จาก Az-El, รอยของกรวยบนพื้นโลก และทิศกล้องกับ fov ของหน้าต่าง Sensor View
// ฟังก์ชันล้วน ไม่ใช้ Cesium: เวกเตอร์เป็นเมตรในกรอบ Earth-fixed (ECEF) เหมือนตำแหน่งที่ subSatellite รับ
//
// โลกทรงกลมรัศมี Re = EARTH_RADIUS_KM เหมือน Swath (swath.ts) ดาวสูง h: ครึ่งมุมของจานโลกที่ดาวเห็น ρ = asin(Re / (Re + h))
// กรวยที่ชี้ลงศูนย์กลางโลกครึ่งมุม α < ρ: สามเหลี่ยม ศูนย์กลางโลก–ดาว–จุดบนพื้น ไซน์รูลได้ sin(มุมที่จุดบนพื้น) = k·sin α โดย k = (Re + h) / Re
// จุดแรกที่เส้นตัดโลกมีมุมนั้นป้าน มุมศูนย์กลางจากจุดใต้ดาวจึง θ = asin(k·sin α) − α (α ≥ ρ จบที่ขอบฟ้า θ = acos(Re / (Re + h)) = 90° − ρ)
// จุดบนพื้นแปลงเป็นละติจูด geodetic ด้วย subSatellite (WGS 84: tan φd = tan φc / (1 − e²)) ให้ตรงกับวงของ Swath

import { EARTH_RADIUS_KM, subSatellite } from "./swath";

/** เวกเตอร์ในกรอบ Earth-fixed (เมตร) หรือเวกเตอร์ทิศ */
export type Vec3 = { x: number; y: number; z: number };

/** กรอบตัวดาว: แกนหนึ่งหน่วยสามแกนในกรอบ Earth-fixed */
export interface BodyFrame {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/** ความเร็วเชิงมุมของโลก (rad/s) */
export const EARTH_ROTATION_RAD_S = 7.292115e-5;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** รัศมีโลก (เมตร) */
const RE_M = EARTH_RADIUS_KM * 1000;
/** ฉายแล้วสั้นกว่านี้นับว่าขนานกับแกนที่ฉายลงมา */
const PARALLEL = 1e-6;
const EARTH_X: Vec3 = { x: 1, y: 0, z: 0 };
/** แกนโลกชี้ทิศเหนือ */
const EARTH_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

/** ส่วนของ v ที่ตั้งฉากกับทิศหนึ่งหน่วย b เป็นเวกเตอร์หนึ่งหน่วย ถ้า v ขนานกับ b (ยาว < PARALLEL) = null */
function unitPerp(v: Vec3, b: Vec3): Vec3 | null {
  const p = sub(v, scale(b, dot(v, b)));
  const len = norm(p);
  return len < PARALLEL ? null : scale(p, 1 / len);
}

/** เวกเตอร์หนึ่งหน่วยใดก็ได้ที่ตั้งฉากกับทิศหนึ่งหน่วย v */
function anyPerp(v: Vec3): Vec3 {
  return unit(cross(v, Math.abs(v.z) < 0.9 ? EARTH_AXIS : EARTH_X));
}

/** ครึ่งมุม (องศา) ของจานโลกที่ดาวสูง altKm เหนือโลกทรงกลมเห็น: asin(Re / (Re + h)) ใต้พื้นหรือบนพื้นนับเป็นจานเต็ม 90° */
export function earthDiscHalfAngleDeg(altKm: number): number {
  return Math.asin(Math.min(1, EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altKm))) * DEG;
}

/** มุมศูนย์กลาง (เรเดียน) จากจุดใต้ดาวถึงขอบรอยของกรวยครึ่งมุม halfAngleDeg ที่ชี้ลงศูนย์กลางโลก: asin(k·sin α) − α เมื่อ α < ρ ไม่งั้นขอบฟ้า acos(Re / (Re + h)) */
export function nadirCentralAngleRad(altKm: number, halfAngleDeg: number): number {
  const k = (EARTH_RADIUS_KM + altKm) / EARTH_RADIUS_KM;
  const α = halfAngleDeg * RAD;
  if (halfAngleDeg < earthDiscHalfAngleDeg(altKm)) return Math.asin(Math.min(1, k * Math.sin(α))) - α;
  return Math.acos(1 / k);
}

/** Cone Half Angle ตั้งต้น (องศา): จานโลก + 0.5° ปัดทศนิยม 1 ตำแหน่ง ไม่เกิน 90 ดาวยังไม่มีตำแหน่ง (null) = 45 */
export function defaultConeHalfAngleDeg(pos: Vec3 | null): number {
  if (pos === null) return 45;
  const ρ = earthDiscHalfAngleDeg(norm(pos) / 1000 - EARTH_RADIUS_KM);
  return Math.min(90, Math.round((ρ + 0.5) * 10) / 10);
}

/**
 * กรอบตัวดาวแบบ Nadir alignment with ECI velocity constraint (spec §3.1): +Z = −r̂ (ชี้ศูนย์กลางโลก)
 * +X = ส่วนของความเร็วเฉื่อย v_I = v_ECEF + ω⊕ × r ที่ตั้งฉากกับ Z, +Y = Z × X
 * ไม่มีกรอบ (null) เมื่อ |pos| = 0 หรือ v_I ขนานกับ Z (หรือเป็นศูนย์) จนไม่มีส่วนตั้งฉาก
 */
export function bodyFrame(pos: Vec3, velEcef: Vec3): BodyFrame | null {
  const r = norm(pos);
  if (!(r > 0)) return null;
  const z = scale(pos, -1 / r);
  // ω⊕ = (0, 0, ω) จึง ω × r = (−ω·y, ω·x, 0)
  const vi: Vec3 = { x: velEcef.x - EARTH_ROTATION_RAD_S * pos.y, y: velEcef.y + EARTH_ROTATION_RAD_S * pos.x, z: velEcef.z };
  const perp = sub(vi, scale(z, dot(vi, z)));
  const len = norm(perp);
  if (!(len > 1e-9 * norm(vi))) return null;
  const x = scale(perp, 1 / len);
  return { x, y: cross(z, x), z };
}

/** boresight จาก Az-El ในกรอบตัวดาว (spec §3.2): az วัดจาก +X ไป +Y ในระนาบ XY, el วัดจากระนาบ XY ไป +Z (องศา) */
export function boresightOf(f: BodyFrame, azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * RAD;
  const el = elDeg * RAD;
  return add(add(scale(f.x, Math.cos(el) * Math.cos(az)), scale(f.y, Math.cos(el) * Math.sin(az))), scale(f.z, Math.sin(el)));
}

/** boresight b ชี้ลงศูนย์กลางโลก (มุมระหว่าง b กับ −r̂ ไม่เกิน 0.01°) */
export function isNadir(pos: Vec3, b: Vec3): boolean {
  const down = unit(scale(pos, -1));
  const angle = Math.atan2(norm(cross(b, down)), dot(b, down)) * DEG;
  return angle <= 0.01;
}

export interface SensorFootprint {
  /** ขอบรอยบนพื้นโลก [lon, lat] geodetic (องศา, ลองจิจูดใน [−180, 180)) n + 1 จุด ปิดวง (จุดแรกซ้ำที่ท้าย) */
  ring: [number, number][];
  /** จุด i ของวงเป็นจุดสัมผัสขอบฟ้า (เส้นนั้นไม่โดนโลก) ยาว n */
  horizon: boolean[];
  /** จุดที่ boresight ตัดผิวโลก ไม่โดนโลก = null */
  boresightHit: [number, number] | null;
}

/** จุดแรกที่เส้นจาก p ทิศหนึ่งหน่วย d ตัดทรงกลมรัศมี Re (เมตร) เส้นที่ไม่โดน (หรือชี้ออกจากโลก) = null */
function hitEarth(p: Vec3, d: Vec3): Vec3 | null {
  const pd = dot(p, d);
  const disc = pd * pd - (dot(p, p) - RE_M * RE_M);
  if (disc < 0 || pd >= 0) return null;
  return add(p, scale(d, -pd - Math.sqrt(disc)));
}

/** จุดสัมผัสขอบฟ้าในระนาบของ p กับเส้นทิศ d ฝั่งเดียวกับ d: จากทิศลงศูนย์กลางโลก เอียงไป d เป็นมุม ρ ไกลเท่าความยาวเส้นสัมผัส √(|p|² − Re²) */
function horizonPoint(p: Vec3, d: Vec3): Vec3 {
  const r = norm(p);
  const down = scale(p, -1 / r);
  const toward = unitPerp(d, down) ?? anyPerp(down);
  const ρ = Math.asin(Math.min(1, RE_M / r));
  const tangent = Math.sqrt(Math.max(0, r * r - RE_M * RE_M));
  return add(p, scale(add(scale(down, Math.cos(ρ)), scale(toward, Math.sin(ρ))), tangent));
}

const lonLat = (p: Vec3): [number, number] => {
  const s = subSatellite(p);
  return [s.lon, s.lat];
};

/**
 * ทิศหนึ่งหน่วยของ n (≥ 1) เส้นรอบกรวยครึ่งมุม halfAngleDeg แกน b ห่างกันเท่า ๆ กัน
 * เส้นแรกอยู่ทางทิศ +X (Earth-fixed) ที่ฉายลงระนาบตั้งฉาก b (ขนานกับ b ใช้ทิศเหนือ) แล้ววนตามเข็มนาฬิกาเมื่อมองตาม b
 * (เส้นที่ k·(72/n) ของ 72 เส้นคือเส้นที่ k ของ n เส้น: Radial Lines 8 เส้นตรงกับจุด 0, 9, 18, … ของวงรอย)
 */
export function coneRays(b: Vec3, halfAngleDeg: number, n = 72): Vec3[] {
  const axis = unit(b);
  const α = halfAngleDeg * RAD;
  const e1 = unitPerp(EARTH_X, axis) ?? unitPerp(EARTH_AXIS, axis) ?? anyPerp(axis);
  // หมุนตามกฎมือขวารอบ b = ตามเข็มนาฬิกาเมื่อมองตาม b
  const e2 = cross(axis, e1);
  return Array.from({ length: n }, (_, i) => {
    const φ = (2 * Math.PI * i) / n;
    const side = add(scale(e1, Math.cos(φ)), scale(e2, Math.sin(φ)));
    return unit(add(scale(axis, Math.cos(α)), scale(side, Math.sin(α))));
  });
}

/**
 * รอยบนพื้นโลกของกรวยครึ่งมุม halfAngleDeg แกน b ที่ดาวตำแหน่ง pos (Earth-fixed, เมตร, สูงกว่าพื้น) (spec §3.3)
 * ยิงเส้น n (≥ 1) เส้นรอบกรวย (coneRays) ไปตัดทรงกลม เส้นที่ไม่โดนใช้จุดสัมผัสขอบฟ้าในระนาบของ pos กับเส้นนั้น (horizon = true)
 */
export function sensorFootprint(pos: Vec3, b: Vec3, halfAngleDeg: number, n = 72): SensorFootprint {
  const axis = unit(b);
  const ring: [number, number][] = [];
  const horizon: boolean[] = [];
  for (const d of coneRays(axis, halfAngleDeg, n)) {
    const hit = hitEarth(pos, d);
    horizon.push(hit === null);
    ring.push(lonLat(hit ?? horizonPoint(pos, d)));
  }
  ring.push([ring[0][0], ring[0][1]]);
  const centre = hitEarth(pos, axis);
  return { ring, horizon, boresightHit: centre === null ? null : lonLat(centre) };
}

/**
 * ทิศกล้องของ Sensor View: direction = b, up = ทิศที่ตั้งฉากกับ b
 * north = แกนโลกที่ฉายลงระนาบตั้งฉาก b (ฉายแล้วสั้น < 1e−6 ใช้ +X ของตัวดาวแทน), velocity = +X ของตัวดาวที่ฉายลงระนาบเดียวกัน
 * ถ้าทิศหลักขนานกับ b ใช้อีกทิศ แล้วเป็น +Y ของตัวดาว (ตั้งฉากกับ +X อยู่แล้ว) เพื่อไม่ได้เวกเตอร์ศูนย์
 */
export function cameraOrientation(_pos: Vec3, b: Vec3, f: BodyFrame, up: "north" | "velocity"): { direction: Vec3; up: Vec3 } {
  const direction = unit(b);
  const [first, second] = up === "north" ? [EARTH_AXIS, f.x] : [f.x, EARTH_AXIS];
  return { direction, up: unitPerp(first, direction) ?? unitPerp(second, direction) ?? unitPerp(f.y, direction) ?? anyPerp(direction) };
}

/**
 * fov (องศา) ของด้านสั้นของภาพ Sensor View: fs = min(2α × 1.05, 120°) / zoom (กรวยพอดีด้านสั้น ขยาย 5% แล้วซูม: imagery spec §5.3)
 * เพดาน 120° ใช้ก่อนหารด้วย zoom
 */
export function sensorViewShortFovDeg(halfAngleDeg: number, zoom = 1): number {
  return Math.min(2 * halfAngleDeg * 1.05, 120) / zoom;
}

/**
 * fov (องศา) ของ PerspectiveFrustum.fov ซึ่งเป็นของด้านยาวของภาพ (aspect = กว้าง / สูง)
 * ด้านสั้นกว้าง fs = sensorViewShortFovDeg(α, zoom) ด้านยาวกว้าง 2·atan(tan(fs/2) × max(aspect, 1/aspect))
 */
export function sensorViewFovDeg(halfAngleDeg: number, aspect: number, zoom = 1): number {
  const short = sensorViewShortFovDeg(halfAngleDeg, zoom);
  return 2 * Math.atan(Math.tan((short * RAD) / 2) * Math.max(aspect, 1 / aspect)) * DEG;
}

/**
 * ความกว้างพื้นที่ (เมตร) ที่ภาพ Sensor View เห็นตามด้านสั้นที่จุดใต้ดาว (imagery spec §4.4): กล้องมองลงศูนย์กลางโลก ด้านสั้นกว้าง shortFovDeg
 * ขอบภาพเอียงจากแนวดิ่ง β = fov / 2 จึงตกที่มุมศูนย์กลางเดียวกับขอบรอยของกรวยครึ่งมุม β (nadirCentralAngleRad: asin(k·sin β) − β, เกินจานโลกจบที่ขอบฟ้า)
 * ความกว้าง = ส่วนโค้งบนผิว 2·Re·θ ไม่ใช้ 2·h·tan(fov/2): มุมแคบ (fov ≤ 2°) สองสูตรต่างกัน < 1% แต่มุมกว้างผิวโลกโค้งหนีกล้อง ผิวกว้างกว่า และเกินจานโลกสูตรแบนผิดมาก
 * ดาวไม่อยู่เหนือผิวโลก (altKm ≤ 0) หรือ fov ไม่เป็นจำนวนบวก = 0
 */
export function sensorViewGroundWidthM(altKm: number, shortFovDeg: number): number {
  if (!(altKm > 0 && shortFovDeg > 0) || !Number.isFinite(altKm) || !Number.isFinite(shortFovDeg)) return 0;
  return 2 * RE_M * nadirCentralAngleRad(altKm, shortFovDeg / 2);
}

/**
 * ระดับชิ้นภาพ (Web Mercator, 256 px) ที่ละเอียดพอให้ภาพกว้าง groundWidthM เมตรบน shortSidePx พิกเซลไม่ขยายจนเบลอ:
 * ระดับต่ำสุด z ที่ metresPerPixel(z) ≤ groundWidthM / shortSidePx, z = ceil(log2(2π·Re / (groundWidthM / shortSidePx · 256))) ไม่ต่ำกว่า 0
 * คิดที่เส้นศูนย์สูตร (ละติจูด φ ชิ้นแคบลง cos φ เท่า ระดับที่ต้องใช้จริงจึงต่ำกว่าเล็กน้อย: ประมาณการด้านที่เตือนเร็วไว้ก่อน)
 * ความกว้างหรือจำนวนพิกเซลที่ไม่เป็นจำนวนบวกจำกัด = null (ไม่มีระดับให้เทียบ)
 */
export function neededImageryLevel(groundWidthM: number, shortSidePx: number): number | null {
  if (!(groundWidthM > 0 && shortSidePx > 0) || !Number.isFinite(groundWidthM) || !Number.isFinite(shortSidePx)) return null;
  const level = Math.ceil(Math.log2((2 * Math.PI * RE_M) / ((groundWidthM / shortSidePx) * 256)));
  return Math.max(0, level);
}
