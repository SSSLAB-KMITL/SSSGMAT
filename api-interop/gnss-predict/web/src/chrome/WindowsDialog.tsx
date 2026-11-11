// Window → Windows... (spec §4.1): ตาราง Window / Type ของหน้าต่างที่เปิดอยู่ พร้อมปุ่ม Activate, Integrate, Center, Close

import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { t } from "../labels/labels";
import { useLayout } from "../stores/layout";

export function WindowsDialog() {
  const open = useLayout((s) => s.windowsDialogOpen);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? useLayout.getState().openWindowsDialog() : useLayout.getState().closeWindowsDialog())}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content
          className="dlg windows-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // โฟกัสแถวที่เลือกอยู่ (ไม่ใช่แถวแรก) ไม่งั้นวงโฟกัสกับแถบสีน้ำเงินอยู่คนละแถว
            const row = e.currentTarget instanceof HTMLElement ? e.currentTarget.querySelector<HTMLElement>('tr[aria-selected="true"]') : null;
            if (row !== null) {
              e.preventDefault();
              row.focus();
            }
          }}
        >
          <Dialog.Title className="dlg-title">{t("window.windows")}</Dialog.Title>
          <WindowsList />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** เนื้อกล่อง: mount เฉพาะตอนเปิด จึงเลือกหน้าต่างที่ active อยู่เป็นค่าเริ่มต้นได้ตั้งแต่ render แรก */
function WindowsList() {
  const revision = useLayout((s) => s.revision);
  const [selected, setSelected] = useState<string | null>(() => useLayout.getState().api?.activePanel?.id ?? null);

  // revision เปลี่ยน = ชุดหน้าต่าง ชนิด หรือชื่ออาจเปลี่ยน
  const windows = useMemo(() => useLayout.getState().listWindows(), [revision]);
  const current = windows.find((w) => w.id === selected) ?? null;
  const act = (run: (id: string) => void) => () => {
    if (current !== null) run(current.id);
  };
  const layout = useLayout.getState;

  return (
    <div className="windows-dialog-body">
      <table className="windows-table" role="grid">
        <thead>
          <tr>
            <th>{t("dialog.windows.window")}</th>
            <th>{t("dialog.windows.type")}</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((w) => (
            <tr
              key={w.id}
              aria-selected={w.id === selected}
              tabIndex={0}
              onClick={() => setSelected(w.id)}
              onDoubleClick={() => layout().activatePanel(w.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(w.id);
                }
              }}
            >
              <td>{w.title}</td>
              <td>{t(`window.mode.${w.type}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="windows-buttons">
        <button type="button" className="btn" disabled={current === null} onClick={act((id) => layout().activatePanel(id))}>
          {t("dialog.windows.activate")}
        </button>
        <button type="button" className="btn" disabled={current === null || current.type === "integrated"} onClick={act((id) => layout().setType(id, "integrated"))}>
          {t("dialog.windows.integrate")}
        </button>
        <button type="button" className="btn" disabled={current?.type !== "floating"} onClick={act((id) => layout().centerPanel(id))}>
          {t("dialog.windows.center")}
        </button>
        <button type="button" className="btn" disabled={current === null} onClick={act((id) => layout().closePanel(id))}>
          {t("dialog.windows.close")}
        </button>
        <button type="button" className="btn windows-ok" onClick={() => layout().closeWindowsDialog()}>
          {t("dialog.ok")}
        </button>
      </div>
    </div>
  );
}
