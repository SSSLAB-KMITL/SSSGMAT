// ชั้นภาพ NASA GIBS บน viewer 3D หนึ่งตัว (spec imagery §5.2) หน้าต่าง 3D และ Sensor View ต่อผ่าน scene3d.ts mount (attachImageryLayers)
//
// - ตามสาม store: useImagery (สวิตช์ + catalog), useLayout.globe (Show / Translucency จาก Globe Manager), useTime (เวลา Animation)
// - ชั้นที่วาด = ชั้นใน catalog ที่ globe บอกว่าแสดง เฉพาะเมื่อสวิตช์เปิด (ปิด = ไม่มีชั้น GIBS เลย ไม่มีคำขอชิ้นภาพจาก browser)
//   id ใน globe ที่ catalog ไม่รู้จักข้ามไป
// - ตำแหน่ง: เหนือ index 0 (Natural Earth II: applyProps ของ scene3d.ts ใช้ index 0 เป็นภาพฐานของกลางวัน/กลางคืน ห้ามแทรกที่ 0)
//   เรียงตาม catalog (ชั้นหลังทับชั้นก่อน) ชั้นของ id หนึ่งวางต่อจากชั้นบนสุดของ id ก่อนหน้าใน catalog ที่วาดอยู่ (ไม่มี = index 1)
//   ชั้นใหม่จึงอยู่ใต้เส้น Lat/Lon ที่วางไว้ก่อนเสมอ ส่วนเส้น Lat/Lon ที่เปิดทีหลัง scene3d.ts ต่อท้ายรายการ (บนสุด) เอง
// - ชั้นละหนึ่ง UrlTemplateImageryProvider ของ viewer นี้เอง (ไม่ใช้ร่วมกับ viewer อื่น): url /api/imagery/tiles/{id}/{token}/{z}/{y}/{x} (same-origin)
//   Web Mercator, maximumLevel = max_level (ซูมลึกกว่านั้น Cesium ขยายจากระดับสูงสุด), credit ของชั้นขึ้นที่แถบเครดิตของ viewer
// - alpha = 1 − translucency/100
// - token ของเวลา (imageryTime.ts) เปลี่ยน → เปลี่ยนชั้นนั้นเป็น provider ของ token ใหม่ ไม่เกิน 1 ครั้งต่อ TOKEN_INTERVAL_MS ต่อ viewer
//   (Throttle: ครั้งแรกทำทันที ครั้งท้ายตามมาเสมอ) เวลาเปลี่ยนแต่ token เท่าเดิม = ไม่ทำอะไร
//   ชั้นเดิมอยู่ใต้ชั้นใหม่จนชั้นใหม่เริ่มโหลด (ชิ้นแรกได้ผล สำเร็จหรือไม่มีภาพ) จึงเอาออก ภาพไม่กะพริบ
//   ชั้นที่ยังไม่เริ่มโหลดแล้วถูกแทนอีก (animation เร็ว) เอาออกทันที: id หนึ่งมีไม่เกินสองชั้น (ชั้นที่รอ + ชั้นเดิมที่ยังแสดงอยู่)
// - ชิ้นที่โหลดไม่ได้ (errorEvent ของ provider): ไม่ลองซ้ำ (retry = false) มีตัวฟังแล้ว Cesium จึงไม่พิมพ์ error ของมันเอง ชิ้นนั้นโปร่งใส
//   404 = ไม่มีภาพเวลานี้ นับต่อ (ชั้น, token) ไว้ให้ HUD (imageryStatus) ; 403 = server ปิดสวิตช์ (IMAGERY_DISABLED) → useImagery.enabled = false
//   ทุก viewer เอาชั้น GIBS ออก ; ข้อผิดพลาดอื่น (503 BUSY/PAUSED, เครือข่าย) ไม่นับเป็นไม่มีภาพ
//   รหัส HTTP มาจาก RequestErrorEvent.statusCode (Cesium โหลดชิ้นด้วย XHR เมื่อ browser มี createImageBitmap)
// - ทุกการเปลี่ยนเรียก scene.requestRender() (viewer ใช้ requestRenderMode)

import { ImageryLayer, UrlTemplateImageryProvider, WebMercatorTilingScheme, type Viewer } from "cesium";
import { useImagery, type ImageryLayerInfo } from "../stores/imagery";
import { useLayout } from "../stores/layout";
import { useTime } from "../stores/time";
import { Throttle } from "../windows/graphics/throttle";
import { timeToken, tokenLabel } from "./imageryTime";

/** เปลี่ยนชั้นตามเวลาได้ไม่เกินหนึ่งครั้งต่อช่วงนี้ต่อ viewer */
export const TOKEN_INTERVAL_MS = 1000;

/** ส่วนของ Viewer ที่ใช้ (test ส่งตัวปลอมได้) */
type ImageryViewer = Pick<Viewer, "imageryLayers" | "scene">;

