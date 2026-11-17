// ช่องกรอกของฟอร์ม (New Scenario Wizard, Save As): ป้ายชื่อ + ช่อง + ข้อความผิดพลาดที่ผูกกับช่องนั้น (spec §15: 422 ขึ้นกรอบแดงที่ช่องพร้อมข้อความ)
// ช่องที่ผิดได้ class `field-invalid` (ขอบแดง), aria-invalid และ aria-describedby ชี้ข้อความ ผู้เรียกใส่ ControlProps ลงบน <input>/<select> เอง

import { useId, type ReactElement, type ReactNode } from "react";

export interface ControlProps {
  id: string;
  className: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

export interface FormFieldProps {
  label: string;
  /** ไม่มี/ว่าง = ช่องปกติ */
  error?: string | null;
  /** คำอธิบายใต้ช่อง (ไม่ใช่ข้อผิดพลาด) */
  hint?: ReactNode;
  children: (control: ControlProps) => ReactElement;
}

export function FormField({ label, error, hint, children }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = error !== null && error !== undefined && error !== "";
  return (
    <div className="form-row">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="form-control">
        {children({
          id,
          className: `field form-input${invalid ? " field-invalid" : ""}`,
          "aria-invalid": invalid ? true : undefined,
          "aria-describedby": invalid ? errorId : undefined,
        })}
        {invalid && (
          <div id={errorId} className="form-error" role="alert">
            {error}
          </div>
        )}
        {hint !== undefined && hint !== null && <div className="form-hint">{hint}</div>}
      </div>
    </div>
  );
}
