// data source ของหน้าต่าง 3D/2D ตามผลลัพธ์ที่ใช้ได้ตอนนี้ (อยู่ใน chunk ของ Cesium: scene3d.ts / scene2d.ts เท่านั้นที่ import)
//
// - currentSceneUrls: URL ของ scene.czml ของ ephem ที่ current + access.czml ของทุก Facility ที่ current (เรียงชื่อ เฉพาะเมื่อมี scene)
// - CzmlScene: SceneSource + ตัวโหลด CZML จริง (loadScene / data source ว่าง) + การสลับ: ตัวใหม่ใช้แล้วเอาตัวเก่าออกจาก viewer
//   ทั้งสองหน้าต่างใช้ตัวนี้ หน้าต่างแค่ตั้งกราฟิกเมื่อได้ data source ใหม่ (adopted)
// - SceneSource (ไม่รู้จัก Cesium: ทดสอบด้วยตัวโหลดปลอม):
//   - update(urls): URL ของ scene.czml / access.czml (มี hash อยู่ใน URL) ชุดใหม่ = โหลดใหม่, ชุดเดิม = ไม่ทำอะไร (ผู้เรียกแค่ตั้งกราฟิกใหม่)
//     ไม่มีผลที่ current (sceneUrl = null) = data source ว่างให้ Facility จาก doc (Review Focus 1) ไม่นับเป็นความล้มเหลว
//   - การโหลดที่ถูกแซง: ยกเลิกด้วย AbortSignal ถ้ายังเสร็จมาก็ทิ้ง (discard)
//   - โหลด scene ไม่สำเร็จ: แจ้ง (failed) แสดง Facility อย่างเดียวไปก่อน และสถานะ failed() เป็น true จนกว่าจะโหลดได้หรือผลไม่ current แล้ว

import { CzmlDataSource, type Viewer } from "cesium";
import { errorText } from "../../api/client";
import { loadScene } from "../../cesium/czml";
import { msg } from "../../labels/messages.th";
import { report } from "../../stores/messages";
import type { ResultsInfo } from "../../stores/results";
import type { WindowName } from "./GraphicsFrame";

export interface SceneUrls {
  sceneUrl: string | null;
  accessUrls: readonly string[];
}

export interface SceneSourceDeps<DS> {
  /** โหลด scene.czml + access.czml แล้วใส่ใน viewer (ยกเลิกได้ด้วย signal: reject) */
  load(sceneUrl: string, accessUrls: readonly string[], signal: AbortSignal): Promise<DS>;
  /** data source ว่างที่ใส่ใน viewer แล้ว (สำหรับ Facility อย่างเดียว) */
  empty(): Promise<DS>;
  /** ใช้ data source นี้แทนตัวเดิม (scene = มาจาก scene.czml) */
  adopt(ds: DS, scene: boolean): void;
  /** data source ที่โหลดเสร็จแต่มีตัวที่ใหม่กว่าแล้ว: เอาออกจาก viewer */
  discard(ds: DS): void;
  /** โหลด scene ไม่สำเร็จ (ไม่นับการยกเลิก) */
  failed(e: unknown): void;
  /** failed() เปลี่ยนค่า */
  changed(): void;
}

const keyOf = (urls: SceneUrls): string => JSON.stringify([urls.sceneUrl, urls.accessUrls]);

export class SceneSource<DS> {
  private key: string | null = null;
  private seq = 0;
  private ctl: AbortController | null = null;
  private failedNow = false;
  private disposed = false;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SceneSourceDeps<DS>) {}

  /** เริ่มโหลดถ้า URL ต่างจากชุดที่โหลดอยู่ (คืน true) ชุดเดิม = false */
  update(urls: SceneUrls): boolean {
    if (this.disposed) return false;
    const key = keyOf(urls);
    if (key === this.key) return false;
    this.key = key;
    this.running = this.load(urls.sceneUrl, urls.accessUrls, false);
    return true;
  }

  /** แสดง Facility อย่างเดียวเพราะโหลด scene ไม่สำเร็จ */
  failed(): boolean {
    return this.failedNow;
  }

  /** รอการโหลดล่าสุดจบ (test) */
  async idle(): Promise<void> {
    let seen: Promise<void> | null = null;
    while (seen !== this.running) {
      seen = this.running;
      await seen;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.ctl?.abort();
  }

  private setFailed(value: boolean): void {
    if (this.failedNow === value) return;
    this.failedNow = value;
    this.deps.changed();
  }

  private async load(sceneUrl: string | null, accessUrls: readonly string[], fallback: boolean): Promise<void> {
    const seq = ++this.seq;
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    let ds: DS;
    try {
      ds = sceneUrl === null ? await this.deps.empty() : await this.deps.load(sceneUrl, accessUrls, ctl.signal);
    } catch (e) {
      if (this.disposed || seq !== this.seq || ctl.signal.aborted) return;
      this.deps.failed(e);
      if (sceneUrl === null) return;
      // ลืม URL ชุดนี้: การ refresh ครั้งถัดไป (เช่น SSE ต่อใหม่หลัง server กลับมา) ได้ hash เท่าเดิมก็ยังลองโหลดใหม่ ไม่ค้างที่ Facility อย่างเดียว
      this.key = null;
      this.setFailed(true);
      this.running = this.load(null, [], true);
      return;
    }
    if (this.disposed) return;
    if (seq !== this.seq) {
      this.deps.discard(ds);
      return;
    }
    if (!fallback) this.setFailed(false);
    this.deps.adopt(ds, sceneUrl !== null);
  }
}

