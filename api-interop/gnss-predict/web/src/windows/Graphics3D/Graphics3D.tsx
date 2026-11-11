// หน้าต่าง 3D Graphics N - Earth (spec §9.1–§9.2) ส่วน React: แถบเครื่องมือของหน้าต่าง, แถบแจ้งผลลัพธ์, ข้อความแทนภาพเมื่อไม่มี WebGL,
// เวลาบนภาพ (Show Time) และ Shift + ล้อเมาส์ ส่วน Cesium อยู่ใน scene3d.ts (โหลดแบบ dynamic import: Cesium แยก chunk)
//
// - แถบ 3D Graphics (Home View, View From/To) และ 3D Window Defaults (Properties, Grab Globe, Zoom In) อยู่บนหน้าต่าง 3D (spec §5.2, STK ref §A:
//   "Graphics windows carry ... 3D Window Defaults") แสดง/ซ่อนจาก View → Toolbars ปุ่มเรียกคำสั่งผ่านทะเบียน คำสั่งทำกับหน้าต่างที่ active
//   แตะหน้าต่างนี้ (pointerdown/focus) = หน้าต่างนี้ active ก่อนคำสั่งทำงาน
// - แถบเหนือภาพเมื่อผล `stale` หรือ `missing` (spec §9.1) ปุ่ม Apply = POST /propagate (GMAT ในเครื่อง ไม่ดาวน์โหลด: ไม่ต้องขอความยินยอม)
//   ใส่ job queued ใน useJobs ทันที ปิดปุ่มระหว่างที่ scenario มีงานค้าง
// - เครื่องไม่มี WebGL (หรือสร้าง viewer ไม่ได้) = ข้อความไทยแทนภาพ หน้าต่างอื่นยังใช้ได้; โหลดไฟล์ส่วนแสดงผล 3D ไม่ได้ = ข้อความของตัวเอง
// - โหลดผลลัพธ์เข้าภาพไม่สำเร็จ (sceneFailed) = แถบไทยเหนือภาพจนกว่าการลองใหม่จะสำเร็จ
// - Shift + ล้อเมาส์บนภาพ = Step Forward (หมุนขึ้น) / Step Backward (หมุนลง) ผ่านคำสั่ง anim.* ล้อเฉย ๆ ซูมตามปกติของ Cesium
// - panel เปลี่ยนขนาด → viewer.resize() (spec §17 W3)

import { Binoculars, Hand, House, SlidersHorizontal, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorText } from "../../api/client";
import { startJob } from "../../api/startJob";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { TipProvider } from "../../chrome/Tip";
import { ToolButton } from "../../chrome/ToolButton";
import { runCommand } from "../../commands";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useJobs } from "../../stores/jobs";
import { useLayout, usePanelResize } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { props3d } from "./props";
import { getScene, markActive, registerScene, scenesVersion, subscribeScenes, type Scene3DHandle } from "./registry";

/** browser มี WebGL ไหม (jsdom และ browser ที่ปิด WebGL ไม่มี WebGLRenderingContext: ไม่ต้องโหลด Cesium เลย) */
export const webglAvailable = (): boolean => typeof window !== "undefined" && typeof window.WebGLRenderingContext !== "undefined";

type ViewState = "loading" | "ready" | "nowebgl" | "chunkFailed";

