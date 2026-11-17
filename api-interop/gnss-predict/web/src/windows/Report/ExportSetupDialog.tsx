// กล่อง Setup... ของ Export ในหน้าต่างรายงาน (spec §3.5, P9): Field Delimiter, Enclose Header Fields in Quotes, Write Report Title, Headers
// - ค่าตั้งต้น P9: `,` / ไม่ใส่คำพูด / ไม่เขียนชื่อรายงาน / มีหัวคอลัมน์ (DEFAULT_EXPORT_SETUP)
// - Field Delimiter ต้องเป็นอักขระเดียวที่ไม่ใช่ " หรือการขึ้นบรรทัดใหม่ (กติกาเดียวกับ ExportSetup ของ engine) ผิด = ข้อความที่ช่อง กล่องไม่ปิด
// - OK = ส่งค่าใหม่ให้ผู้เรียก (หน้าต่างรายงานเก็บใน windowProps ของตัวเอง) Cancel / Esc = ไม่เปลี่ยน
// - ฟอร์ม mount เฉพาะตอนเปิด จึงเริ่มจากค่าปัจจุบันทุกครั้ง

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { FormField } from "../../chrome/FormField";
import { useReturnFocus } from "../../chrome/returnFocus";
import { DEFAULT_EXPORT_SETUP, type ExportSetup } from "../../data/reports";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";

/** ตัวคั่นที่ engine รับ: อักขระเดียว ไม่ใช่ " หรือ \r \n */
export const validDelimiter = (d: unknown): d is string => typeof d === "string" && d.length === 1 && !'"\r\n'.includes(d);

/** ค่า Export Setup ที่เก็บไว้ (windowProps ของหน้าต่าง อาจมาจาก workbook ที่แก้มือ) ช่องที่ใช้ไม่ได้ = ค่าตั้งต้นของช่องนั้น */
export function parseExportSetup(x: unknown): ExportSetup {
  const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
  const bool = (k: keyof ExportSetup): boolean => (typeof o[k] === "boolean" ? (o[k] as boolean) : (DEFAULT_EXPORT_SETUP[k] as boolean));
  return {
    delimiter: validDelimiter(o.delimiter) ? o.delimiter : DEFAULT_EXPORT_SETUP.delimiter,
    quote_headers: bool("quote_headers"),
    title: bool("title"),
    headers: bool("headers"),
  };
}

export interface ExportSetupDialogProps {
  open: boolean;
  value: ExportSetup;
  onSave(value: ExportSetup): void;
  onClose(): void;
}

export function ExportSetupDialog({ open, value, onSave, onClose }: ExportSetupDialogProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onCloseAutoFocus={returnFocus.onCloseAutoFocus}>
          <Dialog.Title className="dlg-title">{t("report.exportSetup")}</Dialog.Title>
          <SetupForm value={value} onSave={onSave} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const CHECKS: { key: "quote_headers" | "title" | "headers"; label: LabelKey }[] = [
  { key: "quote_headers", label: "report.encloseHeaderFields" },
  { key: "title", label: "report.writeReportTitle" },
  { key: "headers", label: "report.headers" },
];

function SetupForm({ value, onSave, onClose }: Omit<ExportSetupDialogProps, "open">) {
  const [form, setForm] = useState<ExportSetup>(value);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!validDelimiter(form.delimiter)) {
      setError(msg("report.delimiterInvalid"));
      return;
    }
    onSave(form);
    onClose();
  };

  return (
    <form className="form" noValidate onSubmit={submit}>
      <FormField label={t("report.fieldDelimiter")} error={error}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={form.delimiter}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setForm({ ...form, delimiter: e.target.value });
              setError(null);
            }}
          />
        )}
      </FormField>
      {CHECKS.map(({ key, label }) => (
        <FormField key={key} label={t(label)}>
          {({ id }) => (
            <input id={id} type="checkbox" className="form-check" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
          )}
        </FormField>
      ))}
      <div className="dlg-buttons">
        <button type="submit" className="btn">
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </form>
  );
}
