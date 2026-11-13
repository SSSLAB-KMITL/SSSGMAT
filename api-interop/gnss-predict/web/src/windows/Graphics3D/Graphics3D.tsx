// หน้าต่าง 3D Graphics N - Earth (spec §9.1–§9.2) ส่วน React: แถบเครื่องมือของหน้าต่าง, แถบแจ้งผลลัพธ์, ข้อความแทนภาพเมื่อไม่มี WebGL,
// เวลาบนภาพ (Show Time) และ Shift + ล้อเมาส์ ส่วน Cesium อยู่ใน scene3d.ts (โหลดแบบ dynamic import: Cesium แยก chunk)
// ส่วนที่หน้าต่าง 2D ใช้ด้วย (แถบแจ้ง, การสร้าง/ทำลาย viewer, ข้อความแทนภาพ, Shift + ล้อ) อยู่ใน graphics/GraphicsFrame.tsx
//
// - แถบ 3D Graphics (Home View, View From/To) และ 3D Window Defaults (Properties, Grab Globe, Zoom In) อยู่บนหน้าต่าง 3D (spec §5.2, STK ref §A:
//   "Graphics windows carry ... 3D Window Defaults") แสดง/ซ่อนจาก View → Toolbars ปุ่มเรียกคำสั่งผ่านทะเบียน คำสั่งทำกับหน้าต่างที่ active
//   แตะหน้าต่างนี้ (pointerdown/focus) = หน้าต่างนี้ active ก่อนคำสั่งทำงาน
// - คลิกขวาบนดาวหรือ Facility (sensor spec §5.5) = เลือก object ที่ชี้แล้วเปิดเมนูของมัน (sceneMenuFor) คำสั่งทำกับ object ที่เลือกและหน้าต่างที่ active
//   คลิกขวาที่ว่าง = ไม่มีเมนู (และไม่ให้ browser เปิดเมนูของมันเอง) คลิกซ้ายเลือก object อยู่ใน scene3d.ts (pick.ts)

import { Binoculars, Hand, House, SlidersHorizontal, ZoomIn } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { CommandContextMenu } from "../../chrome/ContextMenu";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { sceneMenuFor, type MenuEntry } from "../../chrome/menus";
import { TipProvider } from "../../chrome/Tip";
import { ToolButton } from "../../chrome/ToolButton";
import { t } from "../../labels/labels";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { ResultsBanner, SceneFailedBanner, SceneMessage, useSceneMount, useShiftWheelSteps } from "../graphics/GraphicsFrame";
import { selectScenePath } from "./pick";
import { props3d } from "./props";
import { getScene, markActive, registerScene, registry3d, scenesVersion, subscribeScenes } from "./registry";

/** แถบ 3D Graphics และ 3D Window Defaults ของหน้าต่างนี้ (ซ่อนได้จาก View → Toolbars) */
function WindowToolbars({ panelId }: { panelId: string }) {
  const showGraphics = useLayout((s) => s.toolbars.graphics3d);
  const showDefaults = useLayout((s) => s.toolbars.defaults3d);
  useSyncExternalStore(subscribeScenes, scenesVersion);
  const mode = getScene(panelId)?.mouseMode() ?? "grab";
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
  // เมนูของ object ที่คลิกขวา (ว่าง = ไม่มีเมนู)
  const [menu, setMenu] = useState<readonly MenuEntry[]>([]);

  /** ทำก่อนที่เมนูเปิด: หา object ใต้เมาส์ (พิกัดใน canvas ซึ่งเต็มพื้นที่ของ host) เลือกมัน แล้วเลือกเมนู ไม่มี object = ไม่ให้เมนูเปิด */
  const onContextMenuCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const path = getScene(panelId)?.pathAt(e.clientX - rect.left, e.clientY - rect.top) ?? null;
    const entries = sceneMenuFor(path);
    setMenu(entries);
    if (path === null || entries.length === 0) {
      e.preventDefault(); // ไม่ให้ browser เปิดเมนูของมันเอง (Cesium ก็ทำแบบนี้)
      e.stopPropagation(); // และไม่ถึง Trigger ของเมนู
      return;
    }
    selectScenePath(path);
  };

  return (
    <div className="gfx" onPointerDownCapture={() => markActive(panelId)} onFocusCapture={() => markActive(panelId)}>
      <WindowToolbars panelId={panelId} />
      <ResultsBanner />
      <SceneFailedBanner registry={registry3d} panelId={panelId} window="3D" />
      <div className="gfx-stage">
        <CommandContextMenu entries={menu}>
          <div className="gfx-view" ref={host} data-testid="g3d-view" onContextMenuCapture={onContextMenuCapture} />
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
