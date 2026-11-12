// พื้นที่บนทรงกลมสำหรับแผนที่ 2D (ลองจิจูด/ละติจูดเป็นองศา): วง (cap) รอบจุดหนึ่งที่มุมศูนย์กลาง ρ เช่นรอยเท้าของ Swath (ρ ≤ ~76°)
// และพื้นที่กลางคืน (ρ = 90° รอบจุดตรงข้ามดวงอาทิตย์)
//
// ทำไมไม่ใช้ PolygonGeometry ของ Cesium: มันแบ่งสามเหลี่ยมบนระนาบสัมผัสที่จุดกลางของ polygon (EllipsoidTangentPlane) จุดที่ห่างจากจุดกลางเกิน 90°
// ฉายลงระนาบไม่ได้ (พื้นที่กลางคืนเป็นครึ่งทรงกลม) และสามเหลี่ยมที่ครอบขั้ว (รอยเท้าของดาว GNSS ที่ละติจูด 55° คลุมขั้วเหนือ) ไม่มีจุดยอดที่ขั้ว
// เมื่อฉายลงแผนที่ 2D ทีละจุดยอดจึงไม่คลุมแถบบนสุดของแผนที่
// ที่นี่จึงตัดวงเป็นแถบตามลองจิจูด (คอลัมน์ทุก stepDeg จาก −180 ถึง 180 พร้อมปลายตะวันออก/ตะวันตกของวงเป็นคอลัมน์ของตัวเอง):
// - วงที่ ρ ≤ 90° ตัดกับเส้นลองจิจูดหนึ่งเส้นได้ช่วงละติจูดช่วงเดียว (วงนูนบนทรงกลม ตัดกับเส้นทางที่สั้นที่สุดได้ส่วนต่อเนื่อง) หาได้ตรง ๆ:
//   จุดอยู่ในวงเมื่อ sinφ·sinφc + cosφ·cosφc·cos(λ−λc) ≥ cos ρ  ⇔  R·sin(φ + β) ≥ cos ρ  (R, β จาก sinφc และ cosφc·cos(λ−λc))
// - ขั้วที่อยู่ในวงได้ช่วงถึง ±90° พอดี ฝั่งที่ข้ามเส้น 180° ได้คอลัมน์ที่สองปลายของแผนที่ ไม่มีสามเหลี่ยมใดกว้างเกินระยะของคอลัมน์
//   (Cesium จึงฉายลง 2D ได้ตรง: ทั้ง Equidistant Cylindrical และ Mercator)

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** ใกล้ขั้วหรือปลายวงในระดับนี้ (เรเดียน) นับเป็นจุดนั้นพอดี */
const SNAP = 1e-12;

/** ลองจิจูดในช่วง [−180, 180) */
export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** จุดที่ห่างจาก (lat, lon) ไปทางมุมทิศ azimuthRad (วัดจากทิศเหนือตามเข็มนาฬิกา) เป็นมุมศูนย์กลาง angleRad บนทรงกลม → [lon, lat] องศา */
export function destination(latDeg: number, lonDeg: number, angleRad: number, azimuthRad: number): [number, number] {
  const φ1 = latDeg * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(angleRad) + Math.cos(φ1) * Math.sin(angleRad) * Math.cos(azimuthRad);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const dλ = Math.atan2(Math.sin(azimuthRad) * Math.sin(angleRad) * Math.cos(φ1), Math.cos(angleRad) - Math.sin(φ1) * sinφ2);
  return [wrapLon(lonDeg + dλ * DEG), φ2 * DEG];
}

/** หนึ่งคอลัมน์ของพื้นที่: ช่วงละติจูด [lo, hi] ที่ลองจิจูด lon (ไม่มีส่วนของพื้นที่ = null ทั้งคู่) */
export interface Column {
  lon: number;
  lo: number | null;
  hi: number | null;
}

