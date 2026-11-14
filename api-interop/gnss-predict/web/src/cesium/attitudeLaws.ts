// กฎท่าทางรายรุ่น (block) ของดาว GNSS สำหรับโมเดล 3 มิติ: docs/2026-11-14-gnss-attitude-laws.md (ต่อไปเรียก "spec") §1–§4
// ฟังก์ชันล้วนและไม่มีสถานะ: ท่าทาง ณ เวลา t คำนวณจาก r, v, ดวงอาทิตย์ ณ t เท่านั้น จุดเริ่มและจบของการหมุนพิเศษหาเชิงวิเคราะห์จาก β, μ, μ̇
// (วงโคจรเกือบวงกลม β คงที่ระหว่างการหมุน) การเลื่อนเวลา (scrub), รอบ throttle 250 ms และการเล่นต่อเนื่องจึงได้ท่าทางเดียวกันที่เวลาเดียวกัน
//
// กรอบ (spec §1.2): ทุกอย่างในพิกัด ECEF ณ ขณะนั้น v_I = v_ECEF + ω⊕ × r
//   z_ON = −r̂, h = (r × v_I)/|r × v_I|, y_ON = −h, x_ON = y_ON × z_ON  (= sensorGeometry.bodyFrame = attitude.nadirVelocityFrame)
//   ŝ = ทิศจากดาวไปดวงอาทิตย์ (แบบเดียวกับ attitude.yawSteeringFrame) s_x, s_y, s_z = ŝ · x_ON, y_ON, z_ON
//   β = asin(−s_y) (บวกเมื่อดวงอาทิตย์อยู่ฝั่ง +h), μ = atan2(s_x, s_z) (0 = เที่ยงคืน, ±180° = เที่ยงวัน, เพิ่มตามการเคลื่อนที่)
// yaw ψ (spec §1.3): หมุนแบบมือขวารอบ +z_ON จาก +x_ON ไปทาง +y_ON: ex = cos ψ x_ON + sin ψ y_ON, ey = −sin ψ x_ON + cos ψ y_ON, ez = z_ON
// ez = nadir เสมอทุกกฎ (NavIC ไม่ชี้เป้า 5°N 83°E: ดู spec §3.9 และหมายเหตุใน navic)

import { Cartesian3, type JulianDate } from "cesium";
import { nadirVelocityFrame, type AttitudeFrame } from "./attitude";
import { EARTH_ROTATION_RAD_S } from "./sensorGeometry";

const D = Math.PI / 180;
const HALF_PI = Math.PI / 2;
/** รัศมีโลกของแบบจำลองเงาทรงกระบอก (เมตร, WGS84 equatorial) */
export const EARTH_RADIUS_M = 6_378_137;

/** กฎท่าทาง (spec §4.1 AttitudeLaw) + nadir_velocity ของดาวสำรวจโลก (เฟรม sensor §3.1) */
export type AttitudeLaw =
  | "nominal_ys"
  | "orbit_normal"
  | "nadir_velocity"
  | "gps_iir"
  | "gps_iif"
  | "gps_iii"
  | "glonass_m"
  | "glonass_k"
  | "galileo_iov"
  | "galileo_foc"
  | "bds2_ys_on"
  | "bds3_cast"
  | "bds3_secm"
  | "qzss1_ys_on"
  | "qzss2_pseudo_ys"
  | "navic";

/** โหมดที่ใช้อยู่ ณ ขณะนั้น (spec §4.1 AttitudeMode) */
export type AttitudeMode = "YS" | "ON" | "NOON_TURN" | "MIDNIGHT_TURN" | "SHADOW" | "SMOOTHED_TURN";

/** ผลของกฎหนึ่งตัว ณ เวลาหนึ่ง: กรอบตัวดาวใน ECEF, yaw ψ (เรเดียน), โหมด, β และ μ (เรเดียน) */
export interface LawAttitude {
  frame: AttitudeFrame;
  yaw: number;
  mode: AttitudeMode;
  beta: number;
  mu: number;
}

/** ฟังก์ชันท่าทางของกฎหนึ่งตัว: (r, v ECEF, ตำแหน่งดวงอาทิตย์ ECEF, เวลา) → ท่าทาง (null เมื่อ |r| = 0 หรือ v_I ขนานกับ r) */
export type AttitudeFn = (r: Cartesian3, v: Cartesian3, sun: Cartesian3, t: JulianDate, result?: LawAttitude) => LawAttitude | null;

