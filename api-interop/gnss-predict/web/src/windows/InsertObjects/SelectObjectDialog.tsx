// Select Object (STK ref §G): กล่องเลือกดาวแม่ของ Sensor ก่อน Insert (Define Properties และ Insert Default ของ Sensor เรียกกล่องนี้ก่อนทำอะไร)
// Access tool ใช้กล่องเดียวกันเลือก Access For (choices = Facility และ Satellite, initial = Access For ปัจจุบัน)
// - รายการ = ดาวทั้งหมดใน scenario เลือกได้ตัวเดียว ค่าเริ่มต้นตอนเปิด: ดาวที่เลือกอยู่ใน Object Browser, ไม่ใช่ก็ดาวแม่ของ Sensor ที่เลือกอยู่, ไม่ใช่ก็ดาวตัวแรก
// - OK ส่ง path ของดาวที่เลือกให้ onClose; Cancel, Esc ส่ง null (ผู้เรียกไม่ทำอะไรต่อ) ไม่มีดาวใน scenario = บอกเหตุเป็นภาษาไทยและกด OK ไม่ได้
// - กล่องถูกวาดเฉพาะตอนเปิด (ผู้เรียก mount เมื่อเปิด) จึงเริ่มจากค่าเริ่มต้นทุกครั้ง

import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useReturnFocus } from "../../chrome/returnFocus";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { parentOf, useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { satellitePaths } from "./insert";

export interface SelectObjectDialogProps {
  /** OK = path ของดาวที่เลือก; Cancel / Esc = null */
  onClose(path: string | null): void;
  /** รายการที่เลือกได้ (ไม่ระบุ = ดาวทั้งหมดใน scenario) */
  choices?: readonly string[];
  /** ค่าที่เลือกไว้ตอนเปิด (ไม่ระบุหรือไม่อยู่ในรายการ = ค่าเริ่มต้นตามลำดับข้างล่าง) */
  initial?: string | null;
  /** ชื่อของรายการ (ไม่ระบุ = Satellite) */
  listLabel?: string;
  /** ข้อความเมื่อไม่มีอะไรให้เลือก (ไม่ระบุ = ต้องมีดาวก่อนเพิ่ม Sensor) */
  emptyNote?: string;
}

/** ค่าที่เลือกไว้ก่อน: initial → object ที่เลือกอยู่ → ดาวแม่ของ Sensor ที่เลือกอยู่ → ตัวแรกของรายการ (รายการว่าง = "") */
function initialChoice(paths: readonly string[], initial: string | null): string {
  if (initial !== null && paths.includes(initial)) return initial;
  const active = useSelection.getState().activePath;
  if (active !== null) {
    if (paths.includes(active)) return active;
    const parent = parentOf(active);
    if (parent !== null && paths.includes(parent)) return parent;
  }
  return paths[0] ?? "";
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function SelectObjectDialog({ onClose, choices, initial = null, listLabel, emptyNote }: SelectObjectDialogProps) {
  const doc = useScenario((s) => s.doc);
  const satellites = useMemo(() => satellitePaths(doc), [doc]);
  const paths = choices ?? satellites;
  const [picked, setPicked] = useState(() => initialChoice(paths, initial));
  const returnFocus = useReturnFocus(true); // กล่อง mount เมื่อเปิดเท่านั้น: ปิดแล้วกลับไปที่ปุ่มที่เปิด (Insert...)
  // ดาวที่เลือกไว้หายไประหว่างที่กล่องเปิด (scenario ถูกแก้จากที่อื่น): ใช้ดาวตัวแรกแทน
  const value = paths.includes(picked) ? picked : (paths[0] ?? "");

  const confirm = (path = value): void => {
    if (path !== "") onClose(path);
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    confirm();
  };
  // Enter ในรายการ = OK (รายการเลือกไม่ส่งฟอร์มเอง)
  const enter = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirm();
  };

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content
          className="dlg dlg-form"
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        >
          <Dialog.Title className="dlg-title">{t("window.selectObject")}</Dialog.Title>
          <form className="form" noValidate onSubmit={submit}>
            {paths.length === 0 ? (
              <p className="props-note">{emptyNote ?? msg("insert.noSatellite")}</p>
            ) : (
              <select className="field pick-list" size={8} aria-label={listLabel ?? t("ob.class.satellite")} value={value} onChange={(e) => setPicked(e.target.value)} onKeyDown={enter}>
                {paths.map((path) => (
                  <option key={path} value={path} title={path} onDoubleClick={() => confirm(path)}>
                    {nameOf(path)}
                  </option>
                ))}
              </select>
            )}
            <div className="dlg-buttons">
              <button type="submit" className="btn" disabled={value === ""}>
                {t("dialog.ok")}
              </button>
              <button type="button" className="btn" onClick={() => onClose(null)}>
                {t("dialog.cancel")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