/** ช่วงละติจูด (เรเดียน) ในวงที่ลองจิจูด λ ไม่มี = null */
function interval(sinφc: number, cosφc: number, dλ: number, cosρ: number): [number, number] | null {
  const a = sinφc;
  const b = cosφc * Math.cos(dλ);
  const r = Math.hypot(a, b);
  if (r < SNAP) return cosρ <= SNAP ? [-Math.PI / 2, Math.PI / 2] : null; // เส้นลองจิจูดตั้งฉากกับแกนของวง (ขอบของครึ่งทรงกลมพอดี)
  let k = cosρ / r;
  if (k > 1) {
    if (k - 1 > 1e-9) return null;
    k = 1; // ปลายวงพอดี (ปัดเศษ)
  }
  if (k < -1) return [-Math.PI / 2, Math.PI / 2];
  const β = Math.atan2(b, a);
  const s = Math.asin(k);
  // R·sin(φ + β) ≥ cos ρ  ⇔  φ + β ∈ [s, π − s] (+ 2πn): เลือก n ที่ทับกับ [−π/2, π/2] มากที่สุด (ρ ≤ 90° มีได้ช่วงเดียว)
  let best: [number, number] | null = null;
  for (const n of [-1, 0, 1]) {
    const lo = Math.max(s - β + 2 * Math.PI * n, -Math.PI / 2);
    const hi = Math.min(Math.PI - s - β + 2 * Math.PI * n, Math.PI / 2);
    if (hi < lo - SNAP) continue;
    if (best === null || hi - lo > best[1] - best[0]) best = [lo, Math.max(lo, hi)];
  }
  // วงที่แตะขั้วพอดี (เช่นครึ่งทรงกลมกลางคืนตอนวิษุวัต): จุดเดียวที่ขั้วไม่ใช่พื้นที่
  if (best !== null && best[1] - best[0] < SNAP && Math.abs(best[0]) > Math.PI / 2 - SNAP) return null;
  return best;
}

const latDeg = (v: number): number => (v <= -Math.PI / 2 + SNAP ? -90 : v >= Math.PI / 2 - SNAP ? 90 : v * DEG);

/**
 * วงรัศมีเชิงมุม radiusRad (0 < ρ ≤ π/2) รอบ (latDeg, lonDeg) เป็นคอลัมน์ทุก stepDeg จาก −180 ถึง 180 (รวม 180)
 * วงที่ไม่คลุมขั้วมีปลายตะวันออก/ตะวันตก λc ± asin(sin ρ / cos φc) เป็นคอลัมน์เพิ่ม (ช่วงเป็นจุดเดียว) ภาพจึงไม่ทู่ที่ปลาย
 */
export function capColumns(latDeg0: number, lonDeg0: number, radiusRad: number, stepDeg = 2): Column[] {
  const φc = latDeg0 * RAD;
  const sinφc = Math.sin(φc);
  const cosφc = Math.cos(φc);
  const cosρ = Math.cos(radiusRad);
  const lons: number[] = [];
  for (let i = 0; -180 + i * stepDeg < 180 - 1e-9; i++) lons.push(-180 + i * stepDeg);
  lons.push(180);
  if (Math.sin(radiusRad) < cosφc - SNAP) {
    const half = Math.asin(Math.sin(radiusRad) / cosφc) * DEG;
    for (const tip of [wrapLon(lonDeg0 - half), wrapLon(lonDeg0 + half)]) if (!lons.some((l) => Math.abs(l - tip) < 1e-9)) lons.push(tip);
    lons.sort((a, b) => a - b);
  }
  return lons.map((lon) => {
    const iv = interval(sinφc, cosφc, (lon - lonDeg0) * RAD, cosρ);
    return iv === null ? { lon, lo: null, hi: null } : { lon, lo: latDeg(iv[0]), hi: latDeg(iv[1]) };
  });
}

/** สามเหลี่ยมของพื้นที่จากคอลัมน์: สองสามเหลี่ยมระหว่างคอลัมน์ที่ติดกันซึ่งมีช่วงทั้งคู่ (ข้ามคอลัมน์ว่างไม่ได้) จุดเป็น [lon, lat] */
export function columnsMesh(columns: readonly Column[]): { lonLat: [number, number][]; indices: number[] } {
  const lonLat: [number, number][] = [];
  const indices: number[] = [];
  let prev: { lo: number; hi: number } | null = null;
  for (const c of columns) {
    if (c.lo === null || c.hi === null) {
      prev = null;
      continue;
    }
    const lo = lonLat.push([c.lon, c.lo]) - 1;
    const hi = lonLat.push([c.lon, c.hi]) - 1;
    if (prev !== null) indices.push(prev.lo, prev.hi, hi, prev.lo, hi, lo);
    prev = { lo, hi };
  }
  return { lonLat, indices };
}
