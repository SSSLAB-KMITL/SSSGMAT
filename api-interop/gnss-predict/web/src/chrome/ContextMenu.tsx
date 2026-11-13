// เมนูคลิกขวาจากข้อมูลชุดเดียวกับเมนูบาร์ (W3): ใช้กับ Object Browser (objectMenuFor ของ menus.ts) และหน้าต่างอื่นที่ต้องการ
// เลือกรายการ = runCommand; รายการที่ปิดใช้แสดงเหตุผลแบบเดียวกับเมนูบาร์

import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactElement } from "react";
import { useCommands } from "./hooks";
import { CONTEXT_MENU_KIT, MenuEntries } from "./menuItems";
import type { MenuEntry } from "./menus";
import { TipProvider } from "./Tip";

export interface CommandContextMenuProps {
  /** ไม่มีรายการ = ไม่วาดเมนู (กล่องว่างแย่กว่าไม่มีเมนู) */
  entries: readonly MenuEntry[];
  /** element เดียวที่คลิกขวาแล้วเปิดเมนู (รับ ref และ event ได้) */
  children: ReactElement;
  /** เรียกเมื่อเมนูเปิดหรือปิด (เปิด = ผู้ใช้คลิกขวาที่ตัวนี้) */
  onOpenChange?: (open: boolean) => void;
}

export function CommandContextMenu({ entries, children, onOpenChange }: CommandContextMenuProps) {
  useCommands();
  return (
    <TipProvider>
      <ContextMenu.Root onOpenChange={onOpenChange}>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        {entries.length > 0 && (
          <ContextMenu.Portal>
            <ContextMenu.Content className="menu-content">
              <MenuEntries entries={entries} kit={CONTEXT_MENU_KIT} />
            </ContextMenu.Content>
          </ContextMenu.Portal>
        )}
      </ContextMenu.Root>
    </TipProvider>
  );
}