/** ส่วนของ useResults ที่ใช้เลือก URL */
export interface ResultsUrls {
  info: ResultsInfo | null;
  ephemUrl(file: string): string | null;
  accessUrl(facility: string, file: string): string | null;
}

/** URL ของผลที่ใช้ได้ตอนนี้: scene.czml ของ ephem ที่ current + access.czml ของทุก Facility ที่ current เรียงชื่อ (ไม่มี scene = ไม่มี access) */
export function currentSceneUrls(results: ResultsUrls): SceneUrls {
  const sceneUrl = results.ephemUrl("scene.czml");
  if (sceneUrl === null) return { sceneUrl: null, accessUrls: [] };
  const accessUrls = Object.keys(results.info?.access ?? {})
    .sort()
    .flatMap((f) => {
      const url = results.accessUrl(f, "access.czml");
      return url === null ? [] : [url];
    });
  return { sceneUrl, accessUrls };
}

const DATA_SOURCE_NAME = "gnss-studio";

export interface CzmlSceneOptions {
  /** "3D" / "2D": ชื่อหน้าต่างในข้อความเตือนเมื่อโหลดไม่สำเร็จ */
  window: WindowName;
  /** data source ใหม่ถูกใช้แล้ว (ตัวเก่าถูกเอาออกจาก viewer แล้ว) fromScene = มาจาก scene.czml (ไม่ใช่ตัวว่าง) */
  adopted(ds: CzmlDataSource, fromScene: boolean): void;
  /** failed() เปลี่ยนค่า */
  changed(): void;
}

/** CZML data source ของหน้าต่างหนึ่งบาน (ตัวเดียวต่อ viewer) */
export class CzmlScene {
  private current: CzmlDataSource | null = null;
  private readonly source: SceneSource<CzmlDataSource>;
  private disposed = false;

  constructor(viewer: Pick<Viewer, "dataSources" | "isDestroyed">, opts: CzmlSceneOptions) {
    const remove = (ds: CzmlDataSource): void => {
      if (!this.disposed && !viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    };
    this.source = new SceneSource<CzmlDataSource>({
      load: (url, access, signal) => loadScene(viewer as Viewer, url, access, { signal }),
      empty: async () => {
        const ds = new CzmlDataSource(DATA_SOURCE_NAME);
        await viewer.dataSources.add(ds);
        return ds;
      },
      adopt: (ds, fromScene) => {
        if (this.disposed) return;
        const old = this.current;
        this.current = ds;
        if (old !== null && old !== ds) remove(old);
        opts.adopted(ds, fromScene);
      },
      discard: remove,
      failed: (e) => report("warning", "SCENE_LOAD", msg("scene.loadFailed", { window: opts.window, message: errorText(e) })),
      changed: opts.changed,
    });
  }

  /** data source ที่ใช้อยู่ (ยังไม่ได้ = null) */
  get ds(): CzmlDataSource | null {
    return this.current;
  }

  /** โหลดถ้า URL ต่างจากชุดที่โหลดอยู่ (true) ชุดเดิม = false (ผู้เรียกแค่ตั้งกราฟิกใหม่) */
  update(urls: SceneUrls): boolean {
    return this.source.update(urls);
  }

  /** แสดง Facility อย่างเดียวเพราะโหลด scene ไม่สำเร็จ */
  failed(): boolean {
    return this.source.failed();
  }

  /** รอการโหลดล่าสุดจบ (test) */
  idle(): Promise<void> {
    return this.source.idle();
  }

  /** เลิกโหลด ไม่แตะ viewer อีก (viewer.destroy ทำลาย data source เอง) */
  dispose(): void {
    this.disposed = true;
    this.current = null;
    this.source.dispose();
  }
}
