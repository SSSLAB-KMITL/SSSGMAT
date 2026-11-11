// Define Properties ของ Insert STK Objects: กล่องเล็กถามค่าที่ object ต้องมี แล้วสร้างด้วย POST /objects (method "Define Properties")
// - Facility: ชื่อ + ตำแหน่ง (Latitude -90..90, Longitude -180..180, Altitude ตัวเลขใดก็ได้) ตามกติกาของ schema ที่ server
//   Satellite: ชื่อ + NORAD (จำนวนเต็มบวก) Constellation: ชื่ออย่างเดียว (สมาชิกเพิ่มทีหลังที่หน้า Basic - Definition)
// - ตรวจก่อนส่ง ข้อความไทยขึ้นที่ช่อง; ค่าที่ server ปฏิเสธ (409 ชื่อซ้ำ, 422) ขึ้นที่ช่องที่ field ชี้ (ชื่อ field ตามที่ server ใช้: position.lat_deg ฯลฯ)
//   ข้อผิดพลาดอื่นลง Message Viewer (ยกเว้น 412: กล่อง Reload / Cancel ของ store ขึ้นเอง) และขึ้นเหนือปุ่ม
// - ระหว่างส่ง ปิดกล่องไม่ได้; กล่องถูกวาดเฉพาะตอนเปิด จึงเริ่มจากช่องว่างทุกครั้ง

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { errorText } from "../../api/client";
import { isObjectName } from "../../api/names";
import { isConflict, isFieldError, reportWriteError } from "../../api/writes";
import { FormField } from "../../chrome/FormField";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { parseDecimal, parseInteger, type Parsed } from "../fieldRules";
import { insertObjects, type InsertClass } from "./insert";

export const CLASS_LABEL: Record<InsertClass, LabelKey> = {
  Facility: "ob.class.facility",
  Satellite: "ob.class.satellite",
  Constellation: "ob.class.constellation",
};

interface FieldDef {
  key: string;
  label: LabelKey;
  unit?: LabelKey;
  /** ชื่อ field ที่ server ใช้ใน 409/422 ของช่องนี้ */
  server: string;
  numeric?: boolean;
  parse(text: string): Parsed<unknown>;
}

const NAME: FieldDef = {
  key: "name",
  label: "field.name",
  server: "name",
  parse: (text) => (isObjectName(text) ? { ok: true, value: text } : { ok: false, error: msg("ob.nameInvalid") }),
};

interface FormDef {
  fields: readonly FieldDef[];
  /** ส่วนของ body ต่อจาก class และ method */
  body(values: Record<string, unknown>): Record<string, unknown>;
}

const FORMS: Record<InsertClass, FormDef> = {
  Facility: {
    fields: [
      NAME,
      { key: "lat", label: "field.latitude", unit: "field.unit.deg", server: "position.lat_deg", numeric: true, parse: (s) => parseDecimal(s, { min: -90, max: 90 }) },
      { key: "lon", label: "field.longitude", unit: "field.unit.deg", server: "position.lon_deg", numeric: true, parse: (s) => parseDecimal(s, { min: -180, max: 180 }) },
      { key: "alt", label: "field.altitude", unit: "field.unit.m", server: "position.alt_m", numeric: true, parse: (s) => parseDecimal(s) },
    ],
    body: (v) => ({ name: v.name, position: { lat_deg: v.lat, lon_deg: v.lon, alt_m: v.alt } }),
  },
  Satellite: {
    fields: [
      NAME,
      { key: "norad", label: "field.norad", server: "norad", numeric: true, parse: (s) => parseInteger(s, { min: 1 }, msg("insert.noradInvalid")) },
    ],
    body: (v) => ({ name: v.name, norad: v.norad }),
  },
  Constellation: { fields: [NAME], body: (v) => ({ name: v.name }) },
};

export interface DefinePropertiesDialogProps {
  cls: InsertClass;
  /** Cancel / Esc (ไม่เรียกระหว่างส่ง) */
  onClose(): void;
  /** สร้างสำเร็จ (object แรกถูกเลือกแล้ว) */
  onInserted(created: string[]): void;
}

export function DefinePropertiesDialog({ cls, onClose, onInserted }: DefinePropertiesDialogProps) {
  const form = FORMS[cls];
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(form.fields.map((f) => [f.key, ""])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (key: string, value: string): void => {
    setTexts((s) => ({ ...s, [key]: value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const values: Record<string, unknown> = {};
    const found: Record<string, string> = {};
    for (const field of form.fields) {
      const parsed = field.parse(texts[field.key]);
      if (parsed.ok) values[field.key] = parsed.value;
      else found[field.key] = parsed.error;
    }
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      onInserted(await insertObjects({ class: cls, method: "Define Properties", ...form.body(values) }));
    } catch (e) {
      const refusal = isFieldError(e) ? e : null;
      const field = refusal === null ? undefined : form.fields.find((f) => f.server === refusal.field);
      if (refusal !== null && field !== undefined) {
        setErrors({ [field.key]: refusal.text });
      } else {
        reportWriteError(e);
        setGeneral(isConflict(e) ? null : errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{`${t(CLASS_LABEL[cls])}: ${t("dialog.insert.defineProperties")}`}</Dialog.Title>
          <form className="form" noValidate onSubmit={(e) => void submit(e)}>
            {form.fields.map((field) => (
              <FormField key={field.key} label={t(field.label)} error={errors[field.key]} hint={field.unit === undefined ? undefined : t(field.unit)}>
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    inputMode={field.numeric === true ? "decimal" : undefined}
                    value={texts[field.key]}
                    disabled={busy}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => edit(field.key, e.target.value)}
                  />
                )}
              </FormField>
            ))}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
