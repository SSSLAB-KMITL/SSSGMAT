// Swath แบบ Ground Elevation ของดาว (spec §9.3, STK ref §C "Satellite 2D Graphics - Swath"): รอยเท้าบนพื้นโลกที่เห็นดาวที่มุมเงย ≥ ε
//
// โลกทรงกลมรัศมีเฉลี่ย Re (IUGG) มุมศูนย์กลางจากจุดใต้ดาวถึงขอบรอยเท้า θ = acos(Re·cos ε / (Re + h)) − ε
// (สามเหลี่ยม ศูนย์กลางโลก–ผู้สังเกต–ดาว: มุมที่ผู้สังเกตเป็น 90° + ε, ไซน์รูล sin(มุมที่ดาว) = Re·cos ε / (Re + h), มุมที่ดาว + θ + 90° + ε = 180°)
// จุดใต้ดาวคือจุดบนผิวโลกในทิศของตำแหน่งดาว: ละติจูด geocentric φc ของทิศนั้นแปลงเป็น geodetic (WGS 84: tan φd = tan φc / (1 − e²))
// เพราะทั้งวงและพื้นที่ถูกวาดเป็นละติจูด geodetic (ไม่แปลงจะคลาดไปทางขั้วราว 0.19° / 21 km ที่ละติจูดกลาง ๆ) h = |r| − Re
// Edge Limits วาดวงจาก footprintRing, Filled Limits วาดพื้นที่จาก capColumns (lonlat.ts) ของวงเดียวกัน

import { capColumns, destination, wrapLon, type Column } from "./lonlat";

/** รัศมีเฉลี่ยของโลก (IUGG, km) */
export const EARTH_RADIUS_KM = 6371.0088;
/** ความเยื้องศูนย์กลางกำลังสองของทรงรี WGS 84 */
export const WGS84_E2 = 0.00669437999014;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** มุมศูนย์กลาง (เรเดียน) จากจุดใต้ดาวที่สูง altKm ถึงขอบรอยเท้าที่มุมเงย elevDeg */
export function footprintCentralAngleRad(altKm: number, elevDeg: number): number {
  const ε = elevDeg * RAD;
  return Math.acos((EARTH_RADIUS_KM * Math.cos(ε)) / (EARTH_RADIUS_KM + altKm)) - ε;
}

/** จุด n จุดบนขอบรอยเท้า เริ่มทางทิศเหนือของจุดใต้ดาวแล้ววนตามเข็มนาฬิกา (ไม่ปิดวง) เป็น [lon, lat] องศา ลองจิจูดใน [−180, 180) */
export function footprintRing(latDeg: number, lonDeg: number, altKm: number, elevDeg: number, n = 72): [number, number][] {
  const θ = footprintCentralAngleRad(altKm, elevDeg);
  return Array.from({ length: n }, (_, i) => destination(latDeg, lonDeg, θ, (2 * Math.PI * i) / n));
}

/** จุดใต้ดาว (ละติจูด geodetic ของจุดบนผิวโลกในทิศของดาว) และความสูงเหนือโลกทรงกลมรัศมี EARTH_RADIUS_KM จากตำแหน่ง Earth-fixed (เมตร) */
export function subSatellite(p: { x: number; y: number; z: number }): { lat: number; lon: number; altKm: number } {
  const r = Math.hypot(p.x, p.y, p.z);
  const horizontal = Math.hypot(p.x, p.y);
  // tan φd = tan φc / (1 − e²) เขียนแบบ atan2 ให้ขั้วได้ ±90° พอดี
  const lat = Math.atan2(p.z, (1 - WGS84_E2) * horizontal) * DEG;
  return { lat, lon: wrapLon(Math.atan2(p.y, p.x) * DEG), altKm: r / 1000 - EARTH_RADIUS_KM };
}

export interface SwathShape {
  /** ขอบรอยเท้า (Edge Limits) ปิดวงแล้ว (จุดแรกซ้ำที่ท้าย) */
  ring: [number, number][];
  /** พื้นที่รอยเท้า (Filled Limits) เป็นคอลัมน์ */
  columns: Column[];
}

/** รอยเท้าของดาวที่ตำแหน่ง p (Earth-fixed, เมตร) ที่มุมเงย elevDeg ดาวที่อยู่ใต้พื้นหรือบนพื้น (ไม่มีรอยเท้า) = null */
export function swathShape(p: { x: number; y: number; z: number }, elevDeg: number): SwathShape | null {
  const sub = subSatellite(p);
  if (!(sub.altKm > 0)) return null;
  const θ = footprintCentralAngleRad(sub.altKm, elevDeg);
  if (!(θ > 0)) return null;
  const ring = footprintRing(sub.lat, sub.lon, sub.altKm, elevDeg);
  return { ring: [...ring, ring[0]], columns: capColumns(sub.lat, sub.lon, θ) };
}
