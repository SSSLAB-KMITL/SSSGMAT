// ปุ่มบนแถบเครื่องมือ: ไอคอน Lucide + tooltip ชื่อจาก labels.ts เรียกคำสั่งผ่านทะเบียนเท่านั้น
// ปิดใช้ด้วย aria-disabled (ไม่ใช่ disabled) เพื่อให้ยังชี้/โฟกัสแล้วเห็นเหตุผลได้ งานที่ทำแถบเครื่องมือของหน้าต่าง 3D/2D ใช้ปุ่มนี้ด้วย

import type { LucideIcon } from "lucide-react";
import { commandTooltip, isEnabled, runCommand, type CommandId } from "../commands";
import { t, type LabelKey } from "../labels/labels";
import { useCommands } from "./hooks";
import { Tip } from "./Tip";

export interface ToolButtonProps {
  command: CommandId;
  /** ชื่อ (tooltip และชื่อที่อ่านออกเสียง) */
  label: LabelKey;
  icon: LucideIcon;
  /** ปุ่มแบบสลับ/เลือก: สถานะที่กดอยู่ (ไม่ระบุ = ไม่ใช่ปุ่มสลับ) */
  pressed?: boolean;
  /** กลับด้านไอคอนซ้ายขวา (Reverse = Start ที่กลับด้าน) */
  mirror?: boolean;
}

export function ToolButton({ command, label, icon: Icon, pressed, mirror = false }: ToolButtonProps) {
  useCommands();
  const enabled = isEnabled(command);
  const note = commandTooltip(command);
  const name = t(label);
  return (
    <Tip content={note === undefined ? name : `${name} — ${note}`}>
      <button
        type="button"
        className="tool-btn"
        aria-label={name}
        aria-disabled={enabled ? undefined : true}
        aria-pressed={pressed}
        onClick={() => runCommand(command)}
      >
        <Icon size={16} aria-hidden="true" className={mirror ? "icon-mirror" : undefined} />
      </button>
    </Tip>
  );
}
