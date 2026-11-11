// Rename: ถามชื่อใหม่ของ object (Facility, Constellation, Satellite) ตรวจกติกาเดียวกับ server ก่อนส่ง (A-Z a-z 0-9 _ - ยาว 1-32 ตัว)
// server ตอบ 409 (ชื่อซ้ำกับ object อื่น ไม่สนตัวพิมพ์เล็กใหญ่) หรือ 422 = ข้อความของ server ที่ช่องชื่อ; ชื่อเดิมเป๊ะ = ปิดโดยไม่ส่งคำขอ

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { errorText } from "../../api/client";
import { FormField } from "../../chrome/FormField";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { useScenario } from "../../stores/scenario";
import { isConflict, isFieldError, reportWriteError } from "./writes";

const OBJECT_NAME = /^[A-Za-z0-9_-]{1,32}$/;

export interface RenameTarget {
  cls: string;
  name: string;
}

export interface RenameDialogProps {
  /** null = ปิด */
  target: RenameTarget | null;
  onClose(): void;
  onRenamed(target: RenameTarget, newName: string): void;
}

export function RenameDialog({ target, onClose, onRenamed }: RenameDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root open={target !== null} onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{t("menu.object.rename")}</Dialog.Title>
          {target !== null && <RenameForm target={target} busy={busy} setBusy={setBusy} onClose={onClose} onRenamed={onRenamed} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenameForm({ target, busy, setBusy, onClose, onRenamed }: {
  target: RenameTarget;
  busy: boolean;
  setBusy(busy: boolean): void;
  onClose(): void;
  onRenamed(target: RenameTarget, newName: string): void;
}) {
  const [name, setName] = useState(target.name);
  const [error, setError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (!OBJECT_NAME.test(name)) return setError(msg("ob.nameInvalid"));
    if (name === target.name) return onClose();
    setError(null);
    setGeneral(null);
    setBusy(true);
    try {
      await useScenario.getState().rename(target.cls, target.name, name);
      onRenamed(target, name);
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
            onFocus={(e) => e.currentTarget.select()}
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