/** กฎที่พารามิเตอร์เป็นค่าประมาณ (ไม่มีเอกสารทางการ หรือเราเลือกค่าเอง): ดูหมายเหตุของแต่ละกฎ */
export const ESTIMATED_LAWS: ReadonlySet<AttitudeLaw> = new Set<AttitudeLaw>(["navic", "gps_iii", "glonass_k"]);

// ---------- block → กฎ (spec §3.1, §4.2 law_for_block) ----------

const LAW_BY_BLOCK: Readonly<Record<string, AttitudeLaw>> = {
  "GPS-IIR-A": "gps_iir", "GPS-IIR-B": "gps_iir", "GPS-IIR-M": "gps_iir",
  "GPS-IIF": "gps_iif",
  "GPS-III": "gps_iii", "GPS-IIIA": "gps_iii", "GPS-III-1": "gps_iii",
  "GLO-M": "glonass_m", "GLO-M+": "glonass_m",
  "GLO-K1": "glonass_k", "GLO-K1+": "glonass_k", "GLO-K1A": "glonass_k", "GLO-K1B": "glonass_k", "GLO-K2": "glonass_k",
  "GAL-1": "galileo_iov",
  "GAL-2": "galileo_foc",
  "BDS-2G": "orbit_normal", "BDS-3G": "orbit_normal", "QZS-2G": "orbit_normal", "QZS-3G": "orbit_normal",
  "BDS-2I": "bds2_ys_on", "BDS-2M": "bds2_ys_on",
  "BDS-3M-CAST": "bds3_cast", "BDS-3I": "bds3_cast", "BDS-3SM-CAST": "bds3_cast", "BDS-3SI-CAST": "bds3_cast",
  "BDS-3M-SECM-A": "bds3_secm", "BDS-3M-SECM-B": "bds3_secm", "BDS-3SM-SECM": "bds3_secm", "BDS-3SI-SECM": "bds3_secm",
  "QZS-1": "qzss1_ys_on",
  "QZS-2I": "qzss2_pseudo_ys", "QZS-2A": "qzss2_pseudo_ys",
  "IRS-1G": "navic", "IRS-1I": "navic", "IRS-2G": "navic", "IRS-2I": "navic",
};

/**
 * กฎท่าทางของดาวจาก block ของ IGS (spec §4.2 law_for_block): ดาวสำรวจโลก (eo) ใช้เฟรม nadir + ความเร็ว (sensor §3.1) เสมอ
 * block ที่ไม่รู้จัก เลิกใช้แล้ว (GPS-IIA, GAL-0A, GLO, BDS-3S, …) ว่าง หรือไม่มี = nominal yaw steering
 * BDS-2I/2M ทุกดวงใช้แบบเดิม YS ↔ ON (ไม่มีรายการ PRN ที่อัปเกรดเป็น CYS ปี 2017–2018: spec §3.7.2)
 */
export function attitudeLawFor(block: string | null, eo: boolean): AttitudeLaw {
  if (eo) return "nadir_velocity";
  if (block === null || !Object.hasOwn(LAW_BY_BLOCK, block)) return "nominal_ys";
  return LAW_BY_BLOCK[block];
}

// ---------- เรขาคณิต (spec §1.2) ----------

/** เรขาคณิตวงโคจร-ดวงอาทิตย์ ณ ขณะหนึ่ง */
export interface OrbitSunGeometry {
  /** กรอบ ON (ex = x_ON, ey = y_ON, ez = z_ON) */
  on: AttitudeFrame;
  sx: number;
  sy: number;
  sz: number;
  beta: number;
  mu: number;
  /** μ̇ (rad/s) = |r × v_I| / |r|² */
  n: number;
  /** |r| (เมตร) */
  rMag: number;
}

const scratchEs = new Cartesian3();
const scratchVi = new Cartesian3();
const scratchH = new Cartesian3();

