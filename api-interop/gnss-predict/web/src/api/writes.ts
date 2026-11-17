// การเขียนจากหน้าต่างที่แก้ scenario (Object Browser, Properties Browser): ข้อผิดพลาดของ store (PATCH, PUT, insert, rename, DELETE, groups)
// โยนต่อมาที่ผู้เรียก ที่นี่แปลงเป็นข้อความใน Message Viewer
// - 412 ไม่แจ้งซ้ำ: มีกล่อง Reload / Cancel ขึ้นเอง (store ตั้ง conflict หรือหน้าต่างที่เขียนเป็นเจ้าของกล่อง)
// - 409 (ชื่อซ้ำ) และ 422 (ค่าไม่ผ่าน) ของกล่องที่มีช่องกรอก แสดงที่ช่องนั้น (isFieldError) ไม่ลง Message Viewer

import { ApiError, errorText } from "./client";
import { report } from "../stores/messages";

export const isConflict = (e: unknown): boolean => e instanceof ApiError && e.status === 412;

/** server ปฏิเสธค่าที่กรอก (ชื่อซ้ำหรือไม่ผ่านกติกา): ข้อความของ server แสดงที่ช่อง */
export const isFieldError = (e: unknown): e is ApiError => e instanceof ApiError && (e.status === 409 || e.status === 422);

/** ใส่ข้อผิดพลาดของการเขียนใน Message Viewer (ยกเว้น 412) object = path ของ object ที่เกี่ยวข้อง */
export function reportWriteError(e: unknown, object: string | null = null): void {
  if (isConflict(e)) return;
  report("error", e instanceof ApiError ? e.code : "WRITE_FAILED", errorText(e), object);
}

export type Attempt<T> = { ok: true; value: T } | { ok: false };

/** ทำการเขียนหนึ่งอย่าง: สำเร็จ = ค่าที่ได้, ล้มเหลว = แจ้งแล้วคืน { ok: false } (ผู้เรียกหยุดงานที่ต่อกัน) */
export async function attempt<T>(write: () => Promise<T>, object: string | null = null): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (e) {
    reportWriteError(e, object);
    return { ok: false };
  }
}
