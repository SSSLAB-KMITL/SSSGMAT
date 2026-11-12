// หน้าต่าง 2D Graphics N - Earth (spec §9.1, §9.3) ส่วน React: แถบ 2D Window Defaults, แถบแจ้งผลลัพธ์, ข้อความแทนภาพเมื่อไม่มี WebGL
// และ Shift + ล้อเมาส์ (ส่วนร่วมกับหน้าต่าง 3D อยู่ใน graphics/GraphicsFrame.tsx) ส่วน Cesium อยู่ใน scene2d.ts (dynamic import: Cesium แยก chunk)
//
// - แถบ 2D Window Defaults (Properties, Zoom In, Zoom Out) อยู่บนหน้าต่าง 2D (STK ref §A: "Graphics windows carry 2D Window Defaults")
//   แสดง/ซ่อนจาก View → Toolbars ปุ่มเรียกคำสั่ง g2d.* ผ่านทะเบียน คำสั่งทำกับหน้าต่าง 2D ที่ active (แตะหน้าต่างนี้ = active)
// - Projection เปลี่ยน = สร้าง viewer ใหม่ (Cesium ตั้ง map projection ได้ตอนสร้างเท่านั้น) โดยจำพื้นที่ที่เห็นอยู่ไว้ให้ตัวใหม่

import { SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { TipProvider } from "../../chrome/Tip";
import { ToolButton } from "../../chrome/ToolButton";
import { t } from "../../labels/labels";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { ResultsBanner, SceneFailedBanner, SceneMessage, useSceneMount, useShiftWheelSteps } from "../graphics/GraphicsFrame";
import { props2d } from "./props2d";
import { getScene2D, markActive2D, registerScene2D, registry2d, scenes2DVersion, subscribeScenes2D, type ViewRect } from "./registry2d";

/** แถบ 2D Window Defaults ของหน้าต่างนี้ (ซ่อนได้จาก View → Toolbars) */
function WindowToolbar({ panelId }: { panelId: string }) {
  const show = useLayout((s) => s.toolbars.defaults2d);
  useSyncExternalStore(subscribeScenes2D, scenes2DVersion);
  const mode = getScene2D(panelId)?.mouseMode() ?? "grab";
  if (!show) return null;
  return (
    <TipProvider>
      <div className="gfx-toolbars">
        <div className="toolbar" role="toolbar" aria-label={t("toolbar.window2dDefaults")}>
          <ToolButton command="g2d.properties" label="toolbar.properties" icon={SlidersHorizontal} />
          <ToolButton command="g2d.zoomIn" label="toolbar.zoomIn" icon={ZoomIn} pressed={mode === "zoomIn"} />
          <ToolButton command="g2d.zoomOut" label="toolbar.zoomOut" icon={ZoomOut} />
        </div>
      </div>
    </TipProvider>
  );
}

export function Graphics2D({ panelId }: PanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const projection = useLayout((s) => props2d(s.windowProps[panelId]).projection);
  /** พื้นที่ที่ viewer ตัวก่อนเห็นอยู่ (ส่งต่อให้ตัวใหม่หลังเปลี่ยน Projection) */
  const lastView = useRef<ViewRect | null>(null);
  const { view } = useSceneMount({
    panelId,
    host,
    window: "2D",
    load: () => import("./scene2d"),
    create: (m, el, stopped) => m.mountScene2D(panelId, el, { projection, view: lastView.current }, stopped),
    register: registerScene2D,
    remountKey: projection,
    beforeDestroy: (handle) => {
      lastView.current = handle.viewRectangle();
    },
  });
  useShiftWheelSteps(host);

  return (
    <div className="gfx" onPointerDownCapture={() => markActive2D(panelId)} onFocusCapture={() => markActive2D(panelId)}>
      <WindowToolbar panelId={panelId} />
      <ResultsBanner />
      <SceneFailedBanner registry={registry2d} panelId={panelId} window="2D" />
      <div className="gfx-stage">
        <div className="gfx-view" ref={host} data-testid="g2d-view" />
        <SceneMessage view={view} window="2D" />
      </div>
    </div>
  );
}

/** ลงทะเบียนหน้าต่าง 2D Graphics (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerGraphics2DPanel(): void {
  const base = getPanelDef("graphics2d");
  if (base === undefined) throw new Error('panel kind "graphics2d" is not registered');
  registerPanel("graphics2d", { ...base, component: Graphics2D });
}