/** แถบเหนือภาพเมื่อผลลัพธ์ไม่ตรงกับ scenario หรือยังไม่มี พร้อมปุ่ม Apply */
function ResultsBanner() {
  const name = useScenario((s) => s.name);
  const status = useResults((s) => s.status);
  const error = useResults((s) => s.info?.error ?? null);
  const job = useJobs((s) => (name === null ? undefined : s.activeFor(name)));
  const [sending, setSending] = useState(false);
  if (name === null || (status !== "stale" && status !== "missing")) return null;

  const busy = sending || job !== undefined;
  const apply = async (): Promise<void> => {
    setSending(true);
    try {
      await startJob(`/scenarios/${encodeURIComponent(name)}/propagate`, "propagate", name);
    } catch (e) {
      report("error", "PROPAGATE", msg("banner.applyFailed", { message: errorText(e) }));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="g3d-banner" role="status">
      <div className="g3d-banner-text">
        <span>{msg(status === "stale" ? "banner.stale" : "banner.missing")}</span>
        {error !== null && <span className="g3d-banner-error">{error.text}</span>}
        {job !== undefined && <span className="g3d-banner-note">{msg("banner.running")}</span>}
      </div>
      <button type="button" className="btn" disabled={busy} title={job !== undefined ? msg("banner.running") : undefined} onClick={() => void apply()}>
        {t("dialog.apply")}
      </button>
    </div>
  );
}

/** แถบเหนือภาพเมื่อโหลดผลลัพธ์เข้าภาพไม่สำเร็จ (แสดงเฉพาะ Facility อยู่ และจะลองใหม่ใน refresh ถัดไป) */
function SceneFailedBanner({ panelId }: { panelId: string }) {
  useSyncExternalStore(subscribeScenes, scenesVersion);
  if (getScene(panelId)?.sceneFailed() !== true) return null;
  return (
    <div className="g3d-banner" role="status">
      <div className="g3d-banner-text">{msg("banner.sceneFailed")}</div>
    </div>
  );
}

/** แถบ 3D Graphics และ 3D Window Defaults ของหน้าต่างนี้ (ซ่อนได้จาก View → Toolbars) */
function WindowToolbars({ panelId }: { panelId: string }) {
  const showGraphics = useLayout((s) => s.toolbars.graphics3d);
  const showDefaults = useLayout((s) => s.toolbars.defaults3d);
  useSyncExternalStore(subscribeScenes, scenesVersion);
  const mode = getScene(panelId)?.mouseMode() ?? "grab";
  if (!showGraphics && !showDefaults) return null;
  return (
    <TipProvider>
      <div className="g3d-toolbars">
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
  const scene = useRef<Scene3DHandle | null>(null);
  const [view, setView] = useState<ViewState>("loading");
  const showTime = useLayout((s) => props3d(s.windowProps[panelId]).showTime);
  const open = useScenario((s) => s.name !== null);

  // viewer ของหน้าต่างนี้: สร้างเมื่อ mount ทำลายเมื่อ unmount (StrictMode: รอบแรกถูกยกเลิกก่อน Cesium โหลดเสร็จ)
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    if (!webglAvailable()) {
      setView("nowebgl");
      return;
    }
    let disposed = false;
    let handle: Scene3DHandle | null = null;
    let unregister: (() => void) | null = null;
    import("./scene3d")
      .then(({ mountScene3D }) => {
        if (disposed) return;
        try {
          handle = mountScene3D(panelId, el);
        } catch (e) {
          el.replaceChildren(); // กล่อง error ภาษาอังกฤษที่ Cesium วาดไว้
          console.error("3D viewer could not start", e);
          setView("nowebgl");
          return;
        }
        scene.current = handle;
        unregister = registerScene(handle);
        setView("ready");
      })
      .catch((e: unknown) => {
        if (disposed) return;
        report("error", "SCENE_CHUNK", msg("g3d.chunkFailedLog", { message: errorText(e) }));
        setView("chunkFailed");
      });
    return () => {
      disposed = true;
      unregister?.();
      handle?.destroy();
      scene.current = null;
    };
  }, [panelId]);

  usePanelResize(panelId, () => scene.current?.resize());

  // Shift + ล้อเมาส์: ฟังช่วง capture บนกรอบของภาพ แล้วหยุดไม่ให้ถึง canvas ของ Cesium (ล้อเฉย ๆ ผ่านไปซูมตามปกติ)
  // macOS แปลง Shift + ล้อเป็นการเลื่อนแนวนอน (deltaY = 0, deltaX ≠ 0) จึงใช้ deltaX แทนเมื่อไม่มี deltaY
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta < 0) runCommand("anim.stepForward");
      else if (delta > 0) runCommand("anim.stepBackward");
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return (
    <div className="g3d" onPointerDownCapture={() => markActive(panelId)} onFocusCapture={() => markActive(panelId)}>
      <WindowToolbars panelId={panelId} />
      <ResultsBanner />
      <SceneFailedBanner panelId={panelId} />
      <div className="g3d-stage">
        <div className="g3d-view" ref={host} data-testid="g3d-view" />
        {(view === "nowebgl" || view === "chunkFailed") && (
          <div className="g3d-message" role="alert">
            {msg(view === "nowebgl" ? "webgl.unsupported" : "g3d.chunkFailed")}
          </div>
        )}
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
