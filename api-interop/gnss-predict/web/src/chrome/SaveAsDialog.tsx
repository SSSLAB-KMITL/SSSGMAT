// File → Save As... (spec §5.1, W5): ถามชื่อใหม่ในกล่องเล็ก แล้ว PUT workbook → POST /copy → เปิดชื่อใหม่ (scenarioFiles.saveScenarioAs)
// - ชื่อผิดกติกาของ server ตรวจก่อนส่ง; server ตอบ 409 (ชื่อซ้ำ field new_name) หรือ 422 ที่ช่องชื่อ = ขึ้นกรอบแดงที่ช่อง Name พร้อมข้อความของ server
// - บันทึก workbook ไม่สำเร็จ = หยุด กล่องคงอยู่พร้อมข้อความบอกให้ดู Message Viewer (saveWorkbook แจ้งข้อผิดพลาดจริงแล้ว ไม่แจ้งซ้ำ)
// - ระหว่างคัดลอกปิดกล่องไม่ได้ (Cancel / Esc ไม่ทำงาน) กล่องจึงไม่หายไปใต้งานที่ยังวิ่งอยู่
// <SaveAsDialog/> วางครั้งเดียวที่ราก (App) คำสั่ง file.saveAs เรียก useSaveAs.getState().show()

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { create } from "zustand";
import { ApiError, errorText } from "../api/client";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { isScenarioName, saveScenarioAs, WorkbookNotSaved } from "../scenarioFiles";
import { report } from "../stores/messages";
import { FormField } from "./FormField";

interface SaveAsState {
  open: boolean;
  show(): void;
  hide(): void;
}

export const useSaveAs = create<SaveAsState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** ช่องที่ server ระบุใน field ว่าเป็นเรื่องของชื่อใหม่ */
const NAME_FIELDS: ReadonlySet<string | null> = new Set(["new_name", "name"]);

export function SaveAsDialog() {
  const open = useSaveAs((s) => s.open);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && useSaveAs.getState().hide()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{t("menu.file.saveAs")}</Dialog.Title>
          <SaveAsForm busy={busy} setBusy={setBusy} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** mount เฉพาะตอนกล่องเปิด จึงเริ่มว่างทุกครั้ง */
function SaveAsForm({ busy, setBusy }: { busy: boolean; setBusy(busy: boolean): void }) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (!isScenarioName(name)) {
      setNameError(msg("scenario.nameInvalid"));
      return;
    }
    setNameError(null);
    setGeneral(null);
    setBusy(true);
    try {
      await saveScenarioAs(name);
      useSaveAs.getState().hide(); // คัดลอกสำเร็จ: ปิดกล่อง (ถ้าเปิดสำเนาไม่ได้ ข้อความอยู่ใน Message Viewer แล้ว แต่สำเนามีอยู่จริง)
    } catch (e) {
      if (e instanceof WorkbookNotSaved) {
        setGeneral(msg("saveAs.workbookFailed"));
      } else if (e instanceof ApiError && NAME_FIELDS.has(e.field)) {
        setNameError(e.text);
      } else {
        const text = errorText(e);
        setGeneral(text);
        report("error", e instanceof ApiError ? e.code : "SAVE_AS", text);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" noValidate onSubmit={(e) => void submit(e)}>
      <FormField label={t("field.name")} error={nameError}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
        )}
      </FormField>
      {general !== null && (
        <div className="form-error form-general" role="alert">
          {general}
        </div>
      )}
      <div className="dlg-buttons">
        <button type="submit" className="btn" disabled={busy}>
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => useSaveAs.getState().hide()}>
          {t("dialog.cancel")}
        </button>
      </div>
    </form>
  );
}
