// สถานะของชั้น Cesium ion ที่ใช้ร่วมกัน (spec ภาพละเอียด §4.2): ion "shown" = สวิตช์ ion เปิด + globe.ion.assetId ไม่ใช่ null + token ไม่ว่าง และ ion ยังไม่ปฏิเสธ asset + token นี้
// แยกจาก imageryLayers.ts เพราะไฟล์นั้น import "cesium" (แยก chunk ไว้ให้หน้าต่าง 3D โหลดแบบ dynamic import) ส่วนไฟล์นี้ไม่แตะ Cesium:
// Globe Manager (อยู่ใน bundle หลัก) อ่านสถานะนี้เพื่อบอกว่าชั้นอื่นถูกซ่อนอยู่ โดยไม่ลาก Cesium เข้ามา
// imageryLayers.ts เป็นผู้บันทึกการปฏิเสธ (setIonFailure + notifyIonListeners) และ re-export ionStatus / onIonStatusChange เพื่อให้ผู้เรียกเดิมใช้ต่อได้

import { useImagery } from "../stores/imagery";
import { useLayout } from "../stores/layout";
import { useSettings } from "../stores/settings";

export type IonPlan =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "noToken"; assetId: number }
  | { kind: "failed"; assetId: number }
  | { kind: "shown"; assetId: number; token: string };

/** สถานะของ ion สำหรับหน้าต่างอื่น (Globe Manager) ไม่มี token */
export type IonStatus =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "noToken" | "failed" | "shown"; assetId: number };

/** asset + token ที่ ion ปฏิเสธไปแล้ว (ไม่ลองซ้ำ) ลืมเมื่อเลิกขอ ion */
let ionFailure: { assetId: number; token: string } | null = null;
/** ตัวฟังการเปลี่ยนสถานะของ ion ที่ไม่ได้มาจาก store (ion ปฏิเสธ): ทุก viewer และหน้าต่างที่ต้องวาดใหม่ */
const ionListeners = new Set<() => void>();

export const getIonFailure = (): Readonly<{ assetId: number; token: string }> | null => ionFailure;

export function setIonFailure(failure: { assetId: number; token: string } | null): void {
  ionFailure = failure;
}

/** บอกผู้ฟังทั้งหมดว่าสถานะของ ion เปลี่ยน (หลัง setIonFailure) */
export function notifyIonListeners(): void {
  for (const listener of [...ionListeners]) listener();
}

export function ionPlan(): IonPlan {
  const assetId = useLayout.getState().globe.ion?.assetId ?? null;
  if (!useImagery.getState().sources.ion || assetId === null) return { kind: "off" };
  const settings = useSettings.getState().settings;
  if (settings === null) return { kind: "waiting" };
  const token = settings.cesium_ion_token.trim();
  if (token === "") return { kind: "noToken", assetId };
  if (ionFailure !== null && ionFailure.assetId === assetId && ionFailure.token === token) return { kind: "failed", assetId };
  return { kind: "shown", assetId, token };
}

/** สถานะของ Cesium ion ตอนนี้ (shown = ชั้นอื่นทั้งหมดถูกซ่อนในทุก viewer) */
export function ionStatus(): IonStatus {
  const plan = ionPlan();
  return plan.kind === "off" || plan.kind === "waiting" ? plan : { kind: plan.kind, assetId: plan.assetId };
}

/** ฟังการเปลี่ยนของ ionStatus ที่ไม่ได้มาจาก store (ion ปฏิเสธ asset/token) คืนฟังก์ชันเลิกฟัง */
export function onIonStatusChange(listener: () => void): () => void {
  ionListeners.add(listener);
  return () => void ionListeners.delete(listener);
}
