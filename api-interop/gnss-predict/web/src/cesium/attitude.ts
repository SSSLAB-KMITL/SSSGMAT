// ท่าทางของโมเดลดาวในหน้าต่าง 3D (models integration spec §3): คำนวณในกรอบ Earth-fixed (ECEF) ณ เวลา Animation
// ฟังก์ชันล้วน ใช้แค่ชนิดคณิตศาสตร์ของ Cesium (Cartesian3, Matrix3, Quaternion, JulianDate) ไม่แตะ scene หรือ entity
//
// r, v = ตำแหน่ง (เมตร) / ความเร็ว ECEF (m/s) ของดาว (ความเร็วจากผลต่างตำแหน่ง t ± 1 s แบบเดียวกับ sensor), s = ตำแหน่งดวงอาทิตย์ ECEF (sunPositionEcef)
// - GNSS (โมเดลที่มี blocks) ใช้ yaw steering: ez = −r̂, es = (s − r)/|s − r|, ey = (ez × es)/|ez × es|, ex = ey × ez
//   ดวงอาทิตย์จึงอยู่ในระนาบ X-Z ฝั่ง +X เสมอ (es·ey = 0, es·ex = |ez × es| ≥ 0)
// - ดาวสำรวจโลก (โมเดลจาก norad_ids) ใช้เฟรม sensor §3.1 (Nadir alignment with ECI velocity constraint) จาก sensorGeometry.bodyFrame
// - แผงโซลาร์หมุนรอบ +Y ของตัวดาวให้ normal ด้านเซลล์ชี้ไปทาง es ที่ฉายลงระนาบ X-Z (wingAngle)

import { Cartesian3, Matrix3, Quaternion, Simon1994PlanetaryPositions, Transforms, type JulianDate } from "cesium";
import { bodyFrame } from "./sensorGeometry";

/** กรอบตัวดาว: แกนหนึ่งหน่วย +X, +Y, +Z ของตัวดาวเขียนในพิกัด ECEF (ตั้งฉากกันและเป็นแบบมือขวา ex × ey = ez) */
export interface AttitudeFrame {
  ex: Cartesian3;
  ey: Cartesian3;
  ez: Cartesian3;
}

/** |ez × es| ต่ำกว่านี้นับว่าดวงอาทิตย์อยู่แนวเดียวกับ nadir (spec §3) */
const SINGULAR = 1e-6;

const scratchEs = new Cartesian3();
const scratchCross = new Cartesian3();
const scratchMatrix = new Matrix3();

const newFrame = (): AttitudeFrame => ({ ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() });

/**
 * กรอบ Nadir alignment with ECI velocity constraint (sensor spec §3.1) เป็น Cartesian3: ใช้ sensorGeometry.bodyFrame ตัวเดียวกับ sensor
 * +Z = −r̂, +X = ส่วนของความเร็วเฉื่อย v_I = v + ω⊕ × r ที่ตั้งฉากกับ Z, +Y = Z × X  (v คือความเร็ว ECEF)
 * ไม่มีกรอบ (null) เมื่อ |r| = 0 หรือ v_I ขนานกับ r
 */
export function nadirVelocityFrame(r: Cartesian3, v: Cartesian3, result?: AttitudeFrame): AttitudeFrame | null {
  const f = bodyFrame(r, v);
  if (f === null) return null;
  const out = result ?? newFrame();
  Cartesian3.fromElements(f.x.x, f.x.y, f.x.z, out.ex);
  Cartesian3.fromElements(f.y.x, f.y.y, f.y.z, out.ey);
  Cartesian3.fromElements(f.z.x, f.z.y, f.z.z, out.ez);
  return out;
}

