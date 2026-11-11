// ช่องกรอกของหน้า Properties: อ่านและเขียนค่าในฟอร์มของหน้าต่างผ่าน context (EditorContext) ด้วย key ของช่อง (path ที่ server ใช้)
// ทุกช่องวางผ่าน FormField จึงได้ป้ายชื่อ ขอบแดง aria-invalid และข้อความผิดพลาดแบบเดียวกับกล่องอื่นของแอป

import { createContext, useContext, type FC, type ReactNode } from "react";
import { FormField } from "../../chrome/FormField";
import { t, type LabelKey } from "../../labels/labels";
import type { Errors, Tree, Value, Values } from "./form";

/** หนึ่งหน้าของรายการ "กลุ่ม - หน้า": fields = key ของช่องที่หน้านี้แสดง (ไว้หาหน้าของช่องที่ผิด) */
export interface PageDef {
  id: string;
  title: LabelKey;
  fields: readonly string[];
  Component: FC;
}

export interface EditorApi {
  /** root ที่โหลดมาล่าสุด (ค่าที่ server เก็บ ณ ตอนโหลด) */
  base: Tree;
  values: Values;
  errors: Errors;
  set(key: string, value: Value): void;
  /**
   * สถานะของหน้าที่ไม่ใช่ค่าของ server: true = แถวที่ผู้ใช้เพิ่มเอง (Add... ในรายการ Active) ทั้งที่ค่าของ server ยังไม่แสดงแถวนั้น, false = แถวที่ผู้ใช้เอาออก
   * true อยู่รอดตอนฟอร์มตามค่าของ server เงียบ ๆ และหลัง Apply; ทั้งหมดถูกล้างเมื่อ Reload (ทิ้งทุกอย่างที่ผู้ใช้ทำ)
   */
  ui: Record<string, boolean>;
  setUi(key: string, value: boolean): void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditorApi(): EditorApi {
  const api = useContext(EditorContext);
  if (api === null) throw new Error("the Properties field needs a form around it");
  return api;
}

const text = (api: EditorApi, key: string): string => {
  const v = api.values[key];
  return typeof v === "string" ? v : "";
};

interface RowProps {
  /** key ของช่อง (path ใน root) */
  k: string;
  label: string;
  /** คำอธิบายใต้ช่อง เช่น หน่วย */
  hint?: ReactNode;
}

export function TextRow({ k, label, hint, multiline = false }: RowProps & { multiline?: boolean }) {
  const api = useEditorApi();
  const props = { value: text(api, k), spellCheck: false, autoComplete: "off" };
  return (
    <FormField label={label} error={api.errors[k]} hint={hint}>
      {(control) =>
        multiline ? (
          <textarea {...control} {...props} className={`${control.className} form-textarea`} rows={5} onChange={(e) => api.set(k, e.target.value)} />
        ) : (
          <input {...control} {...props} type="text" onChange={(e) => api.set(k, e.target.value)} />
        )
      }
    </FormField>
  );
}

/** ตัวเลขเป็นข้อความที่ตรวจตอน Apply (form.ts): พิมพ์ครึ่งทางหรือผิดได้โดยช่องไม่เด้งกลับ */
export function NumberRow({ k, label, unit }: RowProps & { unit?: string }) {
  const api = useEditorApi();
  return (
    <FormField label={label} error={api.errors[k]} hint={unit}>
      {(control) => (
        <input {...control} type="text" inputMode="decimal" value={text(api, k)} spellCheck={false} autoComplete="off" onChange={(e) => api.set(k, e.target.value)} />
      )}
    </FormField>
  );
}

/** nullable = ค่า null (ใช้ค่าตั้งต้น) เลือกกลับมาได้เสมอ: ตัวเลือกว่างอยู่หน้าสุดตลอด ไม่หายเมื่อเลือกค่าอื่นแล้ว */
export function ChoiceRow({ k, label, options, labelOf, nullable = false }: RowProps & { options: readonly string[]; labelOf(code: string): string; nullable?: boolean }) {
  const api = useEditorApi();
  const value = text(api, k);
  return (
    <FormField label={label} error={api.errors[k]}>
      {(control) => (
        <select {...control} value={value} onChange={(e) => api.set(k, e.target.value)}>
          {nullable && <option value="" />}
          {options.map((code) => (
            <option key={code} value={code}>
              {labelOf(code)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

export function CheckRow({ k, label }: RowProps) {
  const api = useEditorApi();
  return (
    <FormField label={label} error={api.errors[k]}>
      {({ id, "aria-invalid": invalid, "aria-describedby": describedBy }) => (
        <input id={id} type="checkbox" className="form-check" aria-invalid={invalid} aria-describedby={describedBy} checked={api.values[k] === true} onChange={(e) => api.set(k, e.target.checked)} />
      )}
    </FormField>
  );
}

/**
 * ช่องสีที่ยังไม่ได้ตั้ง (null) แสดงด้วยสีนี้แทนดำสนิท: input type=color ไม่ยิง change เมื่อเลือกสีเท่ากับค่าที่แสดงอยู่ ถ้าแสดง #000000 การเลือกสีดำจะไม่ถูกบันทึก
 * (#000001 ดำเกือบสนิท ไม่มีใครเลือกตั้งใจ; ทุกสีอื่นรวมดำสนิทยิง change ตามปกติ)
 */
const UNSET_SWATCH = "#000001";

/** สี: ช่องเลือกสี (input type=color) กับปุ่ม Clear (ว่าง = null คือไม่ได้ตั้งสีเอง) */
export function ColorRow({ k, label }: RowProps) {
  const api = useEditorApi();
  const value = text(api, k);
  return (
    <FormField label={label} error={api.errors[k]}>
      {({ id, "aria-invalid": invalid, "aria-describedby": describedBy }) => (
        <div className="color-row">
          <input id={id} type="color" className="color-input" aria-invalid={invalid} aria-describedby={describedBy} value={value === "" ? UNSET_SWATCH : value} onChange={(e) => api.set(k, e.target.value)} />
          <span className="color-text">{value === "" ? "—" : value}</span>
          <button type="button" className="btn" disabled={value === ""} onClick={() => api.set(k, "")}>
            {t("dialog.clear")}
          </button>
        </div>
      )}
    </FormField>
  );
}

/** ช่องอ่านอย่างเดียว (ค่าที่หน้านี้แก้ไม่ได้) */
export function ReadOnlyRow({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <FormField label={label} hint={hint}>
      {(control) => <input {...control} type="text" readOnly value={value} />}
    </FormField>
  );
}

/** กลุ่มช่องที่มีหัวข้อ (Analysis Period, Animation, Elevation Angle ฯลฯ) */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="props-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Short Description / Long Description ของ object (basic.*) หรือของ Scenario (ระดับบนของเอกสาร) */
export function DescriptionRows({ prefix }: { prefix: "basic." | "" }) {
  return (
    <>
      <TextRow k={`${prefix}description`} label={t("field.shortDescription")} />
      <TextRow k={`${prefix}long_description`} label={t("field.longDescription")} multiline />
    </>
  );
}
