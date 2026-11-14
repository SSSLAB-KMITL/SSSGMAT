// เวลาของชั้นภาพ GIBS (spec imagery §3.3): ฟังก์ชันบริสุทธิ์ตัวเดียวที่ทุก viewer ใช้ คิดเป็น UTC เสมอ ไม่ขึ้นกับเขตเวลาของเครื่อง
// - static → "default" (ภาพไม่ผูกเวลา)
// - daily  → วันที่ UTC "YYYY-MM-DD"
// - 10min  → ปัดลงทุก 10 นาที UTC "YYYY-MM-DDTHH:MM:00Z"
// token นี้เป็นส่วน {time} ของ URL ชิ้นภาพ (/api/imagery/tiles/{id}/{time}/{z}/{y}/{x}) server ตรวจรูปแบบเดียวกัน

export type ImageryPeriod = "static" | "daily" | "10min";

const TEN_MIN_MS = 10 * 60 * 1000;

export function timeToken(period: ImageryPeriod, t: Date): string {
  if (period === "static") return "default";
  if (period === "daily") return t.toISOString().slice(0, 10);
  const floored = new Date(Math.floor(t.getTime() / TEN_MIN_MS) * TEN_MIN_MS);
  return `${floored.toISOString().slice(0, 16)}:00Z`;
}

/** ข้อความเวลาของชั้นบน HUD: static = ไม่มี, daily = วันที่, 10min = "YYYY-MM-DD HH:MM UTC" */
export function tokenLabel(period: ImageryPeriod, token: string): string {
  if (period === "static") return "";
  if (period === "daily") return token;
  return `${token.slice(0, 10)} ${token.slice(11, 16)} UTC`;
}
