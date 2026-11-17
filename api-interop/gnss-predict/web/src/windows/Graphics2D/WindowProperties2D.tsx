// 2D Graphics Window Properties (spec §9.3, STK ref §E): ค่าตั้งของหน้าต่าง 2D บานที่ params.target ชี้ (เปิดจากปุ่ม Properties ของแถบ 2D Window Defaults)
// - Projection: Projection (Equidistant Cylindrical / Mercator), Display Coordinate Frame (ECF เท่านั้นใน v1 พร้อมหมายเหตุไทย)
// - Details: Lat/Lon Lines, Show IPP (ของเราเอง), Show Ground Tracks (ของเราเอง, task 13c)
// - Lighting: Show Outline (เส้นแบ่งกลางวันกลางคืน), Shading (พื้นที่กลางคืน)
// Apply เขียน useLayout.windowProps[target] (ไปกับ workbook เมื่อ Save) หน้าต่าง 2D ปรับภาพทันที (Projection: สร้างภาพใหม่ที่พื้นที่เดิม)
// แท็บ ปุ่ม และกรณีหน้าต่างเป้าหมายถูกปิด อยู่ในกรอบร่วม graphics/WindowPropertiesShell.tsx

import { useEffect, useState } from "react";
import { FormField } from "../../chrome/FormField";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { CheckField, useTargetWindow, WindowPropertiesShell } from "../graphics/WindowPropertiesShell";
import { isProjection, props2d, PROJECTIONS, type Props2D } from "./props2d";

type PageId = "projection" | "details" | "lighting";
const PAGES: { id: PageId; title: LabelKey }[] = [
  { id: "projection", title: "page.window2d.projection" },
  { id: "details", title: "page.window2d.details" },
  { id: "lighting", title: "page.window2d.lighting" },
];

const PROJECTION_LABELS: Record<Props2D["projection"], LabelKey> = {
  equidistantCylindrical: "option.projection.equidistantCylindrical",
  mercator: "option.projection.mercator",
};

type BoolKey = "latLonLines" | "showIpp" | "showOutline" | "shading" | "showGroundTracks";

export function WindowProperties2D({ params, panelId }: PanelProps) {
  const { target, stored, exists } = useTargetWindow(params);
  const [draft, setDraft] = useState<Props2D>(() => props2d(stored));
  const [page, setPage] = useState<PageId>("projection");

  // เปิดซ้ำให้หน้าต่าง 2D บานอื่น (singleton ได้ target ใหม่) = ค่าของบานนั้น
  useEffect(() => {
    setDraft(props2d(useLayout.getState().windowProps[target ?? ""]));
  }, [target]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(props2d(stored));
  const apply = (): boolean => {
    if (target === null || !exists) return false;
    useLayout.getState().setWindowProps(target, { ...draft });
    return true;
  };
  const check = (k: BoolKey, label: LabelKey) => (
    <CheckField label={label} checked={draft[k]} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
  );

  return (
    <WindowPropertiesShell<PageId>
      panelId={panelId}
      title="window.properties2d"
      pages={PAGES}
      page={page}
      onPage={setPage}
      exists={exists}
      noWindow={msg("g2d.noWindow")}
      dirty={dirty}
      apply={apply}
    >
      {page === "projection" && (
        <>
          <FormField label={t("field.projection")}>
            {(control) => (
              <select
                {...control}
                value={draft.projection}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isProjection(v)) setDraft((d) => ({ ...d, projection: v }));
                }}
              >
                {PROJECTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(PROJECTION_LABELS[p])}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t("field.displayCoordinateFrame")}>
            {(control) => (
              <select {...control} value="ECF" onChange={() => undefined}>
                <option value="ECF">{t("option.coordFrame.ecf")}</option>
              </select>
            )}
          </FormField>
          <p className="props-note">{msg("g2d.coordFrameNote")}</p>
        </>
      )}
      {page === "details" && (
        <>
          {check("latLonLines", "field.latLonLines")}
          {check("showGroundTracks", "field.showGroundTracks")}
          {check("showIpp", "field.showIpp")}
          <p className="props-note">{msg("g2d.ippNote")}</p>
        </>
      )}
      {page === "lighting" && (
        <>
          {check("showOutline", "field.showOutline")}
          {check("shading", "field.shading")}
          <p className="props-note">{msg("g2d.lightingNote")}</p>
        </>
      )}
    </WindowPropertiesShell>
  );
}

/** ลงทะเบียน 2D Graphics Window Properties (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerWindowProperties2DPanel(): void {
  const base = getPanelDef("windowProperties2d");
  if (base === undefined) throw new Error('panel kind "windowProperties2d" is not registered');
  registerPanel("windowProperties2d", { ...base, component: WindowProperties2D });
}
