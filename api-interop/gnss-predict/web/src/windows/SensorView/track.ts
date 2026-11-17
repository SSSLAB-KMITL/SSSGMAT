// Sensor View ตาม sensor ใน scenario ที่เปิดอยู่ (sensor spec §5.4: "เปลี่ยนตาม Rename, sensor หรือดาวถูกลบ → หน้าต่างปิด") เริ่มครั้งเดียวใน App.tsx
//
// - doc ของ scenario เดิมเปลี่ยน (โหลดใหม่หลังเขียนหรือจาก event): ตรวจทุกหน้าต่างของ scenario นี้
//   sensor ยังอยู่ = ตั้งชื่อหน้าต่างใหม่ (ดาวแม่อาจเปลี่ยนชื่อ: server แก้ parent ให้), ถูก Rename = ย้าย params.path ไปชื่อใหม่,
//   ไม่อยู่แล้ว (ลบ sensor หรือลบดาวแม่ซึ่ง server ลบ sensor ของมันด้วย) = ปิดพร้อมข้อความ sensorView.closedMissing (info)
// - Rename: store โหลด doc ใหม่เสร็จก่อน rename() คืนค่า แล้ว RenameDialog จึงเรียก onRenamed (→ sensorViewRenamed) doc ใหม่จึงมาก่อนเสมอ
//   ตอนนั้นจึงต้องรู้เองว่าเป็น Rename: server เปลี่ยนชื่อ object ที่ตำแหน่งเดิมใน objects (objects.rename) ตำแหน่งเดิมจึงเป็น Sensor ชื่อใหม่
//   ที่ไม่เคยมีใน doc ก่อนหน้า และจำนวน object เท่าเดิม (Rename จากแท็บอื่นผ่าน event ก็ตามได้) sensorViewRenamed ยังย้ายให้ถ้ามาก่อน doc
//   (โหลด doc ใหม่ไม่สำเร็จ) ไม่มีหน้าต่างของชื่อเดิมแล้ว = ไม่ทำอะไร
// - หน้าต่างที่เพิ่งเปิด (คำสั่ง Sensor View หรือ workbook ของ scenario ที่เพิ่งเปิด) ตรวจครั้งเดียวตอนเห็นครั้งแรก:
//   sensor ไม่อยู่ใน scenario (workbook เก่า) = ปิดพร้อมข้อความเดียวกัน (warning: ไฟล์ไม่ตรงกับ scenario)
//   ตรวจหลัง dockview ทำงานที่กำลังทำจบ (microtask): ห้ามปิด panel ระหว่าง fromJSON ของ workbook
// - แต่ละหน้าต่างเป็นของ scenario ที่เปิดอยู่ตอนเห็นครั้งแรก: เปิด scenario อื่น (ชื่อเปลี่ยน) แล้ว หน้าต่างเดิมรอ workbook ของ scenario ใหม่
//   มาแทน (restoreFor) ไม่ถูกตรวจกับ doc ของ scenario ใหม่ (ไม่งั้นทุกบานถูกปิดพร้อมข้อความผิด ๆ); ปิด scenario = afterScenarioClosed ปิดเอง

import type { IDockviewPanel } from "dockview-react";
import { objectPath } from "../../cesium/colors";
import { getPanelDef } from "../../layout/panels";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { report, type MessageLevel } from "../../stores/messages";
import { useScenario, type ScenarioDoc } from "../../stores/scenario";
import { SENSOR_VIEW_KIND, sensorViewPanels, sensorViewParams } from "./registry";

/** scenario ที่หน้าต่างเป็นของ (ชื่อ ณ ตอนที่เห็นหน้าต่างครั้งแรก) ตาม panel ของ dockview (workbook ใหม่ = panel ตัวใหม่) */
const owners = new WeakMap<IDockviewPanel, string>();

const isSensorAt = (doc: ScenarioDoc, path: string): boolean => doc.objects.some((o) => o.class === "Sensor" && objectPath(o) === path);

/** path ใหม่ของ sensor ที่ path ถ้าการเปลี่ยนจาก before เป็น after คือการ Rename ของมัน (ตำแหน่งเดิม ชื่อใหม่) ไม่ใช่ = null */
function renamedTo(before: ScenarioDoc, after: ScenarioDoc, path: string): string | null {
  if (before.objects.length !== after.objects.length) return null;
  const i = before.objects.findIndex((o) => o.class === "Sensor" && objectPath(o) === path);
  const now = i < 0 ? undefined : after.objects[i];
  if (now === undefined || now.class !== "Sensor") return null;
  const next = objectPath(now);
  return before.objects.some((o) => objectPath(o) === next) ? null : next;
}

