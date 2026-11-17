// คำสั่งเปิดหน้า Validation (spec §7): Analysis → Validation... (analysis.validation) ลงทะเบียนระดับแอปครั้งเดียว (App.tsx)
//
// - หน้านี้อ่านประวัติของทั้งเครื่อง (history.jsonl) ไม่ผูกกับ scenario จึงใช้ได้โดยไม่ต้องเปิด scenario: ใช้ได้เมื่อพื้นที่ทำงาน (dockview) mount แล้วเท่านั้น
// - เปิดซ้ำ = เรียกหน้าต่างเดิมขึ้นมา (หน้าต่างเดียว)

import { COMMAND_LABELS, invalidateCommands, registerCommand } from "../../commands";
import { useLayout } from "../../stores/layout";

export const VALIDATION_KIND = "validation";

const ready = (): boolean => useLayout.getState().api !== null;

export function registerValidationCommands(): () => void {
  const dispose = registerCommand("analysis.validation", {
    label: COMMAND_LABELS["analysis.validation"],
    run: () => void useLayout.getState().openPanel(VALIDATION_KIND, {}),
    enabled: ready,
  });
  const unsubscribe = useLayout.subscribe((s, prev) => {
    if (s.api !== prev.api) invalidateCommands();
  });
  return () => {
    unsubscribe();
    dispose();
  };
}
