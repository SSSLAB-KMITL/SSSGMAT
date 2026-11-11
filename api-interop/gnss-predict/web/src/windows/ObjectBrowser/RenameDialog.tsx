// Rename: ถามชื่อใหม่ของ object (Facility, Constellation, Satellite) ตรวจกติกาเดียวกับ server ก่อนส่ง (A-Z a-z 0-9 _ - ยาว 1-32 ตัว)
// server ตอบ 409 (ชื่อซ้ำกับ object อื่น ไม่สนตัวพิมพ์เล็กใหญ่) หรือ 422 = ข้อความของ server ที่ช่องชื่อ; ชื่อเดิมเป๊ะ = ปิดโดยไม่ส่งคำขอ

import { errorText } from "../../api/client";
import { NamePromptDialog } from "../../chrome/NamePromptDialog";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { useScenario } from "../../stores/scenario";
import type { RenameTarget } from "./state";
import { isConflict, isFieldError, reportWriteError } from "../../api/writes";

const OBJECT_NAME = /^[A-Za-z0-9_-]{1,32}$/;

export interface RenameDialogProps {
  /** null = ปิด */
  target: RenameTarget | null;
  onClose(): void;
  onRenamed(target: RenameTarget, newName: string): void;
}

export function RenameDialog({ target, onClose, onRenamed }: RenameDialogProps) {
  return (
    <NamePromptDialog
      open={target !== null}
      title={t("menu.object.rename")}
      initialValue={target?.name ?? ""}
      selectOnFocus
      validate={(name) => (OBJECT_NAME.test(name) ? null : msg("ob.nameInvalid"))}
      submit={async (name) => {
        if (target === null || name === target.name) return;
        await useScenario.getState().rename(target.cls, target.name, name);
        onRenamed(target, name);
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
