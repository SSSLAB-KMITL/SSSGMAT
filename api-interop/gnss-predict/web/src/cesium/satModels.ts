// ตัวเลือกโมเดล 3 มิติของดาวจาก models/catalog.json (spec โมเดล 3 มิติ §1 ข้อ 1)
// catalog กับ glb มากับหน้าเว็บที่ /models/... (web/modelsPackaging.ts) จึงไม่มี request ออกนอกเครื่อง
// ลำดับ: block (ตรงตัวใน blocks ของโมเดล) → fallback_blocks (generic) → norad_ids → fallback (generic)
// block ที่ไม่รู้จักหรือไม่มี → norad_ids → generic; ไม่ใช้ overrides (ต้องมีรหัส COSPAR ซึ่ง catalog ของหน้าเว็บไม่มี)

export interface ModelEntry {
  id: string;
  /** path ของ glb ใต้ /models/ เช่น "galileo-foc/galileo_foc.glb" (ไม่ใช่ <id>/<id>.glb เสมอไป: ไฟล์ของ galileo-foc ชื่อ galileo_foc.glb) */
  glb: string;
  blocks?: string[];
  norad_ids?: number[];
  size_m: [number, number, number];
  triangles: number;
  /** node ของแผงโซลาร์ใน glb: 2 ชื่อ = แผงคู่ (±Y), 1 ชื่อ = แผงเดี่ยว (ดาวสำรวจโลก) */
  wing_nodes?: string[];
  status: string;
}

export interface ModelCatalog {
  version: number;
  frame: string;
  models: ModelEntry[];
  overrides: Record<string, string>;
  fallback: string;
  fallback_blocks: string[];
}

export interface ResolvedModel {
  id: string;
  url: string;
  wings: "two" | "single";
  /** true เมื่อจับคู่จาก norad_ids (ดาวสำรวจโลก: ท่าทางแบบ nadir + ความเร็ว ไม่ใช่ yaw steering) */
  eo: boolean;
}

export const MODELS_URL = "/models";
export const MODEL_CATALOG_URL = `${MODELS_URL}/catalog.json`;

/** โมเดลดาวสำรวจโลก (แผงเดี่ยว): ใช้ตัดสิน wings เมื่อ catalog ไม่มี wing_nodes */
const EO_MODEL_IDS: ReadonlySet<string> = new Set(["terra", "aqua", "suomi-npp", "goes", "himawari-9"]);

interface Index {
  byBlock: Map<string, ModelEntry>;
  byNorad: Map<number, ModelEntry>;
  fallbackBlocks: Set<string>;
  fallback: ModelEntry;
}

// ดัชนีต่อ catalog หนึ่งก้อน สร้างครั้งเดียว: resolveModel ถูกเรียกต่อดาวทุกดวง (ราว 146) จึงไม่ไล่หาใน models ทุกครั้ง
const indexes = new WeakMap<ModelCatalog, Index>();

function indexOf(cat: ModelCatalog): Index {
  const cached = indexes.get(cat);
  if (cached !== undefined) return cached;
  const byBlock = new Map<string, ModelEntry>();
  const byNorad = new Map<number, ModelEntry>();
  for (const m of cat.models) {
    // block หรือ NORAD ซ้ำหลายโมเดล: ตัวแรกใน catalog ชนะ
    for (const b of m.blocks ?? []) if (!byBlock.has(b)) byBlock.set(b, m);
    for (const n of m.norad_ids ?? []) if (!byNorad.has(n)) byNorad.set(n, m);
  }
  const fallback = cat.models.find((m) => m.id === cat.fallback);
  if (fallback === undefined) throw new Error(`catalog โมเดล: ไม่มีโมเดล fallback "${cat.fallback}" ใน models`);
  const index: Index = { byBlock, byNorad, fallbackBlocks: new Set(cat.fallback_blocks ?? []), fallback };
  indexes.set(cat, index);
  return index;
}

function wingsOf(m: ModelEntry): "two" | "single" {
  if (m.wing_nodes !== undefined) return m.wing_nodes.length === 1 ? "single" : "two";
  return EO_MODEL_IDS.has(m.id) ? "single" : "two";
}

function resolved(m: ModelEntry, eo: boolean): ResolvedModel {
  return { id: m.id, url: `${MODELS_URL}/${m.glb}`, wings: wingsOf(m), eo };
}

/** โมเดลของดาวหนึ่งดวง (block ตามที่ดาวบอก, NORAD ตามที่ scenario ใช้); ไม่ล้มเหลวเมื่อไม่รู้จัก: ตกไป generic */
export function resolveModel(cat: ModelCatalog, sat: { block: string | null; norad: number | null }): ResolvedModel {
  const ix = indexOf(cat);
  if (sat.block !== null) {
    const byBlock = ix.byBlock.get(sat.block);
    if (byBlock !== undefined) return resolved(byBlock, false);
    if (ix.fallbackBlocks.has(sat.block)) return resolved(ix.fallback, false);
  }
  if (sat.norad !== null) {
    const byNorad = ix.byNorad.get(sat.norad);
    if (byNorad !== undefined) return resolved(byNorad, true);
  }
  return resolved(ix.fallback, false);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCatalog(raw: unknown): ModelCatalog {
  if (!isRecord(raw)) throw new Error("catalog โมเดล: ไม่ใช่ออบเจ็กต์ JSON");
  const { models, fallback } = raw;
  if (!Array.isArray(models) || models.length === 0 || !models.every((m) => isRecord(m) && typeof m.id === "string" && typeof m.glb === "string"))
    throw new Error("catalog โมเดล: models ต้องเป็นรายการของโมเดลที่มี id และ glb");
  if (typeof fallback !== "string") throw new Error("catalog โมเดล: ไม่มีชื่อ fallback");
  const cat: ModelCatalog = {
    ...(raw as unknown as ModelCatalog),
    models: models as ModelEntry[],
    fallback,
    fallback_blocks: Array.isArray(raw.fallback_blocks) ? (raw.fallback_blocks as string[]) : [],
    overrides: isRecord(raw.overrides) ? (raw.overrides as Record<string, string>) : {},
  };
  if (!cat.models.some((m) => m.id === fallback)) throw new Error(`catalog โมเดล: fallback "${fallback}" ไม่ใช่โมเดลใน models`);
  return cat;
}

let loading: Promise<ModelCatalog> | null = null;

/** โหลด /models/catalog.json ครั้งเดียวต่อหน้าเว็บ (ผู้เรียกพร้อมกันใช้ promise เดียวกัน); โหลดไม่สำเร็จไม่ถูกจำไว้ ครั้งต่อไปลองใหม่ */
export function loadModelCatalog(): Promise<ModelCatalog> {
  if (loading === null) {
    const attempt = (async () => {
      const res = await fetch(MODEL_CATALOG_URL);
      if (!res.ok) throw new Error(`catalog โมเดล: ${MODEL_CATALOG_URL} ตอบ ${res.status}`);
      // ไฟล์ที่หายทำให้ server ตอบหน้าแอป (HTML) กลับมาแทน: json() จะ throw ที่นี่ ไม่ถูกเข้าใจผิดเป็น catalog
      return parseCatalog(await res.json());
    })();
    loading = attempt;
    attempt.catch(() => {
      if (loading === attempt) loading = null;
    });
  }
  return loading;
}
