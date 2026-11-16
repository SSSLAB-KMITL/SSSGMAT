// คำสั่งเปิด Report & Graph Manager (spec §5): Analysis → Report & Graph Manager..., ปุ่มบนแถบเครื่องมือ (analysis.reportGraphManager)
// และ Report & Graph Manager... ของเมนูตามชนิด object / คลิกขวา (object.reportGraphManager) ลงทะเบียนระดับแอปครั้งเดียว (App.tsx)
//
// - analysis.reportGraphManager: ใช้ได้เมื่อมี scenario และพื้นที่ทำงาน mount แล้ว เปิดโดยไม่เปลี่ยน Object Type ของบานที่เปิดอยู่
// - object.reportGraphManager: object ที่เลือกเป็น Facility / Satellite / Constellation ที่มีอยู่ใน doc = Object Type ตามชนิดนั้นและเลือก object นั้นไว้
// - openReportGraphManager ใช้ร่วมกับปุ่มใน Access tool (Object Type = Access และ access ที่ติ๊กอยู่)
// - การเปลี่ยนแปลงของ My Styles (Copy / Delete / OK ของหน้าต่างแก้ style) แจ้งผ่าน useStyleRevision ให้ Manager อ่านรายการใหม่

import { create } from "zustand";
import { COMMAND_LABELS, invalidateCommands, registerCommand } from "../../commands";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";

export const RGM_KIND = "reportGraphManager";
export const STYLE_EDITOR_KIND = "styleEditor";

/** ชนิดใน Object Type ("All" = All Types) */
export type RgmObjectType = "All" | "Access" | "Facility" | "Satellite" | "Constellation";
export const RGM_OBJECT_TYPES: readonly RgmObjectType[] = ["All", "Access", "Facility", "Satellite", "Constellation"];

export interface RgmParams {
  objectType?: RgmObjectType;
  objects?: string[];
}

/** เปิด (หรือเรียกขึ้นมา) Report & Graph Manager params ว่าง = คง Object Type และ object ที่เลือกของบานที่เปิดอยู่ */
export function openReportGraphManager(params: RgmParams = {}): void {
  useLayout.getState().openPanel(RGM_KIND, params as Record<string, unknown>);
}

/** ตัวนับการเปลี่ยนแปลงของ My Styles: เพิ่มเมื่อบันทึก/ลบ ให้ Manager อ่าน GET /styles ใหม่ */
export const useStyleRevision = create<{ revision: number; bump(): void }>()((set) => ({
  revision: 0,
  bump: () => set((s) => ({ revision: s.revision + 1 })),
}));

const CLASSES = ["Facility", "Satellite", "Constellation"] as const;

/** object ที่เลือกเป็น Facility / Satellite / Constellation ที่มีอยู่ใน doc: [ชนิด, path] ไม่งั้น null */
function selectedObject(): [RgmObjectType, string] | null {
  const path = useSelection.getState().activePath;
  const doc = useScenario.getState().doc;
  if (path === null || doc === null) return null;
  const obj = doc.objects.find((o) => `*/${o.class}/${o.name}` === path);
  const cls = CLASSES.find((c) => c === obj?.class);
  return cls === undefined ? null : [cls, path];
}

const ready = (): boolean => useScenario.getState().name !== null && useLayout.getState().api !== null;

export function registerReportGraphManagerCommands(): () => void {
  const noScenario = (): string | undefined => (useScenario.getState().name === null ? msg("tooltip.noScenario") : undefined);
  const disposers = [
    registerCommand("analysis.reportGraphManager", {
      label: COMMAND_LABELS["analysis.reportGraphManager"],
      run: () => openReportGraphManager(),
      enabled: ready,
      tooltip: noScenario,
    }),
    registerCommand("object.reportGraphManager", {
      label: COMMAND_LABELS["object.reportGraphManager"],
      run: () => {
        const sel = selectedObject();
        if (sel !== null) openReportGraphManager({ objectType: sel[0], objects: [sel[1]] });
      },
      enabled: () => ready() && selectedObject() !== null,
      tooltip: () => noScenario() ?? (selectedObject() === null ? msg("rgm.forObject") : undefined),
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
