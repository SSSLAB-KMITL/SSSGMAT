// วาดรายการเมนูจากข้อมูล (menus.ts) ให้เมนูบาร์ (Radix Menubar) และเมนูคลิกขวา (Radix ContextMenu) ใช้ร่วมกัน
// - รายการที่ปิดใช้มี aria-disabled (ไม่ใช้ disabled ของ Radix) เพื่อให้เลื่อนด้วยคีย์บอร์ดไปถึง และเห็นเหตุผลเป็น tooltip ภาษาไทย
// - เลือกรายการ = runCommand(id) เท่านั้น

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menubar from "@radix-ui/react-menubar";
import { Check, ChevronRight } from "lucide-react";
import { useMemo, type ComponentType } from "react";
import { commandText, commandTooltip, isCheckable, isChecked, isEnabled, isRegistered, runCommand, type CommandId } from "../commands";
import { t, type LabelKey } from "../labels/labels";
import { useLayout } from "../stores/layout";
import { SHORTCUT_LABELS, type MenuEntry } from "./menus";
import { Tip } from "./Tip";

/** ชุด component ของ Radix ที่ใช้วาดรายการ (Menubar กับ ContextMenu มีชื่อเหมือนกัน) */
type Part = ComponentType<any>;
export interface MenuKit {
  Item: Part;
  CheckboxItem: Part;
  ItemIndicator: Part;
  Separator: Part;
  Sub: Part;
  SubTrigger: Part;
  SubContent: Part;
  Portal: Part;
}

export const MENUBAR_KIT: MenuKit = {
  Item: Menubar.Item, CheckboxItem: Menubar.CheckboxItem, ItemIndicator: Menubar.ItemIndicator, Separator: Menubar.Separator,
  Sub: Menubar.Sub, SubTrigger: Menubar.SubTrigger, SubContent: Menubar.SubContent, Portal: Menubar.Portal,
};

export const CONTEXT_MENU_KIT: MenuKit = {
  Item: ContextMenu.Item, CheckboxItem: ContextMenu.CheckboxItem, ItemIndicator: ContextMenu.ItemIndicator, Separator: ContextMenu.Separator,
  Sub: ContextMenu.Sub, SubTrigger: ContextMenu.SubTrigger, SubContent: ContextMenu.SubContent, Portal: ContextMenu.Portal,
};

/** ตัดรายการ optional ที่คำสั่งยังไม่ลงทะเบียน แล้วยุบตัวคั่นที่ซ้อนกันหรือค้างหัวท้าย */
export function visibleEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if ("command" in e && e.optional === true && !isRegistered(e.command)) continue;
    if ("separator" in e && (out.length === 0 || "separator" in out[out.length - 1])) continue;
    out.push(e);
  }
  while (out.length > 0 && "separator" in out[out.length - 1]) out.pop();
  return out;
}

const SELECT_GUARD = (enabled: boolean, run: () => void) => (event: Event) => {
  if (!enabled) event.preventDefault(); // เลือกรายการที่ปิดใช้: ไม่ทำอะไรและไม่ปิดเมนู
  else run();
};

function CommandItem({ id, kit, label }: { id: CommandId; kit: MenuKit; label?: LabelKey }) {
  const enabled = isEnabled(id);
  const disabledProps = enabled ? {} : { "aria-disabled": true, "data-disabled": "" };
  const shortcut = SHORTCUT_LABELS[id];
  const body = (
    <>
      <span className="menu-label">{label === undefined ? commandText(id) : t(label)}</span>
      {shortcut !== undefined && <span className="menu-shortcut">{t(shortcut)}</span>}
    </>
  );
  const onSelect = SELECT_GUARD(enabled, () => runCommand(id));

  if (isCheckable(id)) {
    return (
      <Tip content={() => commandTooltip(id)} side="right">
        <kit.CheckboxItem className="menu-item" checked={isChecked(id)} onSelect={onSelect} {...disabledProps}>
          <kit.ItemIndicator className="menu-indicator">
            <Check size={12} aria-hidden="true" />
          </kit.ItemIndicator>
          {body}
        </kit.CheckboxItem>
      </Tip>
    );
  }
  return (
    <Tip content={() => commandTooltip(id)} side="right">
      <kit.Item className="menu-item" onSelect={onSelect} {...disabledProps}>
        {body}
      </kit.Item>
    </Tip>
  );
}

/** Window → รายชื่อหน้าต่างที่เปิดอยู่ ("1 Object Browser" ...) เลือกแล้วโฟกัสหน้าต่างนั้น ตามชื่อล่าสุดเสมอ (revision เพิ่มเมื่อชื่อเปลี่ยน) */
function WindowList({ kit }: { kit: MenuKit }) {
  const revision = useLayout((s) => s.revision);
  const windows = useMemo(() => useLayout.getState().listWindows(), [revision]);
  const activeId = useLayout.getState().api?.activePanel?.id;
  return (
    <>
      {windows.map((w, i) => (
        <kit.Item key={w.id} className="menu-item" data-active={w.id === activeId ? "" : undefined} onSelect={() => useLayout.getState().activatePanel(w.id)}>
          <span className="menu-indicator">{w.id === activeId && <Check size={12} aria-hidden="true" />}</span>
          <span className="menu-label">{`${i + 1} ${w.title}`}</span>
        </kit.Item>
      ))}
    </>
  );
}

export function MenuEntries({ entries, kit }: { entries: readonly MenuEntry[]; kit: MenuKit }) {
  return (
    <>
      {visibleEntries(entries).map((entry, i) => {
        if ("separator" in entry) return <kit.Separator key={i} className="menu-separator" />;
        if ("windowList" in entry) return <WindowList key={i} kit={kit} />;
        if ("submenu" in entry) {
          return (
            <kit.Sub key={i}>
              <kit.SubTrigger className="menu-item">
                <span className="menu-label">{t(entry.submenu)}</span>
                <ChevronRight size={12} aria-hidden="true" className="menu-chevron" />
              </kit.SubTrigger>
              <kit.Portal>
                <kit.SubContent className="menu-content" sideOffset={2}>
                  <MenuEntries entries={entry.items} kit={kit} />
                </kit.SubContent>
              </kit.Portal>
            </kit.Sub>
          );
        }
        return <CommandItem key={entry.command} id={entry.command} kit={kit} label={entry.label} />;
      })}
    </>
  );
}
