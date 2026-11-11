// New Group: ถามชื่อโฟลเดอร์แล้วสร้างกลุ่มว่าง (POST /groups members []) ชื่อห้ามว่างและห้ามซ้ำกับกลุ่มที่มี (ไม่สนตัวพิมพ์เล็กใหญ่)
// server ตอบ 409/422 = ข้อความของ server ที่ช่องชื่อ; ผิดพลาดแบบอื่นขึ้นใต้ช่องและใน Message Viewer; 412 ปล่อยให้กล่อง Reload / Cancel จัดการ

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { errorText } from "../../api/client";
import { FormField } from "../../chrome/FormField";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { useScenario } from "../../stores/scenario";
import { isConflict, isFieldError, reportWriteError } from "./writes";

export interface NewGroupDialogProps {
  open: boolean;
  onClose(): void;
  /** ชื่อกลุ่มที่มีอยู่ */
  groups: readonly string[];
}

export function NewGroupDialog({ open, onClose, groups }: NewGroupDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{t("ob.newGroup")}</Dialog.Title>
          <GroupForm groups={groups} busy={busy} setBusy={setBusy} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** mount เฉพาะตอนกล่องเปิด จึงเริ่มว่างทุกครั้ง */
function GroupForm({ groups, busy, setBusy, onClose }: { groups: readonly string[]; busy: boolean; setBusy(busy: boolean): void; onClose(): void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const wanted = name.trim();
    if (wanted === "") return setError(msg("ob.groupNameEmpty"));
    if (groups.some((g) => g.toLowerCase() === wanted.toLowerCase())) return setError(msg("ob.groupNameTaken", { name: wanted }));
    setError(null);
    setGeneral(null);
    setBusy(true);
    try {
      await useScenario.getState().setGroup(wanted, []);
      onClose();
    } catch (e) {
      if (isFieldError(e)) setError(e.text);
      else if (!isConflict(e)) {
        setGeneral(errorText(e));
        reportWriteError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" noValidate onSubmit={(e) => void submit(e)}>
      <FormField label={t("field.name")} error={error}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
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
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </form>
  );
}