/** β, μ, μ̇ และกรอบ ON จาก r, v (ECEF) และตำแหน่งดวงอาทิตย์ (ECEF) ไม่มี (null) เมื่อ |r| = 0, v_I ขนานกับ r หรือดวงอาทิตย์อยู่ที่ดาว */
export function orbitSunGeometry(r: Cartesian3, v: Cartesian3, sun: Cartesian3, on?: AttitudeFrame): OrbitSunGeometry | null {
  const frame = nadirVelocityFrame(r, v, on);
  if (frame === null) return null;
  const es = Cartesian3.subtract(sun, r, scratchEs);
  const len = Cartesian3.magnitude(es);
  if (!(len > 0)) return null;
  Cartesian3.divideByScalar(es, len, es);
  const sx = Cartesian3.dot(es, frame.ex);
  const sy = Cartesian3.dot(es, frame.ey);
  const sz = Cartesian3.dot(es, frame.ez);
  const rMag = Cartesian3.magnitude(r);
  const vi = Cartesian3.fromElements(v.x - EARTH_ROTATION_RAD_S * r.y, v.y + EARTH_ROTATION_RAD_S * r.x, v.z, scratchVi);
  const n = Cartesian3.magnitude(Cartesian3.cross(r, vi, scratchH)) / (rMag * rMag);
  return { on: frame, sx, sy, sz, beta: Math.asin(Math.max(-1, Math.min(1, -sy))), mu: Math.atan2(sx, sz), n, rMag };
}

/**
 * แบบจำลองเงาโลกทรงกระบอก (spec §4.2 orbit_sun_geometry): ดาวอยู่หลังโลกเทียบกับดวงอาทิตย์ (r · ŝ < 0)
 * และห่างแนวเส้นตรงผ่านศูนย์กลางโลกตามทิศ ŝ น้อยกว่ารัศมีโลก (|r × ŝ| < R⊕) ŝ = ทิศไปดวงอาทิตย์หนึ่งหน่วย
 */
export function inEarthShadow(r: Cartesian3, sHat: Cartesian3): boolean {
  return Cartesian3.dot(r, sHat) < 0 && Cartesian3.magnitude(Cartesian3.cross(r, sHat, scratchH)) < EARTH_RADIUS_M;
}

/** ช่วงเงาทรงกระบอก: |μ| < μ_e = acos(cos θ0 / cos β), θ0 = asin(R⊕/|r|) (spec §3.5.1, §4.2) ไม่มีเงาเมื่อ |β| ≥ θ0 = null */
function shadowHalfArc(g: OrbitSunGeometry): number | null {
  const cosTheta0 = Math.cos(Math.asin(Math.min(1, EARTH_RADIUS_M / g.rMag)));
  const c = cosTheta0 / Math.cos(g.beta);
  return c < 1 ? Math.acos(c) : null;
}

/** อยู่ในเงา: เงื่อนไขเดียวกับ inEarthShadow ด้วย ŝ จากดาว (s_z > 0 และ cos β cos μ > cos θ0) */
const inShadowArc = (g: OrbitSunGeometry, muE: number | null): boolean => muE !== null && Math.abs(g.mu) < muE;

// ---------- ตัวช่วย ----------

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
/** เครื่องหมายของ β โดย β = 0 นับเป็นบวก (spec §3.6.1 Γ, §4.3 ข้อ 3) */
const signOf = (x: number): 1 | -1 => (x >= 0 ? 1 : -1);

/** nominal yaw ψ_nom(β, μ) = atan2(−tan β, sin μ) เขียนเป็น atan2(−sin β, cos β sin μ) (spec §2.1) จุดเอกฐาน (β = 0 ที่ node) = 0 */
export function nominalYaw(beta: number, mu: number): number {
  const y = -Math.sin(beta);
  const x = Math.cos(beta) * Math.sin(mu);
  return y === 0 && x === 0 ? 0 : Math.atan2(y, x);
}

/** node ที่ใกล้ที่สุด: เที่ยงคืน (|μ| ≤ 90°) หรือเที่ยงวัน และระยะ x = μ − μ_node ในช่วง [−90°, 90°] */
function nodeOf(mu: number): { midnight: boolean; x: number } {
  const midnight = Math.abs(mu) <= HALF_PI;
  return { midnight, x: midnight ? mu : wrapPi(mu - Math.PI) };
}

interface Yaw {
  psi: number;
  mode: AttitudeMode;
}

