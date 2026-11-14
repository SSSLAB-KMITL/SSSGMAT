// โมเดลที่พร้อมวาดของดาวแต่ละดวงสำหรับหน้าต่าง 3D (models integration spec §1, §4)
// - catalog (/models/catalog.json) และ glb โหลดครั้งเดียวต่อหน้าเว็บ (satModels.ts loadModelCatalog / loadModelGlb) ผลเก็บไว้ระดับหน้า หน้าต่างทุกบานใช้ร่วมกัน
//   (หน้าต่างที่เปิดทีหลังได้โมเดลที่โหลดแล้วทันที)
// - specFor ตอบทันที: ยังไม่มี catalog หรือ glb ของโมเดลนั้น = null (ดาวเป็นจุด) แล้วเริ่มโหลด เสร็จ = changed() ให้หน้าต่างวาดใหม่ (restyle เรียก specFor อีกรอบ)
//   changed() ถูกรวบเป็นชุด: ไฟล์แรกที่เสร็จเปิดหน้าต่าง MODEL_BATCH_MS ไฟล์ที่เสร็จในหน้าต่างนั้นรวมเป็น changed() ครั้งเดียวตอนหน้าต่างปิด
//   (ตอนเปิดหน้าเว็บ glb ราว 17 ไฟล์ทยอยมาจะได้ restyle ไม่กี่ครั้ง ไม่ใช่ครั้งละไฟล์) ไฟล์ที่เสร็จหลังจากนั้นเปิดชุดใหม่
// - โหลดล้มเหลว = ดาวที่ใช้โมเดลนั้นเป็นจุดต่อไป (ไม่ลองซ้ำ) + ข้อความไทยใน Message Viewer ครั้งเดียวต่อ id ต่อหน้าเว็บ
//   ทั้งตอนโหลดไฟล์ (loadModelGlb: ไฟล์หาย ไม่ใช่ glb ที่ Cesium อ่านได้) และหลังให้ Cesium แล้ว (modelFailed จาก satModelGraphics.watchModelErrors:
//   ทุกหน้าต่างวาดดาวของโมเดลนั้นใหม่เป็นจุด)
//   catalog ล้มเหลว: ทุกดวงเป็นจุด + ข้อความครั้งเดียว (loadModelCatalog ไม่จำความล้มเหลว: หน้าต่างที่เปิดใหม่ลองอีกครั้ง)
// - block ของดาวจาก catalog ของ snapshot (satelliteInfo().block) ตรงตัวกับ blocks ใน models/catalog.json (ตรวจกับ snapshot จริงแล้ว) ไม่ต้องแปลง
//   block ว่าง ("") ถือเป็นไม่มี block block เดียวกันนี้เลือกกฎท่าทาง (attitudeLaws.attitudeLawFor): หลาย block ใช้โมเดล (glb) เดียวกันได้แต่กฎต่างกัน
//   (เช่น BDS-2G orbit normal กับ BDS-2I YS ↔ ON) spec จึงมีหนึ่งตัวต่อ (โมเดล, กฎ)

import { Cartesian3 } from "cesium";
import { attitudeLawFor } from "../../cesium/attitudeLaws";
import type { SatModelSpec } from "../../cesium/satModelGraphics";
import { cellNormalOf, loadModelCatalog, loadModelGlb, resolveModel, wingNodesOf, type ModelCatalog, type ResolvedModel } from "../../cesium/satModels";
import { msg } from "../../labels/messages.th";
import { report } from "../../stores/messages";

/** ช่วงที่รวบไฟล์ที่โหลดเสร็จเป็น changed() ครั้งเดียว (ms) */
export const MODEL_BATCH_MS = 100;

/** catalog ที่โหลดแล้วของหน้านี้ */
let loadedCatalog: ModelCatalog | null = null;
/** url ของ glb → blob uri (null = ล้มเหลว) ไม่มี = ยังไม่ได้ขอหรือกำลังโหลด */
const glbResults = new Map<string, string | null>();
/** spec ต่อ "<id ของโมเดล>|<กฎ>" (ดาวหลายดวงและหลายหน้าต่างใช้ตัวเดียวกัน: ผู้ใช้ห้ามแก้) */
const specs = new Map<string, SatModelSpec>();
/** url ของ glb → id ของโมเดล (หาโมเดลจาก blob uri ที่ Cesium โหลดไม่สำเร็จ) */
const idByUrl = new Map<string, string>();
/** ตัวที่ยังไม่ dispose (แจ้งทุกหน้าต่างเมื่อโมเดลล้มเหลวใน Cesium) */
const live = new Set<SatModelSource>();
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
  idByUrl.clear();
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

  constructor(private readonly changed: () => void) {
    live.add(this);
  }

  /** โมเดลที่พร้อมวาดของดาว (block ตาม catalog ของ snapshot, NORAD) ไม่พร้อม = null */
  specFor(sat: { block: string | null; norad: number }): SatModelSpec | null {
    const cat = this.catalogOrLoad();
    if (cat === null) return null;
    let m: ResolvedModel;
    const block = sat.block === "" ? null : sat.block;
    try {
      m = resolveModel(cat, { block, norad: sat.norad });
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
    const law = attitudeLawFor(block, m.eo);
    const key = `${m.id}|${law}`;
    let spec = specs.get(key);
    if (spec === undefined || spec.uri !== uri) {
      spec = { id: m.id, uri, wingNodes: wingNodesOf(cat, m.id), law, zeroNormal: Cartesian3.fromArray([...cellNormalOf(cat, m.id)]) };
      specs.set(key, spec);
    }
    return spec;
  }

  /** เลิกแจ้งหน้าต่าง (ผลที่มาทีหลังยังเก็บไว้ให้หน้าต่างอื่น) */
  dispose(): void {
    this.disposed = true;
    live.delete(this);
    if (this.batch !== null) clearTimeout(this.batch);
    this.batch = null;
  }

  /**
   * Cesium โหลดโมเดลของ blob uri นี้ไม่สำเร็จ: โมเดลนั้นถือว่าล้มเหลว (specFor = null ทุกหน้าต่าง ไม่ลองซ้ำ) ข้อความไทยครั้งเดียวต่อ id
   * แล้วทุกหน้าต่าง restyle (ชุดเดียวกับไฟล์ที่โหลดเสร็จ) ดาวของโมเดลนั้นกลับเป็นจุด uri ที่ไม่ใช่ของโมเดลที่โหลดไว้ = ไม่ทำอะไร
   */
  modelFailed(uri: string, error: unknown): void {
    const url = [...glbResults].find(([, u]) => u === uri)?.[0];
    if (url === undefined) return;
    const id = idByUrl.get(url) ?? url;
    glbResults.set(url, null);
    for (const key of [...specs.keys()]) if (key.startsWith(`${id}|`)) specs.delete(key);
    reportOnce(`model:${id}`, "MODEL_LOAD", msg("model.loadFailed", { model: id, message: errorText(error) }));
    for (const src of live) src.settled();
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
    idByUrl.set(url, id);
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
