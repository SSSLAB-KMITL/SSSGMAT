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

/** node ของแผงโซลาร์ของโมเดล id ตาม wing_nodes ใน catalog (ชื่อต่างกันต่อโมเดล: galileo-foc ใช้ solar_wing_±Y) ไม่มี = ชื่อมาตรฐานตามจำนวนแผง */
export function wingNodesOf(cat: ModelCatalog, id: string): string[] {
  const m = cat.models.find((x) => x.id === id);
  if (m === undefined) return [];
  if (m.wing_nodes !== undefined) return [...m.wing_nodes];
  return wingsOf(m) === "single" ? ["wing-Y"] : ["wing+Y", "wing-Y"];
}

/**
 * normal ด้านเซลล์ของแผงโซลาร์ตอนมุมศูนย์ (θ = 0) ในกรอบตัวดาว ต่อโมเดล (ใช้กับ attitude.ts wingAngle)
 * ที่มา: หน้าของ material ที่เป็นเซลล์ใน node แผงของ glb จริง (ผลรวม normal จากการพันของสามเหลี่ยม: tests/unit/sat-model-render.test.ts ตรวจกับ glb ทุกตัว)
 * - −X: โมเดลที่มี material "solar_cells" (GNSS ทุกตัว, generic, himawari-9) ตรงกับ NOTES ของ gps-iif, gps-iii ("solar cells facing −X")
 *   และ galileo-foc ("the cell side faces body −X")
 * - terra +Z: "Main Solar Panels.001" เป็นแผงสองชั้นที่ใช้ texture เซลล์ทั้งสองด้าน (±Z ของตัวดาว พื้นที่เท่ากัน) แกนจึงแน่นอน ด้านเลือก +Z (ด้านไหนก็เห็นเซลล์)
 * - goes +Z: หน้า "Goes2-solarpanel-faces" (สีน้ำเงินของเซลล์) ชี้ +Z ด้านตรงข้ามเป็นโครงสีเทา
 * ไม่อยู่ในรายการ = DEFAULT_WING_ZERO_NORMAL (+X): aqua และ suomi-npp ใช้ texture เดียวกันทั้งสองด้านของแผง บอกไม่ได้ว่าด้านไหนเป็นเซลล์
 * (แนว normal ของแผงทั้งสองตัวคือ ±X จึงยังหันแผงเข้าหาดวงอาทิตย์ แต่ด้านที่เห็นอาจเป็นด้านหลัง)
 */
export const WING_ZERO_NORMAL: Readonly<Record<string, readonly [number, number, number]>> = {
  "galileo-foc": [-1, 0, 0],
  "galileo-iov": [-1, 0, 0],
  "gps-iif": [-1, 0, 0],
  "gps-iii": [-1, 0, 0],
  "gps-iir": [-1, 0, 0],
  "glonass-m": [-1, 0, 0],
  "glonass-k1": [-1, 0, 0],
  "glonass-k2": [-1, 0, 0],
  "bds2-igso": [-1, 0, 0],
  "bds3-geo": [-1, 0, 0],
  "bds3-igso": [-1, 0, 0],
  "bds3-meo-cast": [-1, 0, 0],
  "bds3-meo-secm": [-1, 0, 0],
  "qzss-geo": [-1, 0, 0],
  "qzss-igso": [-1, 0, 0],
  "navic-irnss1": [-1, 0, 0],
  "navic-nvs": [-1, 0, 0],
  generic: [-1, 0, 0],
  "himawari-9": [-1, 0, 0],
  terra: [0, 0, 1],
  goes: [0, 0, 1],
};

export const DEFAULT_WING_ZERO_NORMAL: readonly [number, number, number] = [1, 0, 0];