/**
 * กรอบ yaw steering ของดาว GNSS (spec §3): ez = −r̂, ey = (ez × es)/|ez × es|, ex = ey × ez
 * กรณีดวงอาทิตย์อยู่แนวเดียวกับ nadir (|ez × es| < 1e-6) ใช้ prevEy (ey ของเฟรมก่อนหน้า ฉายให้ตั้งฉากกับ ez ใหม่)
 * ถ้าไม่มี prevEy (หรือ prevEy ขนานกับ ez) ใช้เฟรม sensor §3.1 (nadirVelocityFrame)
 * ไม่มีกรอบ (null) เมื่อ |r| = 0 หรือกรณีที่ต้องถอยไปใช้เฟรม sensor แล้วเฟรมนั้นไม่มี
 * result (ถ้าให้) ถูกเขียนทับและคืนตัวเดียวกัน; prevEy ชี้ไปที่ result.ey ได้
 */
export function yawSteeringFrame(r: Cartesian3, v: Cartesian3, sun: Cartesian3, prevEy?: Cartesian3, result?: AttitudeFrame): AttitudeFrame | null {
  const rr = Cartesian3.magnitude(r);
  if (!(rr > 0)) return null;
  const out = result ?? newFrame();
  const ez = Cartesian3.multiplyByScalar(r, -1 / rr, scratchEs);
  const es = Cartesian3.normalize(Cartesian3.subtract(sun, r, scratchCross), scratchCross);
  let ey = Cartesian3.cross(ez, es, scratchCross);
  let len = Cartesian3.magnitude(ey);
  if (len < SINGULAR) {
    if (prevEy === undefined) return nadirVelocityFrame(r, v, out);
    // ส่วนของ prevEy ที่ตั้งฉากกับ ez
    ey = Cartesian3.subtract(prevEy, Cartesian3.multiplyByScalar(ez, Cartesian3.dot(prevEy, ez), scratchCross), scratchCross);
    len = Cartesian3.magnitude(ey);
    if (len < SINGULAR) return nadirVelocityFrame(r, v, out);
  }
  Cartesian3.clone(ez, out.ez);
  Cartesian3.multiplyByScalar(ey, 1 / len, out.ey);
  Cartesian3.cross(out.ey, out.ez, out.ex);
  return out;
}

/**
 * quaternion ที่หมุนพิกัดตัวดาวเป็น ECEF: R·(1,0,0) = ex, R·(0,1,0) = ey, R·(0,0,1) = ez (R มีคอลัมน์ ex, ey, ez)
 * ใช้เป็น entity.orientation ได้ตรง ๆ (Entity วาง model ด้วย Matrix3.fromQuaternion(orientation) ในกรอบ ECEF)
 * เมื่อ model space ของ glb (หลัง axis correction) ทับกับกรอบตัวดาว
 */
export function bodyToEcefQuaternion(frame: AttitudeFrame, result?: Quaternion): Quaternion {
  // Matrix3 เก็บแบบ column-major: คอลัมน์ที่ 0, 1, 2 = ex, ey, ez
  const m = Matrix3.setColumn(scratchMatrix, 0, frame.ex, scratchMatrix);
  Matrix3.setColumn(m, 1, frame.ey, m);
  Matrix3.setColumn(m, 2, frame.ez, m);
  return Quaternion.fromRotationMatrix(m, result ?? new Quaternion());
}