export interface ImageryTopLayer {
  id: string;
  title: string;
  /** เวลาของภาพสำหรับ HUD (tokenLabel) static = "" */
  label: string;
  /** สัดส่วนชิ้นที่ server ตอบ 404 (ไม่มีภาพเวลานี้) ในชิ้นที่ได้ผลแล้วของ token ที่แสดงอยู่ ยังไม่มีชิ้นใด = 0 */
  missingRatio: number;
}

interface TileCounts {
  loaded: number;
  missing: number;
  failed: number;
}

/** ชั้นของ id หนึ่งบน viewer: ชั้นปัจจุบัน + ชั้นเดิมที่ยังแสดงอยู่จนชั้นปัจจุบันเริ่มโหลด */
interface Managed {
  info: ImageryLayerInfo;
  token: string;
  layer: ImageryLayer;
  /** ชั้นปัจจุบันได้ผลชิ้นแรกแล้ว */
  started: boolean;
  retiring: ImageryLayer | null;
}

interface Manager {
  status(): { topLayer: ImageryTopLayer | null };
}

const managers = new WeakMap<object, Manager>();

const shownLayers = (): ImageryLayerInfo[] => {
  const { enabled, layers } = useImagery.getState();
  if (!enabled) return [];
  const globe = useLayout.getState().globe;
  return layers.filter((l) => globe.layers[l.id]?.show === true);
};

const alphaOf = (id: string): number => {
  const t = useLayout.getState().globe.layers[id]?.translucency ?? 0;
  return 1 - t / 100;
};

const statusOf = (e: unknown): number | undefined => {
  const code = (e as { error?: { statusCode?: unknown } } | null)?.error?.statusCode;
  return typeof code === "number" ? code : undefined;
};

/**
 * ต่อชั้นภาพ GIBS เข้ากับ viewer ตามสวิตช์ globe และเวลา คืนฟังก์ชันถอด (เอาชั้นออกและเลิกฟัง) เรียกก่อนทำลาย viewer
 * opts.now: นาฬิกาของ Throttle (test ฉีดได้)
 */
