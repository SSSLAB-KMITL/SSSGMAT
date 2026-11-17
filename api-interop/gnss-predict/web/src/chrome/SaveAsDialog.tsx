// File → Save As... (spec §5.1, W5): ถามชื่อใหม่ในกล่องเล็ก แล้ว PUT workbook → POST /copy → เปิดชื่อใหม่ (scenarioFiles.saveScenarioAs)
// - ชื่อผิดกติกาของ server ตรวจก่อนส่ง; server ตอบ 409 (ชื่อซ้ำ field new_name) หรือ 422 ที่ช่องชื่อ = ขึ้นกรอบแดงที่ช่อง Name พร้อมข้อความของ server
// - บันทึก workbook ไม่สำเร็จ = หยุด กล่องคงอยู่พร้อมข้อความบอกให้ดู Message Viewer (saveWorkbook แจ้งข้อผิดพลาดจริงแล้ว ไม่แจ้งซ้ำ)
// - ระหว่างคัดลอกปิดกล่องไม่ได้ (Cancel / Esc ไม่ทำงาน) กล่องจึงไม่หายไปใต้งานที่ยังวิ่งอยู่
// ตัวกล่องคือ NamePromptDialog ที่ใช้ร่วมกับ New Group และ Rename
// <SaveAsDialog/> วางครั้งเดียวที่ราก (App) คำสั่ง file.saveAs เรียก useSaveAs.getState().show()

import { create } from "zustand";
import { ApiError, errorText } from "../api/client";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { isScenarioName, saveScenarioAs, WorkbookNotSaved } from "../scenarioFiles";
import { report } from "../stores/messages";
import { NamePromptDialog } from "./NamePromptDialog";

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
  return (
    <NamePromptDialog
      open={open}
      title={t("menu.file.saveAs")}
      validate={(name) => (isScenarioName(name) ? null : msg("scenario.nameInvalid"))}
      // สำเร็จ = ปิดกล่อง (ถ้าเปิดสำเนาไม่ได้ ข้อความอยู่ใน Message Viewer แล้ว แต่สำเนามีอยู่จริง)
      submit={async (name) => {
        await saveScenarioAs(name);
      }}
      onClose={() => useSaveAs.getState().hide()}
      fieldError={(e) => (e instanceof ApiError && NAME_FIELDS.has(e.field) ? e.text : null)}
      handleError={(e) => {
        if (e instanceof WorkbookNotSaved) return msg("saveAs.workbookFailed");
        const text = errorText(e);
        report("error", e instanceof ApiError ? e.code : "SAVE_AS", text);
        return text;
      }}
    />
  );
}
