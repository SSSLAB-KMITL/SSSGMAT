// โมเดลที่พร้อมวาดของดาวแต่ละดวงสำหรับหน้าต่าง 3D (models integration spec §1, §4)
// - catalog (/models/catalog.json) และ glb โหลดครั้งเดียวต่อหน้าเว็บ (satModels.ts loadModelCatalog / loadModelGlb) ผลเก็บไว้ระดับหน้า หน้าต่างทุกบานใช้ร่วมกัน
//   (หน้าต่างที่เปิดทีหลังได้โมเดลที่โหลดแล้วทันที)
// - specFor ตอบทันที: ยังไม่มี catalog หรือ glb ของโมเดลนั้น = null (ดาวเป็นจุด) แล้วเริ่มโหลด เสร็จ = changed() ให้หน้าต่างวาดใหม่ (restyle เรียก specFor อีกรอบ)
//   changed() ถูกรวบเป็นชุด: ไฟล์แรกที่เสร็จเปิดหน้าต่าง MODEL_BATCH_MS ไฟล์ที่เสร็จในหน้าต่างนั้นรวมเป็น changed() ครั้งเดียวตอนหน้าต่างปิด
//   (ตอนเปิดหน้าเว็บ glb ราว 17 ไฟล์ทยอยมาจะได้ restyle ไม่กี่ครั้ง ไม่ใช่ครั้งละไฟล์) ไฟล์ที่เสร็จหลังจากนั้นเปิดชุดใหม่
// - โหลดล้มเหลว = ดาวที่ใช้โมเดลนั้นเป็นจุดต่อไป (ไม่ลองซ้ำ) + ข้อความไทยใน Message Viewer ครั้งเดียวต่อ id ต่อหน้าเว็บ
//   catalog ล้มเหลว: ทุกดวงเป็นจุด + ข้อความครั้งเดียว (loadModelCatalog ไม่จำความล้มเหลว: หน้าต่างที่เปิดใหม่ลองอีกครั้ง)
// - block ของดาวจาก catalog ของ snapshot (satelliteInfo().block) ตรงตัวกับ blocks ใน models/catalog.json (ตรวจกับ snapshot จริงแล้ว) ไม่ต้องแปลง
//   block ว่าง ("") ถือเป็นไม่มี block

import { Cartesian3 } from "cesium";
import type { SatModelSpec } from "../../cesium/satModelGraphics";
import { loadModelCatalog, loadModelGlb, resolveModel, wingNodesOf, wingZeroNormal, type ModelCatalog, type ResolvedModel } from "../../cesium/satModels";
import { msg } from "../../labels/messages.th";
import { report } from "../../stores/messages";

/** ช่วงที่รวบไฟล์ที่โหลดเสร็จเป็น changed() ครั้งเดียว (ms) */
export const MODEL_BATCH_MS = 100;

/** catalog ที่โหลดแล้วของหน้านี้ */
let loadedCatalog: ModelCatalog | null = null;
/** url ของ glb → blob uri (null = ล้มเหลว) ไม่มี = ยังไม่ได้ขอหรือกำลังโหลด */
const glbResults = new Map<string, string | null>();
/** spec ต่อ id ของโมเดล (ดาวหลายดวงและหลายหน้าต่างใช้ตัวเดียวกัน: ผู้ใช้ห้ามแก้) */
const specs = new Map<string, SatModelSpec>();
/** id (หรือ "catalog") ที่แจ้งไปแล้วในหน้านี้ */
const reported = new Set<string>();

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function reportOnce(key: string, code: string, text: string): void {
  if (reported.has(key)) return;
  reported.add(key);
  report("warning", code, text);
}

/** ลืมผลที่โหลดและข้อความที่แจ้งไปแล้ว (test; ใช้คู่กับ satModels.resetModelLoads) */
export function resetModelReports(): void {
  loadedCatalog = null;
  glbResults.clear();
  specs.clear();
  reported.clear();
}

export class SatModelSource {
  private catalogRequested = false;
  /** url ของ glb ที่ตัวนี้รอผลอยู่ */
  private readonly waiting = new Set<string>();
  private disposed = false;
  /** ชุดที่เปิดอยู่ (changed() ตอนครบ MODEL_BATCH_MS) */
  private batch: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly changed: () => void) {}

  /** โมเดลที่พร้อมวาดของดาว (block ตาม catalog ของ snapshot, NORAD) ไม่พร้อม = null */
  specFor(sat: { block: string | null; norad: number }): SatModelSpec | null {
    const cat = this.catalogOrLoad();
    if (cat === null) return null;
    let m: ResolvedModel;
    try {
      m = resolveModel(cat, { block: sat.block === "" ? null : sat.block, norad: sat.norad });
    } catch (e) {
      // catalog ถูกตรวจแบบตื้น (satModels.parseCatalog): รายการที่ผิดรูปทำให้จับคู่ไม่ได้ = จุด + แจ้งครั้งเดียว
      reportOnce("catalog", "MODEL_CATALOG", msg("model.catalogFailed", { message: errorText(e) }));
      return null;
    }
    const uri = glbResults.get(m.url);
    if (uri === undefined) {
      this.loadGlb(m.id, m.url);
      return null;
    }
    if (uri === null) return null;
    let spec = specs.get(m.id);
    if (spec === undefined || spec.uri !== uri) {
      spec = { id: m.id, uri, wingNodes: wingNodesOf(cat, m.id), eo: m.eo, zeroNormal: Cartesian3.fromArray([...wingZeroNormal(m.id)]) };
      specs.set(m.id, spec);
    }
    return spec;
  }

  /** เลิกแจ้งหน้าต่าง (ผลที่มาทีหลังยังเก็บไว้ให้หน้าต่างอื่น) */
  dispose(): void {
    this.disposed = true;
    if (this.batch !== null) clearTimeout(this.batch);
    this.batch = null;
  }

  /** catalog หรือ glb เสร็จ: เข้าชุดที่เปิดอยู่ หรือเปิดชุดใหม่ */
  private settled(): void {
    if (this.disposed || this.batch !== null) return;
    this.batch = setTimeout(() => {
      this.batch = null;
      if (!this.disposed) this.changed();
    }, MODEL_BATCH_MS);
  }

  private catalogOrLoad(): ModelCatalog | null {
    if (loadedCatalog !== null || this.catalogRequested) return loadedCatalog;
    this.catalogRequested = true;
    loadModelCatalog().then(
      (cat) => {
        loadedCatalog = cat;
        this.settled();
      },
      (e: unknown) => reportOnce("catalog", "MODEL_CATALOG", msg("model.catalogFailed", { message: errorText(e) })),
    );
    return null;
  }

  private loadGlb(id: string, url: string): void {
    if (this.waiting.has(url)) return;
    this.waiting.add(url);
    loadModelGlb(url).then(
      (uri) => {
        glbResults.set(url, uri);
        this.waiting.delete(url);
        this.settled();
      },
      (e: unknown) => {
        glbResults.set(url, null);
        this.waiting.delete(url);
        reportOnce(`model:${id}`, "MODEL_LOAD", msg("model.loadFailed", { model: id, message: errorText(e) }));
      },
    );
  }
}
