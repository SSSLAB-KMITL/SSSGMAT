// คำสั่งของ Object Browser ที่ลงทะเบียนระดับแอป (W3): edit.cut/copy/paste/delete/find, object.properties/rename/delete, ob.*
// ลงทะเบียนครั้งเดียวตอนแอปเริ่ม (เหมือน registerCoreCommands / registerFileCommands) ไม่ผูกกับหน้าต่าง: dockview ถอดแท็บที่ซ่อนอยู่หรือปิดหน้าต่างแล้ว
// เมนู Edit, ปุ่ม Delete และปุ่ม ⚠ บนแถบสถานะต้องยังใช้ได้ คำสั่งทำกับการเลือกปัจจุบันของแอป (useSelection) และสถานะใน state.ts
// คำสั่งที่ต้องมีหน้าจอ (Find, New Group, Rename, ตัวกรองธง) เปิดหรือโฟกัสหน้าต่าง Object Browser ให้ แล้วหน้าต่างแสดงสถานะที่ตั้งไว้
// enabled() ขึ้นกับการเลือก คลิปบอร์ด และต้นไม้ ซึ่งทะเบียนไม่รู้ว่าเปลี่ยน: ที่นี่ฟัง store เหล่านั้นแล้วเรียก invalidateCommands()
// object.zoomTo เป็นของหน้าต่าง 3D; object.access / object.reportGraphManager ยังไม่ทำ (รายการเมนูจึงปิดใช้อยู่)

import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../../commands";
import { msg } from "../../labels/messages.th";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import {
  collapseAll, copyRow, deleteRow, expandAll, hasTree, openProperties, paste, selectedRow, showObjectBrowser,
} from "./actions";
import { useClipboard } from "./clipboard";
import { useObjectBrowser } from "./state";
import { isEditable, isSatellite } from "./tree";

const noTree = (): string | undefined => (hasTree() ? undefined : msg("tooltip.noScenario"));

/** เหตุที่ทำกับแถวที่เลือกไม่ได้ (undefined = ทำได้) */
function needsEditable(): string | undefined {
  const row = selectedRow();
  if (row === undefined) return msg("ob.selectObject");
  if (row.kind === "group") return msg("ob.groupUnsupported");
  return isEditable(row) ? undefined : msg("ob.rootUnsupported");
}

const needsSatellite = (): string | undefined => {
  const row = selectedRow();
  return row === undefined ? msg("ob.selectObject") : isSatellite(row) ? undefined : msg("ob.satelliteOnly");
};

function pasteBlock(): string | undefined {
  if (!hasTree()) return msg("tooltip.noScenario");
  const content = useClipboard.getState().content;
  if (content === null) return msg("ob.nothingToPaste");
  return content.mode === "cut" && selectedRow()?.kind !== "group" ? msg("ob.pasteNeedsFolder") : undefined;
}

export function registerObjectBrowserCommands(): () => void {
  const disposers: (() => void)[] = [];
  const add = (id: CommandId, def: Omit<CommandDef, "label">): void => {
    disposers.push(registerCommand(id, { label: COMMAND_LABELS[id], ...def }));
  };
  const set = useObjectBrowser.setState;
  const deleteSelected = (): void => {
    const row = selectedRow();
    if (row !== undefined) void deleteRow(row);
  };
  const copySelected = (mode: "cut" | "copy") => (): void => {
    const row = selectedRow();
    if (row !== undefined) copyRow(mode, row);
  };

  add("object.properties", {
    run: () => {
      const row = selectedRow();
      if (row !== undefined) openProperties(row);
    },
    enabled: () => selectedRow()?.kind === "object",
    tooltip: () => (selectedRow()?.kind === "object" ? undefined : msg("ob.selectObject")),
  });
  add("object.rename", {
    run: () => {
      const row = selectedRow();
      if (!isEditable(row)) return;
      set({ renaming: { cls: row.cls, name: row.name } });
      showObjectBrowser();
    },
    enabled: () => isEditable(selectedRow()),
    tooltip: needsEditable,
  });
  add("object.delete", { run: deleteSelected, enabled: () => isEditable(selectedRow()), tooltip: needsEditable });
  add("edit.delete", { run: deleteSelected, enabled: () => isEditable(selectedRow()), tooltip: needsEditable });
  add("edit.cut", { run: copySelected("cut"), enabled: () => isSatellite(selectedRow()), tooltip: needsSatellite });
  add("edit.copy", { run: copySelected("copy"), enabled: () => isSatellite(selectedRow()), tooltip: needsSatellite });
  add("edit.paste", { run: () => void paste(), enabled: () => pasteBlock() === undefined, tooltip: pasteBlock });
  add("edit.find", {
    run: () => {
      set((s) => ({ findOpen: true, findToken: s.findToken + 1 }));
      showObjectBrowser();
    },
    enabled: hasTree,
    tooltip: noTree,
  });
  add("ob.newGroup", {
    run: () => {
      set({ newGroupOpen: true });
      showObjectBrowser();
    },
    enabled: hasTree,
    tooltip: noTree,
  });
  add("ob.expandAll", { run: expandAll, enabled: hasTree, tooltip: noTree });
  add("ob.collapseAll", { run: collapseAll, enabled: hasTree, tooltip: noTree });
  add("ob.colorSelectors", { run: () => set((s) => ({ showColors: !s.showColors })) });
  add("ob.onOffToggles", { run: () => set((s) => ({ showToggles: !s.showToggles })) });
  add("ob.showFlagged", {
    run: () => {
      set((s) => ({ flaggedOnly: !s.flaggedOnly }));
      showObjectBrowser();
    },
    enabled: hasTree,
    tooltip: noTree,
  });

  const unsubscribe = [
    useSelection.subscribe((s, prev) => {
      if (s.activePath !== prev.activePath) invalidateCommands();
    }),
    useObjectBrowser.subscribe((s, prev) => {
      if (s.groupSelected !== prev.groupSelected) invalidateCommands();
    }),
    useClipboard.subscribe(invalidateCommands),
    useScenario.subscribe((s, prev) => {
      if (s.tree !== prev.tree) invalidateCommands();
    }),
  ];
  invalidateCommands();
  return () => {
    for (const off of unsubscribe) off();
    for (const dispose of disposers) dispose();
  };
}