export function attachImageryLayers(viewer: ImageryViewer, opts: { now?: () => number } = {}): () => void {
  const layers = viewer.imageryLayers;
  const managed = new Map<string, Managed>();
  /** จำนวนชิ้นต่อ "id/token" ของ token ที่แสดงอยู่ */
  const counts = new Map<string, TileCounts>();
  let detached = false;

  const countsFor = (id: string, token: string): TileCounts => {
    const key = `${id}/${token}`;
    let c = counts.get(key);
    if (c === undefined) {
      c = { loaded: 0, missing: 0, failed: 0 };
      counts.set(key, c);
    }
    return c;
  };

  const drop = (layer: ImageryLayer | null): void => {
    if (layer !== null && layers.contains(layer)) layers.remove(layer, true);
  };

  /** index ที่ชั้นใหม่ของ id นี้ควรอยู่: ต่อจากชั้นเดิมที่ยังแสดงของมันเอง หรือชั้นบนสุดของ id ก่อนหน้าใน catalog ที่วาดอยู่ หรือ index 1 */
  const insertIndex = (id: string, order: readonly ImageryLayerInfo[]): number => {
    const own = managed.get(id)?.retiring;
    const ownAt = own ? layers.indexOf(own) : -1;
    if (ownAt >= 0) return ownAt + 1;
    const at = order.findIndex((l) => l.id === id);
    for (let i = at - 1; i >= 0; i--) {
      const m = managed.get(order[i].id);
      const below = m === undefined ? -1 : layers.indexOf(m.layer);
      if (below >= 0) return below + 1;
    }
    return Math.min(1, layers.length);
  };

  const makeLayer = (info: ImageryLayerInfo, token: string): ImageryLayer => {
    const provider = new UrlTemplateImageryProvider({
      url: `/api/imagery/tiles/${info.id}/${token}/{z}/{y}/{x}`,
      tilingScheme: new WebMercatorTilingScheme(),
      maximumLevel: info.max_level,
      credit: info.credit,
    });
    const tiles = countsFor(info.id, token);
    const started = (): void => {
      const m = managed.get(info.id);
      if (detached || m === undefined || m.layer !== layer || m.started) return;
      m.started = true;
      drop(m.retiring);
      m.retiring = null;
      viewer.scene.requestRender();
    };
    const request = provider.requestImage.bind(provider);
    provider.requestImage = (x, y, level, req) => {
      const p = request(x, y, level, req);
      p?.then(
        () => {
          tiles.loaded++;
          started();
        },
        () => undefined, // ข้อผิดพลาดนับใน errorEvent (การยกเลิกของ Cesium ไม่ใช่ข้อผิดพลาด)
      );
      return p;
    };
    provider.errorEvent.addEventListener((error: { retry?: boolean }) => {
      error.retry = false;
      if (detached) return;
      const code = statusOf(error);
      if (code === 403) {
        // หลังตัวแจ้งของ Cesium จบ: ไม่เอาชั้นออกระหว่างที่ ImageryLayer ของมันยังอยู่ในตัวจัดการข้อผิดพลาดของตัวเอง
        queueMicrotask(() => useImagery.setState({ enabled: false }));
        return;
      }
      if (code === 404) tiles.missing++;
      else tiles.failed++;
      started();
    });
    const layer = new ImageryLayer(provider);
    layer.alpha = alphaOf(info.id);
    return layer;
  };

  const remove = (id: string): void => {
    const m = managed.get(id);
    if (m === undefined) return;
    drop(m.retiring);
    drop(m.layer);
    managed.delete(id);
    for (const key of [...counts.keys()]) if (key.startsWith(`${id}/`)) counts.delete(key);
  };

  /** ชั้นของ id นี้เป็น token ใหม่: ชั้นปัจจุบันที่เริ่มโหลดแล้วกลายเป็นชั้นเดิมที่รอ ที่ยังไม่เริ่มโหลดเอาออกทันที */
  const replace = (m: Managed, token: string, order: readonly ImageryLayerInfo[]): void => {
    for (const key of [...counts.keys()]) if (key.startsWith(`${m.info.id}/`)) counts.delete(key);
    if (m.started) {
      drop(m.retiring);
      m.retiring = m.layer;
    } else {
      drop(m.layer);
    }
    const layer = makeLayer(m.info, token);
    layers.add(layer, insertIndex(m.info.id, order));
    m.layer = layer;
    m.token = token;
    m.started = false;
  };

  /** ทำให้ชั้นบน viewer ตรงกับ store; replaceTokens = false: ชั้นที่ token เก่าแล้วยังไม่เปลี่ยน (รอ Throttle) คืนว่ามีชั้นที่ token เก่าอยู่ไหม */
  const reconcile = (replaceTokens: boolean): boolean => {
    if (detached) return false;
    const order = shownLayers();
    const wanted = new Set(order.map((l) => l.id));
    let changed = false;
    for (const id of [...managed.keys()]) {
      if (!wanted.has(id)) {
        remove(id);
        changed = true;
      }
    }
    const now = useTime.getState().current;
    let stale = false;
    for (const info of order) {
      const token = timeToken(info.period, now);
      const m = managed.get(info.id);
      if (m === undefined) {
        const layer = makeLayer(info, token);
        layers.add(layer, insertIndex(info.id, order));
        managed.set(info.id, { info, token, layer, started: false, retiring: null });
        changed = true;
        continue;
      }
      m.info = info;
      const alpha = alphaOf(info.id);
      if (m.layer.alpha !== alpha) {
        m.layer.alpha = alpha;
        if (m.retiring !== null) m.retiring.alpha = alpha;
        changed = true;
      }
      if (m.token !== token) {
        if (replaceTokens) {
          replace(m, token, order);
          changed = true;
        } else stale = true;
      }
    }
    if (changed) viewer.scene.requestRender();
    return stale;
  };

  const throttle = new Throttle(TOKEN_INTERVAL_MS, () => void reconcile(true), opts.now);
  const sync = (): void => {
    if (reconcile(false)) throttle.request();
  };

  // ชั้นแรกใช้ token ของเวลาตอนนี้ ไม่ใช่การเปลี่ยน token จึงไม่นับเป็นครั้งของ Throttle
  reconcile(true);

  const offs = [
    useImagery.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled || s.layers !== prev.layers) sync();
    }),
    useLayout.subscribe((s, prev) => {
      if (s.globe !== prev.globe) sync();
    }),
    useTime.subscribe((s, prev) => {
      if (s.current !== prev.current) sync();
    }),
  ];

  const manager: Manager = {
    status: () => {
      const order = shownLayers();
      for (let i = order.length - 1; i >= 0; i--) {
        const m = managed.get(order[i].id);
        if (m === undefined) continue;
        const c = counts.get(`${m.info.id}/${m.token}`) ?? { loaded: 0, missing: 0, failed: 0 };
        const settled = c.loaded + c.missing + c.failed;
        return {
          topLayer: {
            id: m.info.id, title: m.info.title, label: tokenLabel(m.info.period, m.token), missingRatio: settled === 0 ? 0 : c.missing / settled,
          },
        };
      }
      return { topLayer: null };
    },
  };
  managers.set(viewer, manager);

  return () => {
    if (detached) return;
    for (const off of offs) off();
    throttle.dispose();
    for (const id of [...managed.keys()]) remove(id);
    detached = true;
    if (managers.get(viewer) === manager) managers.delete(viewer);
    viewer.scene.requestRender();
  };
}

/** สถานะสำหรับ HUD ของ Sensor View: ชั้นบนสุดที่แสดงอยู่ (ชั้นสุดท้ายตามลำดับ catalog) null = ไม่มี (Natural Earth II) หรือ viewer ไม่ได้ต่อ */
export function imageryStatus(viewer: object): { topLayer: ImageryTopLayer | null } {
  return managers.get(viewer)?.status() ?? { topLayer: null };
}
