// ข้อผิดพลาดที่ error boundary ของแอปจับได้ (src/chrome/ErrorBoundary.tsx ส่งต่อให้ window.reportError) ระหว่าง unit test
// setup.ts ติดตั้ง window.reportError ตัวนี้และตรวจหลังทุก test: มีข้อผิดพลาดเหลือ = test นั้นล้มเหลว
// (ไม่งั้นหน้าต่างหรือแถบที่พังตอนวางจะผ่าน test ที่ render <Workspace/> หรือ <App/> ไปเงียบ ๆ เพราะ boundary แสดงข้อความแทน)
// test ที่ตั้งใจทำให้พังเรียก takeReportedErrors() เพื่อเอาไปตรวจเอง

const reported: unknown[] = [];

/** ตัวแทน window.reportError: จำไว้ ไม่โยน (boundary แสดงข้อความแทนแล้ว) */
export function recordReportedError(error: unknown): void {
  reported.push(error);
}

/** เอาข้อผิดพลาดที่ส่งต่อมาทั้งหมดออก (test ที่ตั้งใจทำให้พังใช้ตรวจ) */
export function takeReportedErrors(): unknown[] {
  return reported.splice(0);
}

const describe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** มีข้อผิดพลาดที่ไม่มี test ใดเอาไปตรวจ = โยน (setup.ts เรียกหลังทุก test) แล้วล้างให้ test ถัดไป */
export function failOnReportedErrors(): void {
  const left = takeReportedErrors();
  if (left.length > 0) {
    throw new Error(`an error boundary caught ${left.length} render error(s) that no test expected: ${left.map(describe).join(" | ")}`);
  }
}
