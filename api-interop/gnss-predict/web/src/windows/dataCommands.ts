// คำสั่งเมนู Insert และ Utilities ของงานที่ 10 (W3): insert.new/facility/satellite/sensor/constellation, utilities.fetchOrbitData, utilities.dailyForecastSettings
// ลงทะเบียนครั้งเดียวตอนแอปเริ่ม (เหมือน registerCoreCommands / registerFileCommands) คืนฟังก์ชันถอน
//
// - insert.* เปิด Insert STK Objects พร้อม params { cls, seq } (cls = object ที่เลือกให้ New... = null; seq ใหม่ทุกครั้งเพื่อให้หน้าต่างที่เปิดค้างอยู่ย้ายตาม)
//   ใช้ได้เมื่อมี scenario เปิดอยู่และพื้นที่ทำงาน (dockview) mount แล้ว
// - utilities.* เปิดหน้าต่างของมัน ไม่ต้องมี scenario (ข้อมูลวงโคจรและงานประจำวันเป็นของ server ไม่ใช่ของ scenario) การเปิดหน้าต่างไม่ดึงข้อมูลจากเน็ต:
//   การดึงเกิดจากปุ่ม Fetch Now / Run Now ในหน้าต่าง ที่ถามยืนยันก่อนทุกครั้ง

import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../commands";
import { msg } from "../labels/messages.th";
import { useLayout } from "../stores/layout";
import { useScenario } from "../stores/scenario";
import type { InsertClass } from "./InsertObjects/insert";

const layout = () => useLayout.getState();
const workspaceMounted = (): boolean => layout().api !== null;
const scenarioOpen = (): boolean => useScenario.getState().name !== null;
const noScenarioNote = (): string | undefined => (scenarioOpen() ? undefined : msg("tooltip.noScenario"));

let insertSeq = 0;

export function registerDataCommands(): () => void {
  const disposers: (() => void)[] = [];
  const add = (id: CommandId, def: Omit<CommandDef, "label">): void => {
    disposers.push(registerCommand(id, { label: COMMAND_LABELS[id], ...def }));
  };
  const insert = (id: CommandId, cls: InsertClass | null): void =>
    add(id, {
      run: () => void layout().openPanel("insertObjects", { cls, seq: ++insertSeq }),
      enabled: () => scenarioOpen() && workspaceMounted(),
      tooltip: noScenarioNote,
    });
  const openWindow = (id: CommandId, kind: "fetchOrbitData" | "dailyForecastSettings"): void =>
    add(id, { run: () => void layout().openPanel(kind), enabled: workspaceMounted });

  insert("insert.new", null);
  insert("insert.facility", "Facility");
  insert("insert.satellite", "Satellite");
  insert("insert.sensor", "Sensor");
  insert("insert.constellation", "Constellation");
  openWindow("utilities.fetchOrbitData", "fetchOrbitData");
  openWindow("utilities.dailyForecastSettings", "dailyForecastSettings");

  // enabled()/tooltip() ขึ้นกับ store สองตัวนี้: เมื่อสถานะที่อ่านเปลี่ยน ให้เมนูและแถบเครื่องมือวาดใหม่
  const unsubscribe = [
    useLayout.subscribe((s, prev) => {
      if (s.api !== prev.api) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      if ((s.name === null) !== (prev.name === null)) invalidateCommands();
    }),
  ];

  return () => {
    for (const off of unsubscribe) off();
    for (const dispose of disposers) dispose();
  };
}
