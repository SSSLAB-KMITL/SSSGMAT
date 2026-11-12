// 3D Graphics Window Properties (spec §9.2, STK ref §E): ค่าตั้งของหน้าต่าง 3D บานที่ params.target ชี้ (เปิดจากปุ่ม Properties ของแถบ 3D Window Defaults)
// - หน้า Lighting (Enable Lighting, Ambient Level, Sun Level, Night Lights Level), Details (Lat/Lon Lines, Label Declutter), Annotation (Show Time)
// - Apply เขียน useLayout.windowProps[target] (ไปกับ workbook เมื่อ Save) หน้าต่าง 3D อ่านค่าแล้วปรับภาพทันที ไม่โหลดอะไรใหม่
//   OK = Apply แล้วปิด, Cancel = ปิดโดยไม่เปลี่ยน ระดับแสงเป็นเปอร์เซ็นต์ 0–100 ตรวจด้วยกติกาตัวเลขเดียวของแอป (parseDecimal)
//   แท็บ ปุ่ม และกรณีหน้าต่างเป้าหมายถูกปิด อยู่ในกรอบร่วม graphics/WindowPropertiesShell.tsx (ใช้กับหน้าต่าง 2D ด้วย)
// - การจับคู่กับ Cesium อธิบายใน scene3d.ts (applyProps) Night Lights ไม่มีภาพในโหมดออฟไลน์: แสดงหมายเหตุไทย

import { useEffect, useState, type ReactNode } from "react";
import { FormField } from "../../chrome/FormField";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { parseDecimal } from "../fieldRules";
import { CheckField, useTargetWindow, WindowPropertiesShell } from "../graphics/WindowPropertiesShell";
import { props3d, type LevelKey, type Props3D } from "./props";

type PageId = "lighting" | "details" | "annotation";
const PAGES: { id: PageId; title: LabelKey }[] = [
  { id: "lighting", title: "page.window3d.lighting" },
  { id: "details", title: "page.window3d.details" },
  { id: "annotation", title: "page.window3d.annotation" },
];

type BoolKey = "enableLighting" | "latLonLines" | "labelDeclutter" | "showTime";
/** ค่าในฟอร์ม: ระดับเป็นข้อความตามที่พิมพ์ ตรวจตอน Apply */
type Draft = Record<BoolKey, boolean> & Record<LevelKey, string>;

const draftOf = (p: Props3D): Draft => ({
  enableLighting: p.enableLighting,
  latLonLines: p.latLonLines,
  labelDeclutter: p.labelDeclutter,
  showTime: p.showTime,
  ambientLevel: String(p.ambientLevel),
  sunLevel: String(p.sunLevel),
  nightLightsLevel: String(p.nightLightsLevel),
});

const LEVELS: LevelKey[] = ["ambientLevel", "sunLevel", "nightLightsLevel"];

export function WindowProperties3D({ params, panelId }: PanelProps) {
  const { target, stored, exists } = useTargetWindow(params);
  const [draft, setDraft] = useState<Draft>(() => draftOf(props3d(stored)));
  const [errors, setErrors] = useState<Partial<Record<LevelKey, string>>>({});
  const [page, setPage] = useState<PageId>("lighting");

  // เปิดซ้ำให้หน้าต่าง 3D บานอื่น (singleton ได้ target ใหม่) = ค่าของบานนั้น
  useEffect(() => {
    setDraft(draftOf(props3d(useLayout.getState().windowProps[target ?? ""])));
    setErrors({});
  }, [target]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(props3d(stored)));

  const apply = (): boolean => {
    if (target === null || !exists) return false;
    const next: Partial<Record<LevelKey, string>> = {};
    const levels: Partial<Record<LevelKey, number>> = {};
    for (const k of LEVELS) {
      const r = parseDecimal(draft[k], { min: 0, max: 100 });
      if (r.ok) levels[k] = r.value;
      else next[k] = r.error;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setPage("lighting");
      return false;
    }
    const value: Props3D = {
      enableLighting: draft.enableLighting,
      ambientLevel: levels.ambientLevel!,
      sunLevel: levels.sunLevel!,
      nightLightsLevel: levels.nightLightsLevel!,
      latLonLines: draft.latLonLines,
      labelDeclutter: draft.labelDeclutter,
      showTime: draft.showTime,
    };
    useLayout.getState().setWindowProps(target, { ...value });
    return true;
  };

  const check = (k: BoolKey, label: LabelKey) => (
    <CheckField label={label} checked={draft[k]} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
  );
  const level = (k: LevelKey, label: LabelKey, hint?: ReactNode) => (
    <FormField label={t(label)} error={errors[k]} hint={hint ?? t("field.unit.percent")}>
      {(control) => (
        <input
          {...control}
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          value={draft[k]}
          onChange={(e) => {
            const v = e.target.value;
            setDraft((d) => ({ ...d, [k]: v }));
            setErrors((x) => ({ ...x, [k]: undefined }));
          }}
        />
      )}
    </FormField>
  );

  return (
    <WindowPropertiesShell<PageId>
      panelId={panelId}
      title="window.properties3d"
      pages={PAGES}
      page={page}
      onPage={setPage}
      exists={exists}
      noWindow={msg("g3d.noWindow")}
      dirty={dirty}
      apply={apply}
    >
      {page === "lighting" && (
        <>
          {check("enableLighting", "field.enableLighting")}
          {level("ambientLevel", "field.ambientLevel")}
          {level("sunLevel", "field.sunLevel")}
          {level("nightLightsLevel", "field.nightLightsLevel")}
          <p className="props-note">{msg("g3d.lightingNote")}</p>
          <p className="props-note">{msg("g3d.nightLightsNote")}</p>
        </>
      )}
      {page === "details" && (
        <>
          {check("latLonLines", "field.latLonLines")}
          {check("labelDeclutter", "field.labelDeclutter")}
        </>
      )}
      {page === "annotation" && check("showTime", "field.showTime")}
    </WindowPropertiesShell>
  );
}

/** ลงทะเบียน 3D Graphics Window Properties (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerWindowProperties3DPanel(): void {
  const base = getPanelDef("windowProperties3d");
  if (base === undefined) throw new Error('panel kind "windowProperties3d" is not registered');
  registerPanel("windowProperties3d", { ...base, component: WindowProperties3D });
}
