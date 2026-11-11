// Insert STK Objects (spec §11, STK ref §B): Select An Object To Be Inserted (Facility, Satellite, Constellation), Select A Method, ปุ่ม Insert...
// - Facility: Define Properties, Insert Default; Satellite: From Satellite Catalog (เพิ่มเอง), Define Properties; Constellation: Define Properties
// - Insert Default ของ Facility สร้างทันทีแล้วเลือก object ใหม่ Define Properties เปิดกล่องถามค่า (DefinePropertiesDialog) From Satellite Catalog เปิด
//   Search Satellite Catalog แล้วปิดหน้าต่างนี้ ทุกทางที่สร้างสำเร็จเลือก object แรกที่สร้าง (insertObjects) และปิดหน้าต่างนี้
// - เปิดจากคำสั่ง insert.* ด้วย params { cls, seq }: cls = object ที่เลือกให้ (null = ตั้งต้น Facility) seq เปลี่ยนทุกครั้งที่สั่ง
//   เพื่อให้หน้าต่างที่เปิดค้างอยู่ย้ายไปยัง object ที่ขอแม้ขอตัวเดิมซ้ำหลังผู้ใช้เลือกอย่างอื่นแล้ว
// - scenarioBound: ปิดพร้อม scenario; ไม่มี scenario เปิดอยู่ (เปิดค้างไว้แล้วปิด scenario) = บอกและกด Insert... ไม่ได้

import { useEffect, useState } from "react";
import { errorText } from "../../api/client";
import { reportWriteError, isConflict } from "../../api/writes";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { CLASS_LABEL, DefinePropertiesDialog } from "./DefinePropertiesDialog";
import { insertObjects, type InsertClass } from "./insert";

type Method = "Define Properties" | "Insert Default" | "From Satellite Catalog";

const CLASSES: readonly InsertClass[] = ["Facility", "Satellite", "Constellation"];

/** วิธีของแต่ละ object ตาม spec §11 (ตัวแรก = ตั้งต้น) */
const METHODS: Record<InsertClass, readonly Method[]> = {
  Facility: ["Define Properties", "Insert Default"],
  Satellite: ["From Satellite Catalog", "Define Properties"],
  Constellation: ["Define Properties"],
};

const METHOD_LABEL: Record<Method, LabelKey> = {
  "Define Properties": "dialog.insert.defineProperties",
  "Insert Default": "dialog.insert.insertDefault",
  "From Satellite Catalog": "dialog.insert.fromSatelliteCatalog",
};

/** object ที่ params ขอ (ไม่ระบุหรือไม่รู้จัก = Facility) */
const classOf = (x: unknown): InsertClass => CLASSES.find((c) => c === x) ?? "Facility";

export function InsertObjects({ params, panelId = "insertObjects" }: Partial<PanelProps>) {
  const asked = classOf(params?.cls);
  const seq: unknown = params?.seq;
  const [cls, setCls] = useState<InsertClass>(asked);
  const [method, setMethod] = useState<Method>(METHODS[asked][0]);
  const [defining, setDefining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [general, setGeneral] = useState<string | null>(null);
  const open = useScenario((s) => s.name !== null);

  // เปิดซ้ำด้วยคำสั่งอื่น: ย้ายไป object ที่ขอ (และปิดกล่องถามค่าที่ค้างอยู่ซึ่งเป็นของ object เดิม)
  useEffect(() => {
    setCls(asked);
    setMethod(METHODS[asked][0]);
    setDefining(false);
    setGeneral(null);
  }, [asked, seq]);

  const pick = (next: InsertClass): void => {
    setCls(next);
    setMethod(METHODS[next][0]);
    setGeneral(null);
  };
  const close = (): void => useLayout.getState().closePanel(panelId);

  const insert = async (): Promise<void> => {
    if (busy || !open) return;
    setGeneral(null);
    if (method === "From Satellite Catalog") {
      useLayout.getState().openPanel("satelliteCatalog");
      close();
      return;
    }
    if (method === "Define Properties") {
      setDefining(true);
      return;
    }
    setBusy(true);
    try {
      await insertObjects({ class: cls, method });
      close();
    } catch (e) {
      reportWriteError(e);
      if (!isConflict(e)) setGeneral(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="insert">
      <div className="insert-choices">
        <fieldset className="insert-group">
          <legend>{t("dialog.insert.selectObject")}</legend>
          {CLASSES.map((c) => (
            <label key={c} className="insert-choice">
              <input type="radio" name="insert-object" checked={cls === c} disabled={busy} onChange={() => pick(c)} />
              {t(CLASS_LABEL[c])}
            </label>
          ))}
        </fieldset>
        <fieldset className="insert-group">
          <legend>{t("dialog.insert.selectMethod")}</legend>
          {METHODS[cls].map((m) => (
            <label key={m} className="insert-choice">
              <input type="radio" name="insert-method" checked={method === m} disabled={busy} onChange={() => setMethod(m)} />
              {t(METHOD_LABEL[m])}
            </label>
          ))}
        </fieldset>
      </div>
      {!open && <p className="insert-note">{msg("tooltip.noScenario")}</p>}
      {general !== null && (
        <p className="form-error insert-note" role="alert">
          {general}
        </p>
      )}
      <div className="insert-buttons">
        <button type="button" className="btn" disabled={busy || !open} onClick={() => void insert()}>
          {t("dialog.insert.insert")}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={close}>
          {t("dialog.cancel")}
        </button>
      </div>
      {defining && (
        <DefinePropertiesDialog
          cls={cls}
          onClose={() => setDefining(false)}
          onInserted={() => {
            setDefining(false);
            close();
          }}
        />
      )}
    </div>
  );
}

/** ลงทะเบียน Insert STK Objects เป็นหน้าต่างชนิด insertObjects (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerInsertObjectsPanel(): void {
  const base = getPanelDef("insertObjects");
  if (base === undefined) throw new Error('panel kind "insertObjects" is not registered');
  registerPanel("insertObjects", { ...base, component: InsertObjects });
}