const YS = (g: OrbitSunGeometry): Yaw => ({ psi: g.sx === 0 && g.sy === 0 ? 0 : Math.atan2(g.sy, g.sx), mode: "YS" });
const ON: Yaw = Object.freeze({ psi: 0, mode: "ON" });

/**
 * การหมุนจำกัดอัตราแบบกึ่งกลาง node (spec §3.2, §3.5, §3.8, §4.2 "centered noon/midnight turn"): เส้นตรง ψ = ψ_node ± R |x| / μ̇
 * ผ่าน ψ_node = −90° sign β ที่ node พอดี และตัดกับ nominal ที่สองข้างอย่างสมมาตร (ψ_nom สมมาตรแบบจุดรอบ (node, ψ_node))
 * เขียนแบบปิด: dev = wrap(ψ_nom − ψ_node), ψ = ψ_node + sign(dev) · min(|dev|, R |x| / μ̇) ไม่ต้องหาจุดตัดด้วยวิธีเชิงตัวเลข
 * - |dev| = atan(|sin x| / |tan β|) เว้าใน x และชันที่ node 1/|tan β| เท่า μ̇: เส้นชนะเมื่อ |β| < β0 = atan(μ̇/R) เท่านั้น
 *   (|β| ≥ β0 ได้ nominal ทั้งรอบโดยไม่ต้องมีเงื่อนไขแยก ต่อเนื่องที่ β0) ภายในการหมุน |ψ̇| = R ตรงตัว
 * - reversed: หมุนทางยาวผ่าน +90° sign β แทน (|dev| = 180° − |dev ปกติ|) สูตรเดียวกัน (GPS IIF ที่ β ∈ [−0.7°, 0): spec §3.3, §4.3 ข้อ 3)
 * นอก node ที่ใช้ (useMidnight/useNoon = false) = nominal
 */
function centredTurn(g: OrbitSunGeometry, rateRadS: number, useMidnight: boolean, useNoon: boolean, reversed = false): Yaw {
  const nominal = YS(g);
  const { midnight, x } = nodeOf(g.mu);
  if (midnight ? !useMidnight : !useNoon) return nominal;
  // |β| ≥ β0: เส้นไม่มีวันชนะ (เช็กตรงนี้แทนการเทียบ |dev| กับเส้นที่ x ≈ 0 ซึ่งตัดสินด้วยการปัดเศษ)
  if (!reversed && Math.abs(Math.tan(g.beta)) * rateRadS >= g.n) return nominal;
  const sgn = signOf(g.beta);
  const psiNode = reversed ? sgn * HALF_PI : -sgn * HALF_PI;
  const dev = wrapPi(nominal.psi - psiNode);
  const line = (rateRadS * Math.abs(x)) / g.n;
  if (Math.abs(dev) <= line) return nominal;
  return { psi: wrapPi(psiNode + (dev >= 0 ? 1 : -1) * line), mode: midnight ? "MIDNIGHT_TURN" : "NOON_TURN" };
}

/** ψ แบบ β แทน (damped/clamped) ตามสูตร atan2(−tan β′, sin μ) */
const yawWithBeta = (betaEff: number, mu: number): number => nominalYaw(betaEff, mu);

/**
 * β แบบหน่วง (spec §3.7.3 ข้อ 1, ESOC / Xia et al. 2019): β_d = β + f (sign β · β0 − β), f = 1/(1 + d sin⁴μ) เมื่อ |β| ≤ β0 ไม่งั้น f = 0
 * ที่ node (sin μ = 0) |β_d| = β0 ห่าง node β_d → β เร็ว ต่อเนื่องที่ |β| = β0 (β_d = β ไม่ว่า f เท่าไร)
 */
function dampedTurn(g: OrbitSunGeometry, beta0: number, d: number): Yaw {
  if (Math.abs(g.beta) > beta0) return YS(g);
  const s4 = Math.sin(g.mu) ** 4;
  const f = 1 / (1 + d * s4);
  const betaD = g.beta + f * (signOf(g.beta) * beta0 - g.beta);
  return { psi: yawWithBeta(betaD, g.mu), mode: f >= 0.01 ? "SMOOTHED_TURN" : "YS" };
}

