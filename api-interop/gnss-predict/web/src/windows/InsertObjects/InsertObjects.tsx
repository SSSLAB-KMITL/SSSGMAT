// Insert STK Objects (spec §11, STK ref §B): Select An Object To Be Inserted (Facility, Satellite, Sensor, Constellation), Select A Method, ปุ่ม Insert...
// - Facility: Define Properties, Insert Default; Satellite: From Satellite Catalog (เพิ่มเอง), Define Properties; Constellation: Define Properties
//   Sensor: Define Properties, Insert Default (sensor spec §5.1) ทั้งสองวิธีถามดาวแม่ที่ Select Object ก่อน (SelectObjectDialog; Cancel = ไม่ทำอะไร)
//   แล้ว Insert Default สร้างทันทีด้วย parent นั้น ส่วน Define Properties เปิดกล่องถามค่าพร้อมดาวแม่ (อ่านอย่างเดียว) ไม่มีดาวใน scenario = วิธีของ Sensor ปิดใช้พร้อมเหตุภาษาไทย
// - Insert Default ของ Facility สร้างทันทีแล้วเลือก object ใหม่ Define Properties เปิดกล่องถามค่า (DefinePropertiesDialog) From Satellite Catalog เปิด
//   Search Satellite Catalog แล้วปิดหน้าต่างนี้ ทุกทางที่สร้างสำเร็จเลือก object แรกที่สร้าง (insertObjects) และปิดหน้าต่างนี้
// - เปิดจากคำสั่ง insert.* ด้วย params { cls, seq }: cls = object ที่เลือกให้ (null = ตั้งต้น Facility) seq เปลี่ยนทุกครั้งที่สั่ง
//   เพื่อให้หน้าต่างที่เปิดค้างอยู่ย้ายไปยัง object ที่ขอแม้ขอตัวเดิมซ้ำหลังผู้ใช้เลือกอย่างอื่นแล้ว
// - scenarioBound: ปิดพร้อม scenario; ไม่มี scenario เปิดอยู่ (เปิดค้างไว้แล้วปิด scenario) = บอกและกด Insert... ไม่ได้

import { useEffect, useRef, useState } from "react";
import { errorText } from "../../api/client";
import { reportWriteError, isConflict } from "../../api/writes";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario, type InsertBody } from "../../stores/scenario";
import { CLASS_LABEL, DefinePropertiesDialog } from "./DefinePropertiesDialog";
import { insertObjects, satellitePaths, type InsertClass } from "./insert";
import { SelectObjectDialog } from "./SelectObjectDialog";

type Method = "Define Properties" | "Insert Default" | "From Satellite Catalog";

const CLASSES: readonly InsertClass[] = ["Facility", "Satellite", "Sensor", "Constellation"];

/** วิธีของแต่ละ object ตาม spec §11 (ตัวแรก = ตั้งต้น) */
const METHODS: Record<InsertClass, readonly Method[]> = {
  Facility: ["Define Properties", "Insert Default"],
  Satellite: ["From Satellite Catalog", "Define Properties"],
  Sensor: ["Define Properties", "Insert Default"],
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
  /** Select Object เปิดอยู่ (Sensor) และดาวแม่ที่เลือกแล้วสำหรับกล่อง Define Properties */
  const [selecting, setSelecting] = useState(false);
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [general, setGeneral] = useState<string | null>(null);
  const open = useScenario((s) => s.name !== null);
  const hasSatellite = useScenario((s) => satellitePaths(s.doc).length > 0);
  const insertButton = useRef<HTMLButtonElement>(null);
  // Sensor ต้องมีดาวแม่: ไม่มีดาวใน scenario = วิธีของ Sensor ใช้ไม่ได้ (ไม่มี scenario เลยมีข้อความของตัวเองอยู่แล้ว)
  const noParent = open && cls === "Sensor" && !hasSatellite;

  // เปิดซ้ำด้วยคำสั่งอื่น: ย้ายไป object ที่ขอ (และปิดกล่องถามค่าที่ค้างอยู่ซึ่งเป็นของ object เดิม)
  useEffect(() => {
    setCls(asked);
    setMethod(METHODS[asked][0]);
    setDefining(false);
    setSelecting(false);
    setGeneral(null);
  }, [asked, seq]);

  const pick = (next: InsertClass): void => {
    setCls(next);
    setMethod(METHODS[next][0]);
    setGeneral(null);
  };
  const close = (): void => useLayout.getState().closePanel(panelId);

  /** สร้างทันทีตาม body: สำเร็จ = ปิดหน้าต่างนี้ (object แรกถูกเลือกแล้ว) ล้มเหลว = Message Viewer (ยกเว้น 412) และขึ้นเหนือปุ่ม */
  const create = async (body: InsertBody): Promise<void> => {
    setBusy(true);
    try {
      await insertObjects(body);
      close();
    } catch (e) {
      reportWriteError(e);
      if (!isConflict(e)) setGeneral(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const insert = async (): Promise<void> => {
    if (busy || !open || noParent) return;
    setGeneral(null);
    if (method === "From Satellite Catalog") {
      useLayout.getState().openPanel("satelliteCatalog");
      close();
      return;
    }
    if (cls === "Sensor") {
      setSelecting(true); // ดาวแม่ก่อน ทั้ง Define Properties และ Insert Default
      return;
    }
    if (method === "Define Properties") {
      setDefining(true);
      return;
    }
    await create({ class: cls, method });
  };

  /** ผลของ Select Object: null = ยกเลิก (ไม่ทำอะไร) */
  const parentPicked = async (path: string | null): Promise<void> => {
    setSelecting(false);
    if (path === null) return;
    if (method === "Define Properties") {
      setParent(path);
      setDefining(true);
      return;
    }
    await create({ class: "Sensor", method: "Insert Default", parent: path });
  };

  // กล่อง Define Properties ของ Sensor เปิดต่อจาก Select Object ในจังหวะเดียวกัน ตอนนั้นไม่มี element ให้กล่องจำโฟกัส: ปิดด้วย Cancel แล้วคืนให้ปุ่ม Insert... เอง
  const closeDefine = (): void => {
    setDefining(false);
    if (cls === "Sensor") setTimeout(() => insertButton.current?.focus(), 0);
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
              <input type="radio" name="insert-method" checked={method === m} disabled={busy || noParent} onChange={() => setMethod(m)} />
              {t(METHOD_LABEL[m])}
            </label>
          ))}
        </fieldset>
      </div>
      {!open && <p className="insert-note">{msg("tooltip.noScenario")}</p>}
      {noParent && <p className="insert-note">{msg("insert.noSatellite")}</p>}
      {general !== null && (
        <p className="form-error insert-note" role="alert">
          {general}
        </p>
      )}
      <div className="insert-buttons">
        <button ref={insertButton} type="button" className="btn" disabled={busy || !open || noParent} onClick={() => void insert()}>
          {t("dialog.insert.insert")}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={close}>
          {t("dialog.cancel")}
        </button>
      </div>
      {selecting && <SelectObjectDialog onClose={(path) => void parentPicked(path)} />}
      {defining && (cls !== "Sensor" || parent !== null) && (
        <DefinePropertiesDialog
          cls={cls}
          parent={cls === "Sensor" ? (parent ?? undefined) : undefined}
          onClose={closeDefine}
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
