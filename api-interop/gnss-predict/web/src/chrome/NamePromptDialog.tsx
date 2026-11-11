// กล่องถามชื่อกล่องเดียวที่ใช้ร่วมกัน (Save As, New Group, Rename): หัวกล่อง ช่องชื่อเดียว OK / Cancel
// - validate ตรวจก่อนส่ง (ข้อความขึ้นที่ช่อง); submit ทำจริง สำเร็จ = onClose; ล้มเหลว = ข้อผิดพลาดที่ fieldError บอกว่าเป็นของช่อง (เช่น server 409/422) ขึ้นที่ช่อง
//   ข้อผิดพลาดอื่นให้ handleError ตัดสิน (แจ้ง Message Viewer เองได้) แล้วข้อความที่ได้ขึ้นใต้ช่อง (null = ไม่ขึ้นอะไร เช่น 412 ที่มีกล่องของตัวเอง)
// - ระหว่าง submit ปิดกล่องไม่ได้ (Cancel / Esc / คลิกนอกกล่องไม่ทำงาน) กล่องจึงไม่หายไปใต้งานที่ยังวิ่งอยู่; กล่อง mount ฟอร์มเฉพาะตอนเปิด จึงเริ่มจาก initialValue ทุกครั้ง

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { errorText } from "../api/client";
import { t } from "../labels/labels";
import { FormField } from "./FormField";

export interface NamePromptDialogProps {
  open: boolean;
  title: string;
  /** ข้อความตั้งต้นของช่องทุกครั้งที่กล่องเปิด (ไม่ระบุ = ว่าง) */
  initialValue?: string;
  /** ข้อความผิดกติกาที่ขึ้นที่ช่อง; null = ผ่าน */
  validate(value: string): string | null;
  /** ทำงานจริงเมื่อกด OK และผ่าน validate; reject = กล่องคงอยู่ */
  submit(value: string): Promise<void>;
  /** หลัง submit สำเร็จ และเมื่อกด Cancel / Esc */
  onClose(): void;
  /** ข้อผิดพลาดนี้เป็นของช่องชื่อไหม: ข้อความที่ขึ้นที่ช่อง; null = ไม่ใช่ */
  fieldError?(e: unknown): string | null;
  /** ข้อผิดพลาดที่ไม่ใช่ของช่อง: ข้อความทั่วไปใต้ช่อง (null = ไม่ขึ้นอะไร) ไม่ระบุ = ข้อความของข้อผิดพลาดนั้น */
  handleError?(e: unknown): string | null;
  /** เลือกข้อความทั้งหมดเมื่อโฟกัสช่อง (Rename) */
  selectOnFocus?: boolean;
}

export function NamePromptDialog(props: NamePromptDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root open={props.open} onOpenChange={(next) => !next && !busy && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{props.title}</Dialog.Title>
          <NameForm {...props} busy={busy} setBusy={setBusy} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NameForm({ initialValue = "", validate, submit, onClose, fieldError, handleError, selectOnFocus, busy, setBusy }: NamePromptDialogProps & {
  busy: boolean;
  setBusy(busy: boolean): void;
}) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const problem = validate(name);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setGeneral(null);
    setBusy(true);
    try {
      await submit(name);
      onClose();
    } catch (e) {
      const onField = fieldError?.(e) ?? null;
      if (onField !== null) setError(onField);
      else setGeneral(handleError === undefined ? errorText(e) : handleError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" noValidate onSubmit={(e) => void onSubmit(e)}>
      <FormField label={t("field.name")} error={error}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onFocus={selectOnFocus === true ? (e) => e.currentTarget.select() : undefined}
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