const R_IIR = 0.2 * D;
const R_IIF = 0.11 * D;
const R_III = 0.082 * D;
const R_GLO_M = 0.25 * D;
const R_GLO_K = 0.24987 * D;
const OMEGA_C_QZSS2 = 0.055 * D;
/** GPS IIF: ช่วง β ที่ noon turn หมุนกลับทาง (β_eff = β + 0.7°: spec §3.3 ข้อ 2, §4.3 ข้อ 3) */
const IIF_BETA_BIAS = 0.7 * D;
/** GPS III: ค่าคงที่การหน่วง d (เลือกเอง: ประมาณการ) */
export const GPS_III_DAMPING = 2000;
const CAST_BETA0 = 3 * D;
const CAST_DAMPING = 80_000;
const SECM_BETA0 = 3 * D;
const BDS2_ON_BETA = 4 * D;
const QZSS1_ON_BETA = 20 * D;
/** NavIC: เกณฑ์ ON ที่เลือกเอง (spec §3.9: ประมาณ 2.8°–5° ไม่มีเอกสาร ISRO) */
export const NAVIC_ON_BETA_DEG = 4;
const GAL_IOV_BETA_X = 15 * D;
const GAL_IOV_BETA_Y = 2 * D;
const GAL_FOC_BETA = 4.1 * D;
const GAL_FOC_EPSILON = 10 * D;

// ---------- กฎรายตัว: (เรขาคณิต) → ψ, โหมด ----------

/** Nominal yaw steering (spec §2.1): ψ = atan2(s_y, s_x) ดวงอาทิตย์อยู่ในระนาบ X-Z ฝั่ง +X; จุดเอกฐานพอดี (s_x = s_y = 0) ใช้ ψ = 0 */
export const yawNominal = (g: OrbitSunGeometry): Yaw => YS(g);

/** Orbit normal (spec §2.2, §3.7.1, §3.8 ข้อ 3): ψ ≡ 0 (ex = x_ON ตามความเร็ว, ey = −h) */
export const yawOrbitNormal = (_g: OrbitSunGeometry): Yaw => ON;

/**
 * GPS IIR / IIR-M (spec §3.2): หมุนจำกัดอัตรา R = 0.20°/s ทั้ง noon และ midnight แบบกึ่งกลาง node (centredTurn) เมื่อ |β| < atan(μ̇/R) ≈ 2.4°
 * ต่างจากสูตร Kouba ใน §3.2 (เริ่มที่ |ψ̇_nom| = R แล้ววิ่งจนทัน) ตรงที่จุดเริ่ม/จบสมมาตร (ตามตาราง §3.1 "centered" และ §4.2) จึงผ่าน −90° sign β ตรง node
 */
export const yawGpsIir = (g: OrbitSunGeometry): Yaw => centredTurn(g, R_IIR, true, true);

/**
 * GPS IIF (spec §3.3):
 * - noon: centredTurn ที่ R = 0.11°/s (|β| < ≈ 4.35°) และที่ β ∈ [−0.7°, 0) หมุนกลับทาง (ทางยาวผ่าน +90° sign β แทน −90° sign β)
 * - เงาโลก (cylindrical, |β| < θ0 ≈ 13.9°): อัตราคงที่ตลอดเงา ψ = ψ_nom(−μ_e) + Δ (μ + μ_e)/(2 μ_e), Δ = wrap(ψ_nom(μ_e) − ψ_nom(−μ_e))
 *   จุดเข้า/ออกเงา ±μ_e หาเชิงวิเคราะห์ ออกจากเงาตรง nominal พอดี (ไม่มี post-shadow recovery)
 */
export function yawGpsIif(g: OrbitSunGeometry): Yaw {
  const muE = shadowHalfArc(g);
  if (inShadowArc(g, muE)) {
    const psiS = nominalYaw(g.beta, -muE!);
    const delta = wrapPi(nominalYaw(g.beta, muE!) - psiS);
    return { psi: wrapPi(psiS + (delta * (g.mu + muE!)) / (2 * muE!)), mode: "SHADOW" };
  }
  const reversed = g.beta < 0 && g.beta >= -IIF_BETA_BIAS;
  return centredTurn(g, R_IIF, false, true, reversed);
}

