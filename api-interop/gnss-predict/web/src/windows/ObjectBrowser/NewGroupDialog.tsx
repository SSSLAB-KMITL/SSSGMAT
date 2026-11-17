// New Group: ถามชื่อโฟลเดอร์แล้วสร้างกลุ่มว่าง (POST /groups members []) ชื่อห้ามว่างและห้ามซ้ำกับกลุ่มที่มี (ไม่สนตัวพิมพ์เล็กใหญ่)
// server ตอบ 409/422 = ข้อความของ server ที่ช่องชื่อ; ผิดพลาดแบบอื่นขึ้นใต้ช่องและใน Message Viewer; 412 ปล่อยให้กล่อง Reload / Cancel จัดการ

import { errorText } from "../../api/client";
import { NamePromptDialog } from "../../chrome/NamePromptDialog";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { useScenario } from "../../stores/scenario";
import { isConflict, isFieldError, reportWriteError } from "../../api/writes";

export interface NewGroupDialogProps {
  open: boolean;
  onClose(): void;
  /** ชื่อกลุ่มที่มีอยู่ */
  groups: readonly string[];
}

export function NewGroupDialog({ open, onClose, groups }: NewGroupDialogProps) {
  return (
    <NamePromptDialog
      open={open}
      title={t("ob.newGroup")}
      validate={(name) => {
        const wanted = name.trim();
        if (wanted === "") return msg("ob.groupNameEmpty");
        return groups.some((g) => g.toLowerCase() === wanted.toLowerCase()) ? msg("ob.groupNameTaken", { name: wanted }) : null;
      }}
      submit={async (name) => {
        await useScenario.getState().setGroup(name.trim(), []);
      }}
      onClose={onClose}
      fieldError={(e) => (isFieldError(e) ? e.text : null)}
      handleError={(e) => {
        reportWriteError(e);
        return isConflict(e) ? null : errorText(e);
      }}
    />
  );
}
