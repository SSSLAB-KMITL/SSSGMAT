// เมนูบน (spec §5.1): File, Edit, View, Insert, Analysis, <ชนิดของ object ที่เลือก>, Utilities, Window, Help
// Radix Menubar: เปิดเมนูด้วยคีย์บอร์ดได้ (Enter / Space / ลูกศรลง บนหัวเมนู, ลูกศรซ้ายขวาข้ามเมนู, Esc ปิด)
// รายการมาจากข้อมูลใน menus.ts และเลือกแล้วเรียกคำสั่งผ่านทะเบียนเท่านั้น

import * as Menubar from "@radix-ui/react-menubar";
import { t, type LabelKey } from "../labels/labels";
import { useSelection } from "../stores/selection";
import { useCommands } from "./hooks";
import { MENUBAR_KIT, MenuEntries } from "./menuItems";
import {
  ANALYSIS_MENU, EDIT_MENU, FILE_MENU, HELP_MENU, INSERT_MENU, UTILITIES_MENU, VIEW_MENU, WINDOW_MENU, objectClassLabel, objectClassOf, objectMenuFor,
  type MenuEntry,
} from "./menus";
import { TipProvider } from "./Tip";

export function MenuBar() {
  useCommands(); // สถานะ enabled และรายการ optional ตามทะเบียนคำสั่ง
  const activePath = useSelection((s) => s.activePath);
  const menus: { id: string; label: LabelKey; entries: readonly MenuEntry[] }[] = [
    { id: "file", label: "menu.file", entries: FILE_MENU },
    { id: "edit", label: "menu.edit", entries: EDIT_MENU },
    { id: "view", label: "menu.view", entries: VIEW_MENU },
    { id: "insert", label: "menu.insert", entries: INSERT_MENU },
    { id: "analysis", label: "menu.analysis", entries: ANALYSIS_MENU },
    { id: "object", label: objectClassLabel(activePath), entries: objectMenuFor(objectClassOf(activePath)) },
    { id: "utilities", label: "menu.utilities", entries: UTILITIES_MENU },
    { id: "window", label: "menu.window", entries: WINDOW_MENU },
    { id: "help", label: "menu.help", entries: HELP_MENU },
  ];
  return (
    <TipProvider>
      <Menubar.Root className="menubar">
        {menus.map((m) => (
          <Menubar.Menu key={m.id} value={m.id}>
            <Menubar.Trigger className="menubar-trigger">{t(m.label)}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="menu-content" align="start" sideOffset={0} loop>
                <MenuEntries entries={m.entries} kit={MENUBAR_KIT} />
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>
    </TipProvider>
  );
}
