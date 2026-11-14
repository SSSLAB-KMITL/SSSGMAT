// ส่วนร่วมของหน้าต่าง 3D และ 2D ฝั่ง React (spec §9.1): แถบแจ้งผลลัพธ์, แถบแจ้งเมื่อโหลดผลเข้าภาพไม่สำเร็จ, ข้อความแทนภาพ,
// การสร้าง/ทำลาย viewer (dynamic import ของส่วน Cesium) และ Shift + ล้อเมาส์ ไม่ import Cesium
//
// - แถบเหนือภาพเมื่อผล `stale` หรือ `missing` ปุ่ม Apply = POST /propagate (GMAT ในเครื่อง ไม่ดาวน์โหลด: ไม่ต้องขอความยินยอม)
//   ใส่ job queued ใน useJobs ทันที ปิดปุ่มระหว่างที่ scenario มีงานค้าง
// - เครื่องไม่มี WebGL (หรือสร้าง viewer ไม่ได้) = ข้อความไทยแทนภาพ หน้าต่างอื่นยังใช้ได้; โหลดไฟล์ส่วนแสดงผลไม่ได้ = ข้อความของตัวเอง
// - ภาพหยุดระหว่างใช้ (ข้อผิดพลาดตอนวาด หรือ browser ทิ้ง WebGL context) = ข้อความไทยให้ปิดแล้วเปิดหน้าต่างใหม่ และแจ้ง Message Viewer (SCENE_RENDER)
// - โหลดผลลัพธ์เข้าภาพไม่สำเร็จ (sceneFailed) = แถบไทยเหนือภาพจนกว่าการลองใหม่จะสำเร็จ
// - Shift + ล้อเมาส์บนภาพ = Step Forward (หมุนขึ้น) / Step Backward (หมุนลง) ผ่านคำสั่ง anim.* ล้อเฉย ๆ ซูมตามปกติของ Cesium
// - panel เปลี่ยนขนาด → handle.resize() (spec §17 W3)

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { errorText } from "../../api/client";
import { startJob } from "../../api/startJob";
import { runCommand } from "../../commands";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { useJobs } from "../../stores/jobs";
import { usePanelResize } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import type { SceneRegistry } from "./sceneRegistry";

/** "3D" หรือ "2D": ใช้ในข้อความที่บอกว่าเป็นหน้าต่างไหน */
export type WindowName = "3D" | "2D";

/** browser มี WebGL ไหม (jsdom และ browser ที่ปิด WebGL ไม่มี WebGLRenderingContext: ไม่ต้องโหลด Cesium เลย) */
export const webglAvailable = (): boolean => typeof window !== "undefined" && typeof window.WebGLRenderingContext !== "undefined";

export type ViewState = "loading" | "ready" | "nowebgl" | "chunkFailed" | "renderStopped";

/** เหตุที่ภาพหยุด (เหมือน RenderFailure ของ cesium/viewer.ts ไฟล์นี้ไม่ import ส่วน Cesium) */
export type RenderStopReason = "renderError" | "contextLost";

/** สิ่งที่ handle ของภาพ (scene3d / scene2d) ต้องมีให้ส่วนร่วมนี้ใช้ */
export interface MountedScene {
  readonly panelId: string;
  sceneFailed(): boolean;
  resize(): void;
  destroy(): void;
}

export interface ResultsBannerProps {
  /**
   * สถานะที่ผู้เรียกรู้เอง (หน้าต่างรายงาน: server ตอบ 409 RESULTS_NOT_CURRENT) แทนสถานะ ephem ของ useResults
   * null = ผลของผู้เรียกใช้ได้ ไม่แสดงแถบ ไม่ระบุ = ตาม useResults (หน้าต่าง 3D/2D)
   */
  status?: "stale" | "missing" | null;
  /** งานของปุ่ม Apply แทน POST /propagate (หน้าต่างรายงาน: Compute ของ access แล้วสร้างรายงานใหม่) ผู้เรียกแจ้งข้อผิดพลาดเอง */
  onApply?: () => Promise<void>;
}

