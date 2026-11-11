// คำอธิบายเมื่อชี้หรือโฟกัส (Radix Tooltip) ใช้ร่วมกันในเมนู แถบเครื่องมือ และแถบสถานะ

import * as Tooltip from "@radix-ui/react-tooltip";
import { useState, type ReactElement, type ReactNode } from "react";

/** ครอบส่วนที่ใช้ Tip: หน่วงสั้น ๆ ก่อนแสดง และชี้ปุ่มถัดไปได้ทันที */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={150}>
      {children}
    </Tooltip.Provider>
  );
}

export interface TipProps {
  /** ไม่มี (undefined หรือ "") = ไม่แสดงอะไร โดยไม่ทำให้ element ข้างในถูกสร้างใหม่ */
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** element เดียวที่รับ ref และ event ได้ (ปุ่ม รายการเมนู ช่องกรอก) */
  children: ReactElement;
}

export function Tip({ content, side = "bottom", children }: TipProps) {
  const [open, setOpen] = useState(false);
  const has = content !== undefined && content !== null && content !== "" && content !== false;
  return (
    <Tooltip.Root open={open && has} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={4}>
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