/** ชื่อหน้าต่างตาม params และ doc ปัจจุบัน (ชื่อดาวแม่) */
function retitle(panel: IDockviewPanel): void {
  const title = getPanelDef(SENSOR_VIEW_KIND)?.title(panel.params);
  if (title !== undefined && panel.title !== title) panel.api.setTitle(title);
}

function closeMissing(panel: IDockviewPanel, path: string, level: MessageLevel): void {
  useLayout.getState().closePanel(panel.id);
  report(level, "SENSOR_VIEW_CLOSED", msg("sensorView.closedMissing", { sensor: path.split("/").at(-1) ?? path }), path);
}

/** doc ของ scenario ที่เปิดอยู่เปลี่ยนจาก before: ตรวจทุกหน้าต่างของ scenario นี้ */
function followDoc(before: ScenarioDoc | null): void {
  const { name, doc } = useScenario.getState();
  if (name === null || doc === null) return;
  for (const panel of sensorViewPanels()) {
    if (owners.get(panel) !== name) continue; // ของ scenario ก่อนหน้า หรือยังไม่เคยเห็น (adoptNew ตรวจเอง)
    const { path } = sensorViewParams(panel.params);
    if (isSensorAt(doc, path)) {
      retitle(panel);
      continue;
    }
    const renamed = before === null ? null : renamedTo(before, doc, path);
    if (renamed !== null) panel.api.updateParameters({ path: renamed }); // ชื่อหน้าต่างตาม params เอง (stores/layout.ts)
    else closeMissing(panel, path, "info");
  }
}

/** หน้าต่างที่ยังไม่เคยเห็น: เป็นของ scenario ที่เปิดอยู่ แล้วตรวจว่ามี sensor ของมัน */
function adoptNew(): void {
  const { name, doc } = useScenario.getState();
  if (name === null || doc === null) return;
  for (const panel of sensorViewPanels()) {
    if (owners.has(panel)) continue;
    owners.set(panel, name);
    const { path } = sensorViewParams(panel.params);
    if (isSensorAt(doc, path)) retitle(panel);
    else closeMissing(panel, path, "warning");
  }
}

/**
 * Rename ของ sensor ที่ RenameDialog ทำสำเร็จแล้ว (onRenamed ของ Object Browser): หน้าต่างของชื่อเดิมย้ายไปชื่อใหม่
 * doc ใหม่มาถึงก่อนแล้ว (followDoc ย้ายไปแล้ว) = ไม่มีหน้าต่างของชื่อเดิม ไม่ทำอะไร
 */
export function sensorViewRenamed(oldPath: string, newPath: string): void {
  for (const panel of sensorViewPanels()) {
    if (sensorViewParams(panel.params).path === oldPath) panel.api.updateParameters({ path: newPath });
  }
}

/** เริ่มตาม scenario และหน้าต่าง คืนฟังก์ชันหยุด */
export function startSensorViewTracking(): () => void {
  let pending = false;
  let stopped = false;
  const scheduleAdopt = (): void => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!stopped) adoptNew();
    });
  };
  const offScenario = useScenario.subscribe((s, prev) => {
    // เปิด ปิด หรือสลับ scenario: restoreFor / afterScenarioClosed จัดหน้าต่างเอง หน้าต่างของ workbook ใหม่ถูกตรวจใน adoptNew
    if (s.name === null || s.name !== prev.name || s.doc === prev.doc) return;
    // หน้าต่างที่เพิ่งเปิดและยังรอ adoptNew (microtask) เปิดภายใต้ scenario นี้: นับเป็นของมันก่อน แล้วตรวจพร้อมบานอื่นกับ doc ใหม่
    for (const panel of sensorViewPanels()) if (!owners.has(panel)) owners.set(panel, s.name);
    followDoc(prev.doc);
  });
  const offLayout = useLayout.subscribe((s, prev) => {
    if (s.api !== prev.api || s.revision !== prev.revision) scheduleAdopt();
  });
  scheduleAdopt();
  return () => {
    stopped = true;
    offScenario();
    offLayout();
  };
}
