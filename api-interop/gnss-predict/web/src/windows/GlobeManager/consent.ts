// เปิดแหล่งภาพออนไลน์หลังถามยืนยัน (ข2 Ruling f): ขั้นเดียวกันของสวิตช์ใน Globe Manager และของ Show Imagery กล่องและผลจึงเหมือนกันทุกตัวอักษร
// - แหล่งเปิดอยู่แล้ว = true ไม่ถาม ไม่ส่งอะไร
// - ถามด้วยข้อความของแหล่งนั้น (CONSENT_KEYS) ยกเลิกหรือ Esc = false ไม่มีคำขอ ไม่แตะ globe ของ workbook
// - ตกลง = useImagery.setSource (GET แล้ว PUT /api/settings ทั้งเอกสาร) บันทึกไม่สำเร็จ = false (store รายงานคำเตือนไทยเอง)
// - บันทึกสำเร็จ: ion ที่ยังไม่มี asset = เลือก preset แรก (ไม่มี asset = ion ไม่แสดง) ; OSM = ติ๊ก Show ของแถว (task 13c: แถวเริ่มแบบซ่อน
//   เปิดสวิตช์แล้วต้องเห็นแผนที่ทันที % Translucency คงเดิม)
// ไฟล์นี้ไม่ import Cesium (Globe Manager และคำสั่งอยู่ใน bundle หลัก)

import { ION_PRESETS } from "../../cesium/ionAssets";
import { confirm } from "../../chrome/Dialogs";
import { msg, type MsgKey } from "../../labels/messages.th";
import { useImagery, type ImagerySourceId } from "../../stores/imagery";
import { useLayout } from "../../stores/layout";

/** ข้อความขอความยินยอมของแต่ละแหล่ง (บอก host สิ่งที่ส่งออก และใครเป็นผู้ติดต่อ) */
export const CONSENT_KEYS: Readonly<Record<ImagerySourceId, MsgKey>> = Object.freeze({
  gibs: "globe.consent", eox: "globe.consentEox", osm: "globe.consentOsm", ion: "globe.consentIon",
});

/** เปิดแหล่ง id หลังผู้ใช้ยืนยัน: true = แหล่งเปิดอยู่ (เดิมหรือเพิ่งบันทึกสำเร็จ), false = ยกเลิกหรือบันทึกไม่สำเร็จ */
export async function enableSourceWithConsent(id: ImagerySourceId): Promise<boolean> {
  if (useImagery.getState().sources[id]) return true;
  if (!(await confirm(msg(CONSENT_KEYS[id])))) return false;
  await useImagery.getState().setSource(id, true);
  if (!useImagery.getState().sources[id]) return false;
  const layout = useLayout.getState();
  if (id === "ion" && (layout.globe.ion?.assetId ?? null) === null) layout.setGlobeIon(ION_PRESETS[0].id);
  if (id === "osm") layout.setGlobeLayer("osm", { show: true });
  return true;
}