export function wingZeroNormal(id: string): readonly [number, number, number] {
  return Object.hasOwn(WING_ZERO_NORMAL, id) ? WING_ZERO_NORMAL[id] : DEFAULT_WING_ZERO_NORMAL;
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

/** "glTF" แบบ little-endian ที่ 4 ไบต์แรกของ glb */
const GLB_MAGIC = 0x46546c67;
/** ชนิดของ chunk ใน glb: "JSON" และ "BIN\0" */
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/**
 * extension ของ glTF ที่ Cesium (1.147, ModelUtility.supportedExtensions) รองรับ: extensionsRequired ที่มีชื่ออื่นทำให้ Cesium โหลดไม่ได้
 * test เทียบรายการนี้กับของ Cesium ที่ติดตั้งจริง (Cesium รุ่นใหม่ที่เปลี่ยนรายการทำให้ test ล้ม) ไม่ import Cesium ที่นี่ (ไฟล์นี้ไม่ผูกกับ Cesium)
 */
export const CESIUM_GLTF_EXTENSIONS: ReadonlySet<string> = new Set([
  "AGI_articulations", "CESIUM_mesh_vector", "CESIUM_primitive_outline", "CESIUM_RTC", "EXT_feature_metadata", "EXT_implicit_cylinder_region",
  "EXT_implicit_ellipsoid_region", "EXT_instance_features", "EXT_mesh_features", "EXT_mesh_gpu_instancing", "EXT_mesh_polygon",
  "EXT_mesh_primitive_edge_visibility", "EXT_meshopt_compression", "EXT_primitive_voxels", "EXT_structural_metadata", "EXT_texture_webp", "EXT_voxels",
  "KHR_blend", "KHR_draco_mesh_compression", "KHR_implicit_shapes", "KHR_materials_common", "KHR_materials_pbrSpecularGlossiness",
  "KHR_materials_specular", "KHR_materials_anisotropy", "KHR_materials_clearcoat", "KHR_materials_emissive_strength", "KHR_materials_unlit",
  "KHR_mesh_quantization", "KHR_mesh_primitive_restart", "KHR_meshopt_compression", "KHR_techniques_webgl", "KHR_texture_basisu",
  "KHR_texture_transform", "KHR_gaussian_splatting", "KHR_gaussian_splatting_compression_spz_2", "WEB3D_quantized_attributes",
]);

/**
 * ปัญหาของไฟล์ glb ที่ทำให้ Cesium โหลดไม่ได้ตั้งแต่ขั้นอ่าน JSON (Model.fromGltfAsync ล้มเหลว ซึ่ง ModelVisualizer แค่ console.log ไม่มีทางรู้จากภายนอก)
 * ไม่มีปัญหา = null ตรวจแบบเดียวกับ GltfJsonLoader ของ Cesium แต่เข้มกว่าเรื่องรุ่น (โมเดลของเราเป็น 2.0 ทั้งหมด):
 * หัว glb (magic "glTF" รุ่น 2 ความยาวตรงไฟล์), chunk แรกเป็น JSON ที่อ่านได้ chunk ทั้งหมดพอดีไฟล์ (BIN ไม่เกินหนึ่ง),
 * asset.version = "2.0" และ extensionsRequired (ถ้ามี) เป็นรายการที่ Cesium รองรับทุกตัว (รายการว่างได้)
 */
export function glbProblem(buf: ArrayBuffer): string | null {
  const view = new DataView(buf);
  if (buf.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) return "ไม่ใช่ไฟล์ glb (glTF 2.0)";
  if (view.getUint32(8, true) !== buf.byteLength) return "ความยาวในหัว glb ไม่ตรงกับไฟล์";
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > buf.byteLength) return "glb ไม่มี JSON chunk";
  let at = 20 + jsonLength;
  if (at < buf.byteLength) {
    if (at + 8 > buf.byteLength || view.getUint32(at + 4, true) !== CHUNK_BIN) return "chunk ที่สองของ glb ไม่ใช่ BIN";
    at += 8 + view.getUint32(at, true);
    if (at !== buf.byteLength) return "chunk ของ glb ไม่พอดีไฟล์";
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLength)));
  } catch {
    return "JSON ของ glb อ่านไม่ได้";
  }
  const gltf = (typeof json === "object" && json !== null ? json : {}) as { asset?: { version?: unknown }; extensionsRequired?: unknown };
  const version = gltf.asset?.version;
  if (version !== "2.0") return `glTF รุ่น ${String(version)} (ต้องเป็น 2.0)`;
  const required = gltf.extensionsRequired;
  if (required === undefined) return null;
  if (!Array.isArray(required) || !required.every((e) => typeof e === "string")) return "extensionsRequired ไม่ใช่รายการชื่อ";
  const unsupported = required.filter((e) => !CESIUM_GLTF_EXTENSIONS.has(e));
  return unsupported.length === 0 ? null : `ต้องใช้ extension ที่ Cesium ไม่รองรับ: ${unsupported.join(", ")}`;
}

const glbLoads = new Map<string, Promise<string>>();

/**
 * โหลด glb ที่ url ครั้งเดียวต่อหน้าเว็บ แล้วคืน blob: URL ของไฟล์นั้น (ใช้เป็น uri ของ ModelGraphics)
 * - หนึ่งคำขอต่อไฟล์ไม่ว่ามีดาวกี่ดวงหรือหน้าต่างกี่บาน: Cesium โหลดจาก blob ในเครื่อง (ResourceCache ของมันใช้ร่วมกันตาม uri เดียวกัน)
 * - ตรวจไฟล์ก่อน (glbProblem): ไฟล์ที่หายทำให้ server ตอบหน้าแอป (HTML) สถานะ 200 และ glb ที่ Cesium อ่าน JSON ไม่ได้ ซึ่ง Cesium จะโหลดล้มเหลวเงียบ ๆ
 *   ล้มเหลวที่นี่ผู้เรียกจึงรู้และกลับไปวาดเป็นจุด (ความล้มเหลวหลังจากนั้นใน Cesium: satModelGraphics.watchModelErrors)
 * - ผลล้มเหลวถูกจำไว้ (ไม่ลองซ้ำ ข้อความแจ้งครั้งเดียวต่อโมเดล) จนกว่าจะ resetModelLoads
 */
export function loadModelGlb(url: string): Promise<string> {
  let p = glbLoads.get(url);
  if (p === undefined) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} ตอบ ${res.status}`);
      const buf = await res.arrayBuffer();
      const problem = glbProblem(buf);
      if (problem !== null) throw new Error(`${url}: ${problem}`);
      return URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
    })();
    glbLoads.set(url, p);
  }
  return p;
}

/** ลืม catalog และ glb ที่โหลดไว้ (test) blob URL เดิมไม่ถูกคืน */
export function resetModelLoads(): void {
  glbLoads.clear();
  loading = null;
}