/**
 * GPS III / IIIA (spec §3.4): yaw steering แบบเรียบ สมมาตรรอบ noon และ midnight |ψ̇| ≤ R = 0.082°/s ใช้เวลาราว 1 ชั่วโมง
 * spec ไม่มีสูตรปิด จึงใช้ β หน่วงแบบ §3.7.3 ด้วย β0 = atan(μ̇/R) (≈ 5.8°: ที่ node |ψ̇| = μ̇/tan β0 = R พอดี) และ d = 2000
 * (ประมาณการ: เลือก d ให้ |ψ̇| ไม่เกิน R ทุก β ใน [0, β0] และการหมุนกว้างราว 1 ชั่วโมง ตรวจเชิงตัวเลขใน test)
 */
export const yawGpsIii = (g: OrbitSunGeometry): Yaw => dampedTurn(g, Math.atan(g.n / R_III), GPS_III_DAMPING);

/**
 * GLONASS-M (spec §3.5.1):
 * - noon: centredTurn ที่ R = 0.25°/s (|β| < ≈ 2°) ผ่าน ±90° ตรงเที่ยงวัน
 * - เงาโลก (|β| < θ0): เริ่มหมุนที่จุดเข้าเงา −μ_e ด้วย R ไปทาง Δ = wrap(ψ_nom(μ_e) − ψ_nom(−μ_e)) จนถึง ψ_nom(μ_e) แล้วค้างไว้จนออกเงา
 *   ψ = ψ_nom(−μ_e) + sign Δ · min(|Δ|, R (μ + μ_e)/μ̇) ไม่ต้องจำสถานะ: จุดเข้าเงาหาจากแบบจำลองทรงกระบอกเชิงวิเคราะห์ (ถึงก่อนออกเงาเสมอ)
 */
export function yawGlonassM(g: OrbitSunGeometry): Yaw {
  const muE = shadowHalfArc(g);
  if (inShadowArc(g, muE)) {
    const psiS = nominalYaw(g.beta, -muE!);
    const delta = wrapPi(nominalYaw(g.beta, muE!) - psiS);
    const turned = Math.min(Math.abs(delta), (R_GLO_M * (g.mu + muE!)) / g.n);
    return { psi: wrapPi(psiS + (delta >= 0 ? 1 : -1) * turned), mode: "SHADOW" };
  }
  return centredTurn(g, R_GLO_M, false, true);
}

/**
 * GLONASS-K1 / K2 (spec §3.5.2): หมุนแบบสมมาตรกึ่งกลางทั้ง noon และ midnight (ไม่เริ่มที่เงา) ที่ R = 0.24987°/s (|β| < ≈ 2°)
 * ประมาณการ: ใช้อัตราคงที่ตลอดการหมุน (centredTurn) ไม่มีช่วง ramp-up/ramp-down ของอัตรา
 */
export const yawGlonassK = (g: OrbitSunGeometry): Yaw => centredTurn(g, R_GLO_K, true, true);

/**
 * Galileo IOV (spec §3.6.1): เวกเตอร์ดวงอาทิตย์เสริม S_H ในกล่อง |S_ox| < sin 15° และ |S_oy| < sin 2° (S_o = (−s_x, s_y, −s_z) ของ GSC)
 * S_Hy = ½(Γ sin 2° + S_oy) + ½(Γ sin 2° − S_oy) cos(π |S_ox| / sin 15°), Γ = sign(S_oy) (0 → +1) แล้ว ψ = atan2(S_Hy, −S_Hx) = atan2(S_Hy, s_x)
 * Γ ใช้ค่าปัจจุบันแทนค่า ณ จุดเข้ากล่อง (β คงที่ตลอดการผ่านกล่อง จึงเท่ากัน) ต่อเนื่องที่ขอบกล่องทั้งสองด้าน
 */
export function yawGalileoIov(g: OrbitSunGeometry): Yaw {
  const sox = -g.sx;
  const soy = g.sy;
  const sinBx = Math.sin(GAL_IOV_BETA_X);
  const sinBy = Math.sin(GAL_IOV_BETA_Y);
  if (!(Math.abs(sox) < sinBx && Math.abs(soy) < sinBy)) return YS(g);
  const gamma = signOf(soy);
  const shy = 0.5 * (gamma * sinBy + soy) + 0.5 * (gamma * sinBy - soy) * Math.cos((Math.PI * Math.abs(sox)) / sinBx);
  return { psi: Math.atan2(shy, g.sx), mode: "SMOOTHED_TURN" };
}

