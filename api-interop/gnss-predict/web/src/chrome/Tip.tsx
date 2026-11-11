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
  /**
   * ข้อความ (ไม่มี = undefined หรือ "" = ไม่แสดงอะไร โดยไม่ทำให้ element ข้างในถูกสร้างใหม่)
   * ส่งเป็นฟังก์ชันเมื่อข้อความขึ้นกับสถานะที่เปลี่ยนโดยปุ่มไม่ถูกวาดใหม่ (เช่นเวลา animation): คำนวณตอน tooltip เปิดและทุกครั้งที่วาด
   */
  content: ReactNode | (() => ReactNode);
  side?: "top" | "right" | "bottom" | "left";
  /** element เดียวที่รับ ref และ event ได้ (ปุ่ม รายการเมนู ช่องกรอก) */
  children: ReactElement;
}

const resolve = (content: TipProps["content"]): ReactNode => (typeof content === "function" ? content() : content);
const isBlank = (node: ReactNode): boolean => node === undefined || node === null || node === "" || node === false;

export function Tip({ content, side = "bottom", children }: TipProps) {
  const [open, setOpen] = useState(false);
  return (
    // เปิดได้เมื่อตอนนี้มีข้อความ (ถามตอนที่ผู้ใช้ชี้หรือโฟกัส ไม่ใช่ตอนวาดครั้งก่อน) และปิดเองถ้าข้อความหายไปขณะเปิดอยู่
    <Tooltip.Root open={open && !isBlank(resolve(content))} onOpenChange={(next) => setOpen(next && !isBlank(resolve(content)))}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={4}>
          {resolve(content)}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