/** แถบเหนือภาพเมื่อผลลัพธ์ไม่ตรงกับ scenario หรือยังไม่มี พร้อมปุ่ม Apply */
export function ResultsBanner({ status: override, onApply }: ResultsBannerProps = {}) {
  const name = useScenario((s) => s.name);
  const stored = useResults((s) => s.status);
  const error = useResults((s) => s.info?.error ?? null);
  const job = useJobs((s) => (name === null ? undefined : s.activeFor(name)));
  const [sending, setSending] = useState(false);
  const status = override === undefined ? stored : override;
  if (name === null || (status !== "stale" && status !== "missing")) return null;

  const busy = sending || job !== undefined;
  const apply = async (): Promise<void> => {
    setSending(true);
    try {
      if (onApply !== undefined) await onApply();
      else await startJob(`/scenarios/${encodeURIComponent(name)}/propagate`, "propagate", name);
    } catch (e) {
      report("error", "PROPAGATE", msg("banner.applyFailed", { message: errorText(e) }));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="gfx-banner" role="status">
      <div className="gfx-banner-text">
        <span>{msg(status === "stale" ? "banner.stale" : "banner.missing")}</span>
        {error !== null && <span className="gfx-banner-error">{error.text}</span>}
        {job !== undefined && <span className="gfx-banner-note">{msg("banner.running")}</span>}
      </div>
      <button type="button" className="btn" disabled={busy} title={job !== undefined ? msg("banner.running") : undefined} onClick={() => void apply()}>
        {t("dialog.apply")}
      </button>
    </div>
  );
}

/** แถบเหนือภาพเมื่อโหลดผลลัพธ์เข้าภาพไม่สำเร็จ (แสดงเฉพาะ Facility อยู่ และจะลองใหม่ใน refresh ถัดไป) */
export function SceneFailedBanner<H extends MountedScene>({ registry, panelId, window }: { registry: SceneRegistry<H>; panelId: string; window: WindowName }) {
  useSyncExternalStore(registry.subscribe, registry.version);
  if (registry.get(panelId)?.sceneFailed() !== true) return null;
  return (
    <div className="gfx-banner" role="status">
      <div className="gfx-banner-text">{msg("banner.sceneFailed", { window })}</div>
    </div>
  );
}

/** ข้อความแทนภาพ: ไม่มี WebGL, โหลดส่วนแสดงผลไม่ได้ หรือภาพหยุดระหว่างใช้ */
export function SceneMessage({ view, window }: { view: ViewState; window: WindowName }) {
  if (view !== "nowebgl" && view !== "chunkFailed" && view !== "renderStopped") return null;
  const text = view === "nowebgl" ? msg("webgl.unsupported") : view === "chunkFailed" ? msg("scene.chunkFailed", { window }) : msg("scene.renderStopped");
  return (
    <div className="gfx-message" role="alert">
      {text}
    </div>
  );
}

export interface SceneMountOptions<M, H extends MountedScene> {
  panelId: string;
  host: RefObject<HTMLDivElement | null>;
  window: WindowName;
  /** dynamic import ของส่วน Cesium (reject = โหลดไฟล์ไม่ได้) */
  load(): Promise<M>;
  /** สร้างภาพใน el (โยน = ไม่มี WebGL หรือสร้าง viewer ไม่ได้) onRenderStopped = ส่งต่อให้ภาพเรียกเมื่อภาพหยุดระหว่างใช้ */
  create(module: M, el: HTMLElement, onRenderStopped: (reason: RenderStopReason, error?: unknown) => void): H;
  register(handle: H): () => void;
  /** ค่านี้เปลี่ยน = ทำลายภาพแล้วสร้างใหม่ (หน้าต่าง 2D: Projection) */
  remountKey?: string;
  /** ก่อนทำลายภาพ (เช่น จำมุมกล้องไว้ให้ตัวใหม่) */
  beforeDestroy?(handle: H): void;
}

/**
 * viewer ของหน้าต่าง: สร้างเมื่อ mount (และเมื่อ remountKey เปลี่ยน) ทำลายเมื่อ unmount (StrictMode: รอบแรกถูกยกเลิกก่อน Cesium โหลดเสร็จ)
 * คืนสถานะของภาพและ handle ปัจจุบัน; panel เปลี่ยนขนาด → handle.resize()
 */
export function useSceneMount<M, H extends MountedScene>(opts: SceneMountOptions<M, H>): { view: ViewState; scene: RefObject<H | null> } {
  const { panelId, host, remountKey } = opts;
  const scene = useRef<H | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const [view, setView] = useState<ViewState>("loading");

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    if (!webglAvailable()) {
      setView("nowebgl");
      return;
    }
    let disposed = false;
    let handle: H | null = null;
    let unregister: (() => void) | null = null;
    const o = latest.current;
    const stopped = (reason: RenderStopReason, error?: unknown): void => {
      if (disposed) return;
      const message = reason === "contextLost" ? "WebGL context lost" : errorText(error);
      report("error", "SCENE_RENDER", msg("scene.renderStoppedLog", { window: o.window, message }), null, error instanceof Error ? (error.stack ?? null) : null);
      setView("renderStopped");
    };
    o.load()
      .then((module) => {
        if (disposed) return;
        try {
          handle = latest.current.create(module, el, stopped);
        } catch (e) {
          el.replaceChildren(); // กล่อง error ภาษาอังกฤษที่ Cesium วาดไว้
          console.error(`${o.window} viewer could not start`, e);
          setView("nowebgl");
          return;
        }
        scene.current = handle;
        unregister = latest.current.register(handle);
        setView("ready");
      })
      .catch((e: unknown) => {
        if (disposed) return;
        report("error", "SCENE_CHUNK", msg("scene.chunkFailedLog", { window: o.window, message: errorText(e) }));
        setView("chunkFailed");
      });
    return () => {
      disposed = true;
      unregister?.();
      if (handle !== null) latest.current.beforeDestroy?.(handle);
      handle?.destroy();
      scene.current = null;
    };
  }, [panelId, host, remountKey]);

  usePanelResize(panelId, () => scene.current?.resize());
  return { view, scene };
}

/**
 * Shift + ล้อเมาส์บนภาพ: ฟังช่วง capture บนกรอบของภาพ แล้วหยุดไม่ให้ถึง canvas ของ Cesium (ล้อเฉย ๆ ผ่านไปซูมตามปกติ)
 * macOS แปลง Shift + ล้อเป็นการเลื่อนแนวนอน (deltaY = 0, deltaX ≠ 0) จึงใช้ deltaX แทนเมื่อไม่มี deltaY
 */
export function useShiftWheelSteps(host: RefObject<HTMLDivElement | null>): void {
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
  }, [host]);
}
