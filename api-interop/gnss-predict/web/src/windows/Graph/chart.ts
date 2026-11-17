// ตัวโหลด ECharts ที่เดียวของแอป (Global Constraints): echarts (กับ zrender) อยู่ใน chunk "echarts" ของตัวเอง (vite.config.ts)
// และโหลดเมื่อหน้าต่างกราฟ/Validation เปิดครั้งแรกเท่านั้น ห้าม import "echarts" แบบ static ที่ใดในแอป (echarts-chunk.test.ts ตรวจ)
// ผลที่โหลดสำเร็จเก็บไว้ใช้ซ้ำ โหลดล้ม (เช่น chunk หายหลัง deploy ใหม่) ล้างที่เก็บไว้ เพื่อให้ Refresh ลองใหม่ได้

export type ECharts = typeof import("echarts");

let loading: Promise<ECharts> | null = null;

export function loadECharts(): Promise<ECharts> {
  if (loading === null) {
    const attempt = import("echarts");
    loading = attempt;
    attempt.catch(() => {
      if (loading === attempt) loading = null;
    });
  }
  return loading;
}
