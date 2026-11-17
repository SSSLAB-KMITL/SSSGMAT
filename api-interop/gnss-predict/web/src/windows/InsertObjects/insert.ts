// การสร้าง object ผ่าน POST /objects ที่ Insert STK Objects และ Search Satellite Catalog ใช้ร่วมกัน
// เขียนผ่าน useScenario.insert (เข้าคิวเขียนของ store: ส่ง If-Match ด้วย ETag ล่าสุดตามตัว) แล้วเลือก object แรกที่สร้างเป็น active object

import { useScenario, type InsertBody, type ScenarioDoc } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";

export type InsertClass = "Facility" | "Satellite" | "Sensor" | "Constellation";

/** path ของดาวทั้งหมดใน doc ตามลำดับใน objects (Sensor ต้องมีดาวแม่ที่นี่; Select Object ใช้เป็นรายการให้เลือก) ไม่มี scenario = ว่าง */
export function satellitePaths(doc: ScenarioDoc | null): string[] {
  return (doc?.objects ?? []).filter((o) => o.class === "Satellite").map((o) => `*/Satellite/${o.name}`);
}

/**
 * สร้าง object ตาม body คืน path ที่สร้างตามลำดับที่ server ส่ง (ดาวก่อน Constellation) ที่ล้มเหลวโยนตามเดิม (ApiError)
 * เลือก (useSelection) object แรกก็ต่อเมื่อ scenario ที่สั่งยังเป็นตัวที่เปิดอยู่ (ปิดหรือสลับไปแล้วระหว่างรอ = path นั้นไม่ใช่ของ scenario ที่เปิดแล้ว)
 */
export async function insertObjects(body: InsertBody): Promise<string[]> {
  const scenario = useScenario.getState().name;
  const created = await useScenario.getState().insert(body);
  if (created[0] !== undefined && useScenario.getState().name === scenario) useSelection.getState().select(created[0]);
  return created;
}
