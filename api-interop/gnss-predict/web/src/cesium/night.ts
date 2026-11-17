// กลางวันกลางคืนของหน้าต่าง 2D (spec §9.3): Lighting → Show Outline วาดเส้นแบ่งกลางวันกลางคืนจากที่นี่
// (Shading ใช้แสงของ globe ของ Cesium ซึ่งตรวจแล้วว่าทำให้ด้านกลางคืนมืดลงในโหมด 2D: spec §17 W2 ไม่ต้องวาดพื้นที่เอง)
//
// จุดใต้ดวงอาทิตย์จากสูตรความแม่นต่ำของ Astronomical Almanac (ราว 0.01°: เกินพอสำหรับภาพ) ไม่ต้องใช้ข้อมูลภายนอก
//   n = JD − 2451545.0, L = 280.460° + 0.9856474°·n, g = 357.528° + 0.9856003°·n, λ = L + 1.915°·sin g + 0.020°·sin 2g, ε = 23.439° − 4e-7°·n
//   α = atan2(cos ε·sin λ, cos λ), δ = asin(sin ε·sin λ), GMST = 280.46061837° + 360.98564736629°·n  →  ละติจูด δ, ลองจิจูด α − GMST
// เส้นแบ่งกลางวันกลางคืนคือวงกลมใหญ่ที่ห่าง 90° จากจุดใต้ดวงอาทิตย์: ที่ลองจิจูด λ  tan φ = −cos(λ − λs) / tan δ
// พื้นที่กลางคืนคือครึ่งทรงกลมรอบจุดตรงข้ามดวงอาทิตย์ (คลุมขั้วที่มืด: ขั้วใต้เมื่อ δ ≥ 0, ขั้วเหนือเมื่อ δ < 0)

import { wrapLon } from "./lonlat";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const mod360 = (x: number): number => ((x % 360) + 360) % 360;

/** จุดใต้ดวงอาทิตย์ ณ เวลา d (องศา ลองจิจูดใน [−180, 180)) */
export function subsolarPoint(d: Date): { lat: number; lon: number } {
  const n = d.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const L = mod360(280.46 + 0.9856474 * n);
  const g = mod360(357.528 + 0.9856003 * n) * RAD;
  const λ = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const ε = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(ε) * Math.sin(λ), Math.cos(λ)) * DEG;
  const dec = Math.asin(Math.sin(ε) * Math.sin(λ)) * DEG;
  const gmst = mod360(280.46061837 + 360.98564736629 * n);
  return { lat: dec, lon: wrapLon(ra - gmst) };
}

/** เส้นแบ่งกลางวันกลางคืน n + 1 จุด ลองจิจูด −180 ถึง 180 ทุก 360/n องศา เป็น [lon, lat] */
export function terminator(d: Date, n = 180): [number, number][] {
  const s = subsolarPoint(d);
  const δ = s.lat * RAD;
  const sign = δ >= 0 ? 1 : -1;
  const tanδ = Math.abs(Math.tan(δ));
  return Array.from({ length: n + 1 }, (_, i): [number, number] => {
    const lon = -180 + (360 * i) / n;
    // φ = atan(−cos Δλ / tan δ) เขียนแบบ atan2 ให้ δ = 0 (วิษุวัต) ได้ ±90° แทนการหารด้วยศูนย์
    return [lon, Math.atan2(-Math.cos((lon - s.lon) * RAD) * sign, tanδ) * DEG];
  });
}

/** polygon กลางคืน: เส้นแบ่งกลางวันกลางคืน (n + 1 จุด) แล้วปิดผ่านขั้วที่มืด [180, ขั้ว], [−180, ขั้ว] เป็น [lon, lat] */
export function nightPolygon(d: Date, n = 180): [number, number][] {
  const pole = subsolarPoint(d).lat >= 0 ? -90 : 90;
  return [...terminator(d, n), [180, pole], [-180, pole]];
}
