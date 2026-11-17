// หน้าต่าง 3D Graphics N - Earth (spec §9.1–§9.2) ส่วน React: แถบเครื่องมือของหน้าต่าง, แถบแจ้งผลลัพธ์, ข้อความแทนภาพเมื่อไม่มี WebGL,
// เวลาบนภาพ (Show Time) และ Shift + ล้อเมาส์ ส่วน Cesium อยู่ใน scene3d.ts (โหลดแบบ dynamic import: Cesium แยก chunk)
// ส่วนที่หน้าต่าง 2D ใช้ด้วย (แถบแจ้ง, การสร้าง/ทำลาย viewer, ข้อความแทนภาพ, Shift + ล้อ) อยู่ใน graphics/GraphicsFrame.tsx
//
// - แถบ 3D Graphics (Home View, View From/To) และ 3D Window Defaults (Properties, Grab Globe, Zoom In) อยู่บนหน้าต่าง 3D (spec §5.2, STK ref §A:
//   "Graphics windows carry ... 3D Window Defaults") แสดง/ซ่อนจาก View → Toolbars ปุ่มเรียกคำสั่งผ่านทะเบียน คำสั่งทำกับหน้าต่างที่ active
//   แตะหน้าต่างนี้ (pointerdown/focus) = หน้าต่างนี้ active ก่อนคำสั่งทำงาน
// - คลิกขวาบนดาวหรือ Facility (sensor spec §5.5) = เลือก object ที่ชี้แล้วเปิดเมนูของมัน (sceneMenuFor) คำสั่งทำกับ object ที่เลือกและหน้าต่างที่ active
//   คลิกขวาที่ว่างโดยไม่ลาก = เมนูของหน้าต่าง (SCENE_WINDOW_3D_MENU: Show Orbits, task 13c) ลากปุ่มขวา (ซูมของ Cesium) = ไม่มีเมนู
//   ไม่มีเมนูของ browser บนภาพ (graphics/sceneMenu.ts) คลิกซ้ายเลือก object อยู่ใน scene3d.ts (pick.ts)
// - Show Orbits (task 13c): ปุ่มบนแถบ 3D Window Defaults กดค้างตาม props.showOrbits ของหน้าต่างนี้ เรียกคำสั่ง g3d.showOrbits (commands3d.ts)

import { Binoculars, Hand, House, Orbit, SlidersHorizontal, ZoomIn } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { CommandContextMenu } from "../../chrome/ContextMenu";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { SCENE_WINDOW_3D_MENU, sceneMenuFor } from "../../chrome/menus";
import { TipProvider } from "../../chrome/Tip";
import { ToolButton } from "../../chrome/ToolButton";
import { t } from "../../labels/labels";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { ResultsBanner, SceneFailedBanner, SceneMessage, useSceneMount, useShiftWheelSteps } from "../graphics/GraphicsFrame";
import { useSceneMenu } from "../graphics/sceneMenu";
import { props3d } from "./props";
import { getScene, markActive, registerScene, registry3d, scenesVersion, subscribeScenes } from "./registry";

/** แถบ 3D Graphics และ 3D Window Defaults ของหน้าต่างนี้ (ซ่อนได้จาก View → Toolbars) */
function WindowToolbars({ panelId }: { panelId: string }) {
  const showGraphics = useLayout((s) => s.toolbars.graphics3d);
  const showDefaults = useLayout((s) => s.toolbars.defaults3d);
  useSyncExternalStore(subscribeScenes, scenesVersion);
  const mode = getScene(panelId)?.mouseMode() ?? "grab";
  const showOrbits = useLayout((s) => props3d(s.windowProps[panelId]).showOrbits);
  if (!showGraphics && !showDefaults) return null;
  return (
    <TipProvider>
      <div className="gfx-toolbars">
        {showGraphics && (
          <div className="toolbar" role="toolbar" aria-label={t("toolbar.graphics3d")}>
            <ToolButton command="g3d.homeView" label="toolbar.homeView" icon={House} />
            <ToolButton command="g3d.viewFromTo" label="toolbar.viewFromTo" icon={Binoculars} />
          </div>
        )}
        {showDefaults && (
          <div className="toolbar" role="toolbar" aria-label={t("toolbar.window3dDefaults")}>
            <ToolButton command="g3d.properties" label="toolbar.properties" icon={SlidersHorizontal} />
            <ToolButton command="g3d.grabGlobe" label="toolbar.grabGlobe" icon={Hand} pressed={mode === "grab"} />
            <ToolButton command="g3d.zoomIn" label="toolbar.zoomIn" icon={ZoomIn} pressed={mode === "zoomIn"} />
            <ToolButton command="g3d.showOrbits" label="field.showOrbits" icon={Orbit} pressed={showOrbits} />
          </div>
        )}
      </div>
    </TipProvider>
  );
}

/** Annotation → Show Time: เวลา animation ตาม DateFormat ของ scenario ที่มุมภาพ */
function TimeAnnotation() {
  const { format } = useTimeFormatter();
  const time = useThrottledTime();
  return <div className="g3d-time">{format(time)}</div>;
}

export function Graphics3D({ panelId }: PanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const showTime = useLayout((s) => props3d(s.windowProps[panelId]).showTime);
  const open = useScenario((s) => s.name !== null);
  const { view } = useSceneMount({
    panelId,
    host,
    window: "3D",
    load: () => import("./scene3d"),
    create: (m, el, stopped) => m.mountScene3D(panelId, el, stopped),
    register: registerScene,
  });
  useShiftWheelSteps(host);
  // เมนูคลิกขวา: object ใต้เมาส์ (พิกัดใน canvas ซึ่งเต็มพื้นที่ของ host) เลือกมันแล้วเปิดเมนูของมัน ที่ว่างโดยไม่ลาก = เมนูของหน้าต่าง
  const menu = useSceneMenu({
    objectAt: (x, y) => getScene(panelId)?.pathAt(x, y) ?? null,
    objectMenu: sceneMenuFor,
    windowMenu: SCENE_WINDOW_3D_MENU,
  });

  return (
    <div className="gfx" onPointerDownCapture={() => markActive(panelId)} onFocusCapture={() => markActive(panelId)}>
      <WindowToolbars panelId={panelId} />
      <ResultsBanner />
      <SceneFailedBanner registry={registry3d} panelId={panelId} window="3D" />
      <div className="gfx-stage">
        <CommandContextMenu entries={menu.entries}>
          <div className="gfx-view" ref={host} data-testid="g3d-view" {...menu.handlers} />
        </CommandContextMenu>
        <SceneMessage view={view} window="3D" />
        {view === "ready" && open && showTime && <TimeAnnotation />}
      </div>
    </div>
  );
}

/** ลงทะเบียนหน้าต่าง 3D Graphics (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerGraphics3DPanel(): void {
  const base = getPanelDef("graphics3d");
  if (base === undefined) throw new Error('panel kind "graphics3d" is not registered');
  registerPanel("graphics3d", { ...base, component: Graphics3D });
}