/**
 * มุม θ (เรเดียน, ช่วง (−π, π]) ที่หมุนแผงโซลาร์รอบแกน +Y ของตัวดาวให้ normal ด้านเซลล์ชี้ไปทางดวงอาทิตย์
 *
 * es = (sun − r)/|sun − r| ฉายลงระนาบ X-Z ของตัวดาว ได้ (a, c) = (es·ex, es·ez); normal ตอนมุมศูนย์ zeroNormalBody ฉายเหลือ (n.x, n.z)
 * มุมของเวกเตอร์ (x, z) รอบ +Y แบบมือขวาวัดจาก +Z ไปทาง +X คือ atan2(x, z) จึง θ = atan2(a, c) − atan2(n.x, n.z)
 *
 * ข้อตกลง: θ เป็นมุมหมุนแบบมือขวารอบแกน +Y ของตัวดาว ตรงกับ Quaternion.fromAxisAngle(Cartesian3.UNIT_Y, θ) ของ Cesium
 * ซึ่งเป็นเมทริกซ์ R_y(θ) = [[cos θ, 0, sin θ], [0, 1, 0], [−sin θ, 0, cos θ]] (หมุน +Z ไปทาง +X): R_y(θ)·zeroNormalBody = ทิศของ (a, 0, c)
 * ตัวอย่าง: ดวงอาทิตย์อยู่ที่ +X ของตัวดาว normal ตอนมุมศูนย์ +Z ได้ θ = +90°, −Z ได้ −90°, +X ได้ 0
 *
 * การใช้กับ node ของ glb: rotation ของ node ใน glTF ใช้ในกรอบ local ของ node (หมุนเรขาคณิตของ node รอบจุดกำเนิดของ node
 * ก่อนวางลงในกรอบของ parent) ใช้ fromAxisAngle(UNIT_Y, θ) ได้ตรง ๆ ก็ต่อเมื่อแกน local ของ node wing ทับกับกรอบตัวดาว
 * (parent ไม่มีการหมุน และแกนของ node = แกนตัวดาวหลังการแก้แกนของโมเดล) ถ้า rotation ถูกเขียนในพิกัด glTF Y-up ดิบ
 * (glTF (x, y, z) = body (x, z, −y)) แกน +Y ของตัวดาวคือ −Z ของ glTF ต้องใช้ fromAxisAngle(−UNIT_Z, θ) แทน
 * (Task 3 ตรวจกับข้อมูล node จริงของ glb)
 *
 * es ไม่มีส่วนในระนาบ X-Z (ดวงอาทิตย์อยู่แนว ±Y ของตัวดาว) หรือ normal ตอนมุมศูนย์ไม่มีส่วนในระนาบ X-Z = 0
 * GNSS (yaw steering) es อยู่ในระนาบ X-Z เสมอ normal จึงชี้ตรงดวงอาทิตย์; ดาวสำรวจโลกคลาดจากดวงอาทิตย์เท่ามุม β ระหว่าง es กับระนาบ X-Z
 */
export function wingAngle(frame: AttitudeFrame, sun: Cartesian3, r: Cartesian3, zeroNormalBody: Cartesian3): number {
  const es = Cartesian3.subtract(sun, r, scratchEs);
  const a = Cartesian3.dot(es, frame.ex);
  const c = Cartesian3.dot(es, frame.ez);
  const n = Cartesian3.magnitude(es);
  if (!(Math.hypot(a, c) > 1e-9 * n) || Math.hypot(zeroNormalBody.x, zeroNormalBody.z) === 0) return 0;
  let θ = Math.atan2(a, c) - Math.atan2(zeroNormalBody.x, zeroNormalBody.z);
  if (θ > Math.PI) θ -= 2 * Math.PI;
  else if (θ <= -Math.PI) θ += 2 * Math.PI;
  return θ;
}

/**
 * ตำแหน่งดวงอาทิตย์ (เมตร) ในกรอบ ECEF แบบเดียวกับที่หน้าต่าง 3D ใช้ทำแสง (UniformState.setSunAndMoonDirections ของ Cesium):
 * Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame (ICRF) หมุนด้วย Transforms.computeIcrfToFixedMatrix
 * ถ้าข้อมูล ICRF ยังไม่โหลด (คืน undefined) ใช้ Transforms.computeTemeToPseudoFixedMatrix แทน เหมือน computeIcrfToCentralBodyFixedMatrix ของโลก
 */
export function sunPositionEcef(date: JulianDate, result?: Cartesian3): Cartesian3 {
  const m = Transforms.computeIcrfToFixedMatrix(date, scratchMatrix) ?? Transforms.computeTemeToPseudoFixedMatrix(date, scratchMatrix);
  const out = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(date, result ?? new Cartesian3());
  return Matrix3.multiplyByVector(m, out, out);
}
