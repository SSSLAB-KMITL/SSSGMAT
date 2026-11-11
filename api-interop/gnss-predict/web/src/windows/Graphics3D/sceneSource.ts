// data source ของหน้าต่าง 3D ตามผลลัพธ์ที่ใช้ได้ตอนนี้ (ไม่ import Cesium: ตัวโหลดจริงฉีดมาจาก scene3d.ts จึงทดสอบได้ใน jsdom)
//
// - update(urls): URL ของ scene.czml / access.czml (มี hash อยู่ใน URL) ชุดใหม่ = โหลดใหม่, ชุดเดิม = ไม่ทำอะไร (ผู้เรียกแค่ตั้งกราฟิกใหม่)
//   ไม่มีผลที่ current (sceneUrl = null) = data source ว่างให้ Facility จาก doc (Review Focus 1) ไม่นับเป็นความล้มเหลว
// - การโหลดที่ถูกแซง: ยกเลิกด้วย AbortSignal ถ้ายังเสร็จมาก็ทิ้ง (discard)
// - โหลด scene ไม่สำเร็จ: แจ้ง (failed) แสดง Facility อย่างเดียวไปก่อน และสถานะ failed() เป็น true จนกว่าจะโหลดได้หรือผลไม่ current แล้ว

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
