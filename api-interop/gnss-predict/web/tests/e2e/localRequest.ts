// ตัวตรวจว่า request ของ browser ออกนอกเครื่องหรือไม่ (ใช้ใน fixtures.ts) แยกเป็นไฟล์ล้วนที่ไม่ import Playwright: unit test และ node เรียกตรง ๆ ได้
// ไม่มี dependency ใด ๆ และ import ในไฟล์นี้ต้องใส่นามสกุล .ts เต็ม (node อ่านไฟล์นี้ตรงโดยไม่ผ่าน bundler)

/** origin ของ server ที่ playwright.config.ts เปิดให้ทุก spec (start-server.sh) */
export const E2E_ORIGIN = "http://127.0.0.1:8766";

/**
 * origin ที่หน้าเว็บขอได้ (ลงท้ายด้วย `/` เพื่อเทียบเป็นคำนำหน้าของ URL โดย `http://127.0.0.1:8766.evil.example/` ไม่ตรง):
 * server ของ e2e เสมอ และเมื่อวัดประสิทธิภาพ (perfUrl = GNSS_E2E_PERF_URL ของ perf.spec.ts) เพิ่ม origin ของ URL นั้นตรงตัว ไม่กว้างกว่านั้น
 * perfUrl ที่ไม่ใช่ URL แบบ http(s) ถูกข้าม (page.goto ของ perf.spec.ts ล้มเองอยู่แล้ว)
 */
export function allowedOrigins(perfUrl: string | undefined): string[] {
  const origins = [`${E2E_ORIGIN}/`];
  if (perfUrl === undefined || perfUrl === "") return origins;
  try {
    const url = new URL(perfUrl);
    if (url.protocol === "http:" || url.protocol === "https:") origins.push(`${url.origin}/`);
  } catch {
    // ไม่ใช่ URL
  }
  return origins;
}

/** URL ที่หน้าเว็บขอได้: origin ใน `origins`, data: และ blob: เท่านั้น (ห้ามต่อเน็ตนอกเครื่อง: งาน Sensor P5) */
export function isLocalRequest(url: string, origins: readonly string[]): boolean {
  return origins.some((origin) => url.startsWith(origin)) || url.startsWith("data:") || url.startsWith("blob:");
}
