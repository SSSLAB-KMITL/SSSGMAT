// ซูมของ Sensor View (imagery spec §5.3, รอบเร่งความเร็วและซูมละเอียด) ฟังก์ชันล้วน ไม่ import อะไร (e2e ใช้ได้ด้วย)
//
// - zoom ใน params เป็นจำนวนต่อเนื่องใน [ZOOM_MIN, ZOOM_MAX] = [1, 262144] (ช่อง Width ตั้งค่าที่ไม่อยู่บนตารางได้) workbook เดิม (กำลังสอง 1–8192) ยังใช้ได้
// - ปุ่ม Zoom In / Zoom Out และล้อเมาส์ก้าวทีละ ×√2 บนตาราง ZOOM_GRID = 2^(k/2), k = 0..36 (k คู่ = กำลังสองพอดี: ×8192 = k 26)
//   ก้าวจากจุดบนตารางที่ใกล้ที่สุด (ในสเกล log) ก่อนเสมอ ปลายทั้งสองคงที่
// - ป้าย "×n" (zoomText ไม่รวม ×): จำนวนเต็มต่ำกว่า 10000 แสดงตรงตัว ไม่ใช่จำนวนเต็มต่ำกว่า 10 ทศนิยมหนึ่งตำแหน่ง (×1.4)
//   ไม่งั้นจำนวนเต็มที่ปัดแล้ว (×11, ×1448) ตั้งแต่ 10000 เป็นพันตัดเศษ (×11k, ×65k, ×262k: ไม่ปัดขึ้น ป้ายไม่เกินค่าจริง)
// - ช่อง Width: "500 m", "1.5 km", "500" (ไม่มีหน่วย = m) ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างระหว่างเลขกับหน่วย ค่าต้องมากกว่า 0

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 262_144;
/** จำนวนก้าว ×√2 จาก ZOOM_MIN ถึง ZOOM_MAX (2^(36/2) = 262144) */
const GRID_STEPS = 36;

/** ตารางของปุ่มและล้อ: 2^(k/2) k = 0..36 (k คู่ = กำลังสองพอดี, k คี่ = กำลังสองคูณ Math.SQRT2) */
export const ZOOM_GRID: readonly number[] = Object.freeze(
  Array.from({ length: GRID_STEPS + 1 }, (_, k) => (k % 2 === 0 ? 2 ** (k / 2) : 2 ** ((k - 1) / 2) * Math.SQRT2)),
);

/** zoom ที่ใช้ได้: จำนวนจำกัดใน [ZOOM_MIN, ZOOM_MAX] */
export const isZoom = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX;

/** k ของจุดบนตารางที่ใกล้ zoom ที่สุดในสเกล log (round(2·log2 zoom)) ไม่เกินปลายทั้งสอง */
export function snapZoomIndex(zoom: number): number {
  const k = Math.round(2 * Math.log2(zoom));
  return Number.isFinite(k) ? Math.min(GRID_STEPS, Math.max(0, k)) : 0;
}

/** ก้าวถัดไป (dir 1 = Zoom In, −1 = Zoom Out): ไปจุดบนตารางที่ใกล้ที่สุดก่อน แล้วก้าว ×√2 ปลายทั้งสองคงที่ */
export function nextZoom(zoom: number, dir: 1 | -1): number {
  return ZOOM_GRID[Math.min(GRID_STEPS, Math.max(0, snapZoomIndex(zoom) + dir))];
}

/** ป้ายของ zoom (ไม่รวม "×") ดูกติกาที่หัวไฟล์ */
export function zoomText(zoom: number): string {
  if (Number.isInteger(zoom) && zoom < 10_000) return String(zoom);
  if (zoom < 9.95) return zoom.toFixed(1);
  if (zoom < 9_999.5) return String(Math.round(zoom));
  return `${Math.floor(zoom / 1000)}k`;
}

/** ข้อความในช่อง Width → เมตร: "<เลข> [m|km]" (ไม่มีหน่วย = m) ค่าต้องมากกว่า 0 อ่านไม่ได้ = null */
export function parseGroundWidth(text: string): number | null {
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(m|km)?$/i.exec(text.trim());
  if (m === null) return null;
  const value = Number(m[1]) * (m[2]?.toLowerCase() === "km" ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}
