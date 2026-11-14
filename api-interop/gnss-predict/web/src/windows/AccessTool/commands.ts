// คำสั่งเปิด Access tool (spec §4): Analysis → Access..., ปุ่ม Access บนแถบ Default (analysis.access) และ Access... ของเมนูตามชนิด object
// / คลิกขวา (object.access) ลงทะเบียนระดับแอปครั้งเดียว (App.tsx)
//
// - analysis.access: ใช้ได้เมื่อมี scenario และพื้นที่ทำงาน mount แล้ว object ที่เลือกเป็น Facility/Satellite = Access For ของหน้าต่าง
//   ไม่ใช่ = เปิด (หรือเรียกขึ้นมา) โดยไม่เปลี่ยน Access For ของหน้าต่างที่เปิดอยู่
// - object.access: ใช้ได้เฉพาะเมื่อ object ที่เลือกเป็น Facility หรือ Satellite ที่มีอยู่ใน doc (ไม่ใช่ = บอกเหตุเป็นภาษาไทย)
// - enabled() อ่าน selection, scenario และพื้นที่ทำงาน: ฟังทั้งสามแล้ว invalidateCommands ให้เมนูและแถบเครื่องมือวาดใหม่

import { COMMAND_LABELS, invalidateCommands, registerCommand } from "../../commands";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { accessForClass } from "./state";

export const ACCESS_TOOL_KIND = "accessTool";

/** object ที่เลือกเป็น Facility หรือ Satellite ที่มีอยู่ใน doc (path ของมัน) ไม่งั้น null */
function selectedAccessFor(): string | null {
  const path = useSelection.getState().activePath;
  return accessForClass(useScenario.getState().doc, path) === null ? null : path;
}

const ready = (): boolean => useScenario.getState().name !== null && useLayout.getState().api !== null;

/** เปิด Access tool (from = Access For ใหม่, null = คง Access For ของหน้าต่างที่เปิดอยู่) */
export function openAccessTool(from: string | null): void {
  useLayout.getState().openPanel(ACCESS_TOOL_KIND, from === null ? {} : { from });
}

export function registerAccessCommands(): () => void {
  const noScenario = (): string | undefined => (useScenario.getState().name === null ? msg("tooltip.noScenario") : undefined);
  const disposers = [
    registerCommand("analysis.access", {
      label: COMMAND_LABELS["analysis.access"],
      run: () => openAccessTool(selectedAccessFor()),
      enabled: ready,
      tooltip: noScenario,
    }),
    registerCommand("object.access", {
      label: COMMAND_LABELS["object.access"],
      run: () => {
        const from = selectedAccessFor();
        if (from !== null) openAccessTool(from);
      },
      enabled: () => ready() && selectedAccessFor() !== null,
      tooltip: () => noScenario() ?? (selectedAccessFor() === null ? msg("access.forFacilityOrSatellite") : undefined),
    }),
  ];
  const unsubscribe = [
    useSelection.subscribe((s, prev) => {
      if (s.activePath !== prev.activePath) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      if (s.name !== prev.name || s.doc !== prev.doc) invalidateCommands();
    }),
    useLayout.subscribe((s, prev) => {
      if (s.api !== prev.api) invalidateCommands();
    }),
  ];
  return () => {
    for (const off of unsubscribe) off();
    for (const dispose of disposers) dispose();
  };
}
