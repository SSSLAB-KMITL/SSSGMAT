// View From/To (spec §9.2, STK ref §E): กล้องของหน้าต่าง 3D อยู่ที่ object หนึ่งแล้วมองไปที่อีก object (เช่น THBK มองขึ้นไปหา G01)
// - Mode: From Position to Position (แบบเดียวของ v1), From Position / To Position = Facility หรือ Satellite ของ scenario, Reference Frame = Fixed / Inertial
// - Apply สั่งหน้าต่าง 3D บานที่ params.target ชี้ (ไม่มี = บานที่ active) กล้องตามไปเองเมื่อเวลาเดิน:
//   Fixed = camera.lookAtTransform ที่ตำแหน่ง To ในแกนของโลก, Inertial = แกน ICRF (Transforms.computeIcrfToFixedMatrix) เป็นกรอบของกล้อง
//   (โลกหมุนอยู่ใต้กล้อง) รายละเอียดใน scene3d.ts (updateFromTo)
// - OK = Apply แล้วปิด, Cancel = ปิด object ที่หาในภาพไม่เจอ (ยังไม่มีผลลัพธ์ ถูกซ่อน) ได้ข้อความไทยที่ปุ่ม

import { useEffect, useMemo, useState } from "react";
import { FormField } from "../../chrome/FormField";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { activeScene, getScene, type ReferenceFrame } from "../Graphics3D/registry";

const MODE = "fromPositionToPosition";

export function ViewFromTo({ params, panelId }: PanelProps) {
  const target = typeof params?.target === "string" ? params.target : null;
  const doc = useScenario((s) => s.doc);
  const choices = useMemo(
    () => (doc?.objects ?? []).filter((o) => o.class === "Facility" || o.class === "Satellite").map((o) => ({ path: `*/${o.class}/${o.name}`, name: o.name })),
    [doc],
  );
  const firstOf = (cls: string): string => choices.find((c) => c.path.startsWith(`*/${cls}/`))?.path ?? choices[0]?.path ?? "";
  const [from, setFrom] = useState(() => firstOf("Facility"));
  const [to, setTo] = useState(() => firstOf("Satellite"));
  const [frame, setFrame] = useState<ReferenceFrame>("fixed");
  const [error, setError] = useState<string | null>(null);

  // object ที่เลือกไว้ถูกลบหรือเปลี่ยนชื่อ: กลับไปตัวตั้งต้น
  useEffect(() => {
    if (!choices.some((c) => c.path === from)) setFrom(firstOf("Facility"));
    if (!choices.some((c) => c.path === to)) setTo(firstOf("Satellite"));
  }, [choices]); // ตามรายการ object เท่านั้น (from/to ที่ยังอยู่ในรายการคงไว้)

  const close = (): void => useLayout.getState().closePanel(panelId);
  const apply = (): boolean => {
    if (from === to) {
      setError(msg("viewFromTo.same"));
      return false;
    }
    const scene = (target === null ? undefined : getScene(target)) ?? activeScene();
    if (scene === undefined || !scene.viewFromTo({ from, to, frame })) {
      setError(msg("viewFromTo.notFound"));
      return false;
    }
    setError(null);
    return true;
  };

  const picker = (label: string, value: string, set: (v: string) => void) => (
    <FormField label={label}>
      {(control) => (
        <select
          {...control}
          value={value}
          onChange={(e) => {
            set(e.target.value);
            setError(null);
          }}
        >
          {choices.map((c) => (
            <option key={c.path} value={c.path}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );

  return (
    <div className="form vft">
      <FormField label={t("field.mode")}>
        {(control) => (
          <select {...control} value={MODE} onChange={() => undefined}>
            <option value={MODE}>{t("option.viewMode.fromPositionToPosition")}</option>
          </select>
        )}
      </FormField>
      {picker(t("field.fromPosition"), from, setFrom)}
      {picker(t("field.toPosition"), to, setTo)}
      <FormField label={t("field.referenceFrame")}>
        {(control) => (
          <select {...control} value={frame} onChange={(e) => setFrame(e.target.value as ReferenceFrame)}>
            <option value="fixed">{t("option.referenceFrame.fixed")}</option>
            <option value="inertial">{t("option.referenceFrame.inertial")}</option>
          </select>
        )}
      </FormField>
      {choices.length === 0 && <p className="props-note">{msg("viewFromTo.noObjects")}</p>}
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-buttons">
        <button
          type="button"
          className="btn"
          disabled={choices.length === 0}
          onClick={() => {
            if (apply()) close();
          }}
        >
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button type="button" className="btn" disabled={choices.length === 0} onClick={() => void apply()}>
          {t("dialog.apply")}
        </button>
      </div>
    </div>
  );
}

/** ลงทะเบียน View From/To (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerViewFromToPanel(): void {
  const base = getPanelDef("viewFromTo");
  if (base === undefined) throw new Error('panel kind "viewFromTo" is not registered');
  registerPanel("viewFromTo", { ...base, component: ViewFromTo, size: { width: 420, height: 280 } });
}