/**
 * Galileo FOC (spec §3.6.2): เมื่อ |β| < 4.1° และมุม ε = acos(|cos β cos μ|) < 10° (ช่วง |x| < x_i = acos(cos 10° / cos β) รอบ node)
 * ψ = 90° s + (ψ_init − 90° s) cos(π τ), s = sign ψ_init, ψ_init = ψ_nom(node − x_i), τ = (x + x_i)/(2 x_i) ∈ [0, 1]
 * ทำให้เป็นสถานะไร้ความจำ: t_init คือจุดที่ ε ลดถึง 10° (หาเชิงวิเคราะห์) และครึ่งคาบ cosine ใช้ช่วงสมมาตร 2 x_i / μ̇ แทน 2828 s คงที่
 * (เท่ากับ 2828 s ภายใน 1% ที่ β ≈ 0 ของ Galileo; ด้วยค่าคงที่ 2828 s ท่าทางจะกระโดด ~1° ตอนกลับเข้า nominal ที่ β ≠ 0) จบตรง ψ_nom(node + x_i)
 */
export function yawGalileoFoc(g: OrbitSunGeometry): Yaw {
  if (!(Math.abs(g.beta) < GAL_FOC_BETA)) return YS(g);
  const xi = Math.acos(Math.cos(GAL_FOC_EPSILON) / Math.cos(g.beta));
  const { midnight, x } = nodeOf(g.mu);
  if (!(Math.abs(x) < xi)) return YS(g);
  const psiInit = nominalYaw(g.beta, (midnight ? 0 : Math.PI) - xi);
  const s = psiInit >= 0 ? HALF_PI : -HALF_PI;
  const tau = (x + xi) / (2 * xi);
  return { psi: wrapPi(s + (psiInit - s) * Math.cos(Math.PI * tau)), mode: "SMOOTHED_TURN" };
}

/** BeiDou-2 IGSO/MEO (spec §3.7.2): ON เมื่อ |β| ≤ 4° ไม่งั้น nominal YS (ไม่จำลอง CYS ของดาวที่อัปเกรดปี 2017–2018) */
export const yawBds2 = (g: OrbitSunGeometry): Yaw => (Math.abs(g.beta) <= BDS2_ON_BETA ? ON : YS(g));

/** BeiDou-3 CAST MEO/IGSO (spec §3.7.3 ข้อ 1): β หน่วง β0 = 3° (ค่า CSNO) d = 80,000 ทั้ง MEO และ IGSO (ไม่ใช้ 2.8° ของ MEO และไม่ใช้แบบ WHU) */
export const yawBds3Cast = (g: OrbitSunGeometry): Yaw => dampedTurn(g, CAST_BETA0, CAST_DAMPING);

/** BeiDou-3 SECM (spec §3.7.4 สเปก CSNO): |β| ≤ 3° ใช้ β = ±3° ตามเครื่องหมาย β (0 → +3°) ไม่จำลองการพลิกที่เลื่อนออกไปซึ่งต้องมีประวัติ */
export function yawBds3Secm(g: OrbitSunGeometry): Yaw {
  if (Math.abs(g.beta) > SECM_BETA0) return YS(g);
  return { psi: yawWithBeta(signOf(g.beta) * SECM_BETA0, g.mu), mode: "YS" };
}

/** QZS-1 (spec §3.8 ข้อ 1): ON เมื่อ |β| ≤ 20° ไม่งั้น nominal YS */
export const yawQzss1 = (g: OrbitSunGeometry): Yaw => (Math.abs(g.beta) <= QZSS1_ON_BETA ? ON : YS(g));

/**
 * QZS-2/4 (QZS-2I) และ QZS-1R (QZS-2A) (spec §3.8 ข้อ 2): YS ตลอดปี + pseudo-YS อัตราคงที่ ω_c = 0.055°/s ผ่าน ψ_1 ที่ node
 * (centredTurn ทั้ง noon และ midnight) ในกรอบของเรา ψ_1 = −90° sign β ทั้งสอง node (ทิศหมุนกลับกันที่ noon) |β| < ≈ 4.4° สำหรับ μ̇ ของ IGSO
 */
export const yawQzss2 = (g: OrbitSunGeometry): Yaw => centredTurn(g, OMEGA_C_QZSS2, true, true);

/**
 * NavIC IRNSS-1 / NVS (spec §3.9): YS + ON เมื่อ |β| < 4° (ประมาณการ: ISRO ไม่เผยเกณฑ์ ช่วงที่ใช้ในงานวิจัย 2.8°–5°)
 * ไม่จำลองการชี้เป้า (5°N, 83°E): +Z ชี้ศูนย์กลางโลกเหมือนดาวอื่น (คลาดจากของจริงไม่เกินราว 1° สำหรับ GEO/IGSO)
 */
export const yawNavic = (g: OrbitSunGeometry): Yaw => (Math.abs(g.beta) < NAVIC_ON_BETA_DEG * D ? ON : YS(g));

const YAW_OF: Readonly<Record<AttitudeLaw, (g: OrbitSunGeometry) => Yaw>> = {
  nominal_ys: yawNominal,
  orbit_normal: yawOrbitNormal,
  nadir_velocity: yawOrbitNormal,
  gps_iir: yawGpsIir,
  gps_iif: yawGpsIif,
  gps_iii: yawGpsIii,
  glonass_m: yawGlonassM,
  glonass_k: yawGlonassK,
  galileo_iov: yawGalileoIov,
  galileo_foc: yawGalileoFoc,
  bds2_ys_on: yawBds2,
  bds3_cast: yawBds3Cast,
  bds3_secm: yawBds3Secm,
  qzss1_ys_on: yawQzss1,
  qzss2_pseudo_ys: yawQzss2,
  navic: yawNavic,
};

const newResult = (): LawAttitude => ({ frame: { ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() }, yaw: 0, mode: "YS", beta: 0, mu: 0 });
const scratchOn: AttitudeFrame = { ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() };
const scratchA = new Cartesian3();

/**
 * ท่าทางของกฎ law ณ เวลา t (spec §4.2 compute_attitude แบบไม่มีสถานะ): r, v = ตำแหน่ง/ความเร็ว ECEF, sun = ตำแหน่งดวงอาทิตย์ ECEF
 * nadir_velocity = กรอบ sensor §3.1 (ψ = 0 ของกรอบ ON) result (ถ้าให้) ถูกเขียนทับและคืนตัวเดียวกัน ไม่ให้ = object ใหม่
 * t ไม่ถูกใช้ในการคำนวณ (ทุกกฎเป็นฟังก์ชันของเรขาคณิต ณ t) คงไว้ในลายเซ็นให้กฎที่ต้องใช้เวลาในอนาคต
 */
export function lawAttitude(law: AttitudeLaw, r: Cartesian3, v: Cartesian3, sun: Cartesian3, _t: JulianDate, result?: LawAttitude): LawAttitude | null {
  const g = orbitSunGeometry(r, v, sun, scratchOn);
  if (g === null) return null;
  const { psi, mode } = YAW_OF[law](g);
  const out = result ?? newResult();
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  const { ex: x, ey: y, ez: z } = g.on;
  Cartesian3.add(Cartesian3.multiplyByScalar(x, c, out.frame.ex), Cartesian3.multiplyByScalar(y, s, scratchA), out.frame.ex);
  Cartesian3.add(Cartesian3.multiplyByScalar(x, -s, out.frame.ey), Cartesian3.multiplyByScalar(y, c, scratchA), out.frame.ey);
  Cartesian3.clone(z, out.frame.ez);
  out.yaw = psi;
  out.mode = mode;
  out.beta = g.beta;
  out.mu = g.mu;
  return out;
}

/** ฟังก์ชันท่าทางต่อกฎ (ลายเซ็น (r, v, sun, t) → ท่าทาง) */
export const ATTITUDE_LAWS: Readonly<Record<AttitudeLaw, AttitudeFn>> = Object.fromEntries(
  (Object.keys(YAW_OF) as AttitudeLaw[]).map((law) => [law, (r: Cartesian3, v: Cartesian3, sun: Cartesian3, t: JulianDate, result?: LawAttitude) => lawAttitude(law, r, v, sun, t, result)]),
) as Record<AttitudeLaw, AttitudeFn>;
