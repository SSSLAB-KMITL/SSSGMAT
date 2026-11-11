// scenario ที่เปิดอยู่: เอกสาร, ต้นไม้ Object Browser, รายชื่อดาวของ snapshot (W9) และ ETag สำหรับเขียนกลับ
//
// - load(name) ดึงเอกสาร + ต้นไม้ + catalog แล้วค่อยใส่ store ทีเดียว ไม่ทิ้งสถานะครึ่งเปิด ล้มเหลวทุกแบบจบด้วยข้อความไทยใน Message Viewer ไม่โยน
// - การเขียนทุกแบบ (PATCH, insert, rename, DELETE, groups, PUT) เข้าคิวเดียว ทีละอย่าง: อ่าน ETag เมื่อถึงคิวของมัน หลังอย่างก่อนหน้าจบรวมทั้งโหลด doc/tree ใหม่แล้ว
//   (ไม่งั้นการเขียนที่สองส่งต่อกันเร็ว ๆ ใช้ ETag เก่าและได้ 412 ปลอม) การเขียนที่ล้มเหลวไม่ขวางคิว; คิวว่างอยู่ = เริ่มทันที
// - การเขียนทุกแบบส่ง If-Match = ETag ที่อ่านล่าสุดตามตัว (มีเครื่องหมายคำพูด) 412 -> conflict = true แล้วโยน ApiError ต่อ doc/ETag ไม่เปลี่ยน
//   (การแก้ถูกบันทึกทันทีตอน Apply จึงหลังเขียนสำเร็จโหลด doc และ tree ใหม่ ไม่เก็บสำเนาในเครื่อง)
// - doc กับ ETag ต้องไปด้วยกันเสมอ: PUT เก็บเอกสารที่ server ตอบกลับพร้อม ETag ใหม่ทันที ส่วน PATCH/insert/rename/remove/group ตอบแค่ ETag
//   ถ้าโหลด doc ใหม่ไม่สำเร็จ ETag ใหม่ก็ใช้ต่อได้ (การเขียนเรื่อง object ไม่ต้องใช้ doc) แต่ตั้ง docStale = true และ putDoc (ที่ส่ง doc ทั้งก้อน)
//   จะโหลดใหม่ก่อน ถ้าโหลดไม่ได้ก็ปฏิเสธ (DOC_STALE) ไม่เอา doc เก่าไปทับการแก้ครั้งก่อน
// - การเขียนที่จบหลังจากปิดหรือสลับ scenario แล้ว ไม่แตะ store (ไม่ใช่ scenario เดียวกันแล้ว)
// - event `scenario` ของ scenario ที่เปิดอยู่: ETag ต่างจากที่ถืออยู่ = โหลด doc และ tree ใหม่เงียบ ๆ; etag null = ถูกลบ -> ปิดแล้วเตือน;
//   results_stale = ดึงสถานะผลลัพธ์ใหม่
// หมายเหตุ: stores/results.ts อ่านชื่อ scenario จาก store นี้ และ store นี้เรียก results.refresh() จึง import กันเป็นวง
// ใช้เฉพาะในฟังก์ชัน ไม่แตะกันตอนโหลดโมดูล

import { create } from "zustand";
import { ApiError, apiGet, apiSend, errorText, isAbortError, normalizeEtag, type ApiResult } from "../api/client";
import type { components } from "../api/types.gen";
import type { CatalogEntry } from "../data/catalog";
import { msg } from "../labels/messages.th";
import { parseIsoUtc } from "../time/parse";
import { report } from "./messages";
import { useResults } from "./results";
import { useSelection } from "./selection";
import { timeFromScenario, useTime } from "./time";

export type ScenarioDoc = components["schemas"]["ScenarioDoc"];

export interface TreeObject {
  path: string;
  class: "Facility" | "Constellation" | "Satellite";
  name: string;
  color: string;
  show: boolean;
}
export interface TreeGroup {
  group: string;
  children: TreeObject[];
}
export type TreeNode = TreeObject | TreeGroup;
/** ต้นไม้ของ Object Browser: Facility, Constellation, โฟลเดอร์กลุ่ม แล้วดาวที่ไม่อยู่ในกลุ่มใด (ตามลำดับที่ server ส่ง) */
export interface ObjectTree {
  path: "*";
  class: "Scenario";
  name: string;
  children: TreeNode[];
}

export type PageGroup = "basic" | "graphics2d" | "graphics3d" | "constraints";
/** body ของ PATCH: เฉพาะกลุ่มหน้าที่แก้ */
export type ObjectPages = Partial<Record<PageGroup, Record<string, unknown>>>;
export interface InsertBody {
  class: string;
  method: string;
  [key: string]: unknown;
}

/** event `scenario` ของ SSE (etag เปล่าไม่มีเครื่องหมายคำพูด; null = scenario ถูกลบ) */
export interface ScenarioEvent {
  name: string;
  etag: string | null;
  results_stale: boolean;
}

interface WriteResult {
  stale: boolean;
}

interface ScenarioState {
  name: string | null;
  doc: ScenarioDoc | null;
  /** ค่า header ETag ล่าสุดตามที่ได้รับ (ส่งกลับใน If-Match ตามตัว) */
  etag: string | null;
  tree: ObjectTree | null;
  /** ดาวของ snapshot ที่ scenario ใช้ ตาม NORAD (โหลดครั้งเดียวต่อการเปิด) */
  catalog: Map<number, CatalogEntry>;
  /** เขียนด้วย ETag เก่า (412) ค้างอยู่: รอผู้ใช้กด Reload (reload() ล้าง) */
  conflict: boolean;
  /** doc เก่ากว่า etag: การเขียนครั้งล่าสุดสำเร็จแต่โหลด doc ใหม่ไม่ได้ (การโหลดที่สำเร็จครั้งถัดไปล้าง) putDoc จะโหลดใหม่ก่อน */
  docStale: boolean;
  /**
   * เหตุที่ load ครั้งล่าสุดล้มเหลว (null = ไม่ล้มเหลว): status = HTTP status ที่ server ตอบ (0 = ไม่ใช่คำตอบ HTTP เช่นต่อ server ไม่ได้
   * หรือเอกสารใช้ไม่ได้), code = code ของ server (NOT_FOUND ฯลฯ) ผู้เรียกใช้ตัดสินใจต่อ เช่น 404 NOT_FOUND = scenario หายไปแล้ว
   * ล้างเมื่อเริ่ม load ใหม่ เมื่อเปิดได้ และเมื่อ close; load ที่ถูกแซงด้วย load/close ใหม่กว่าไม่บันทึกอะไร
   */
  loadFailure: { name: string; status: number; code: string } | null;
  /** เปิด scenario; true = เปิดได้ false = เปิดไม่ได้ (มีข้อความใน Message Viewer และ loadFailure; scenario ที่เปิดอยู่ก่อนไม่เปลี่ยน) */
  load(name: string): Promise<boolean>;
  /** โหลด doc + tree ใหม่จาก server แล้วล้าง conflict (ล้มเหลว = ข้อความใน Message Viewer และ conflict ค้างอยู่) */
  reload(): Promise<void>;
  /** Cancel ในกล่อง 412: ปิดกล่องโดยไม่โหลดใหม่ (ค่าบนหน้านี้คงเดิม ETag ยังเก่า เขียนครั้งต่อไปจะได้ 412 อีก) */
  clearConflict(): void;
  /** โหลดใหม่เงียบ ๆ ถ้า ETag บน server ต่างจากที่ถืออยู่ (ตอนต่อ SSE ใหม่เพื่อปิดช่องว่างที่ event หลุด) */
  resync(): Promise<void>;
  close(): void;
  /** Apply หน้า Scenario (W16): แก้สำเนาของ doc ด้วย mutate แล้ว PUT ทั้งก้อน */
  putDoc(mutate: (doc: ScenarioDoc) => void): Promise<WriteResult>;
  /** Apply หน้า object (W16): PATCH เฉพาะกลุ่มหน้าที่แก้ */
  patchObject(cls: string, name: string, pages: ObjectPages): Promise<WriteResult>;
  /** Insert STK Objects: คืน path ของ object ที่สร้าง */
  insert(body: InsertBody): Promise<string[]>;
  rename(cls: string, name: string, newName: string): Promise<WriteResult>;
  remove(cls: string, name: string): Promise<WriteResult>;
  /** New Group / ย้ายสมาชิก (members ต้องส่งเสมอ กลุ่มว่าง = []) */
  setGroup(name: string, members: string[]): Promise<WriteResult>;
  onScenarioEvent(e: ScenarioEvent): Promise<void>;
}

const EMPTY = {
  name: null,
  doc: null,
  etag: null,
  tree: null,
  catalog: new Map<number, CatalogEntry>(),
  conflict: false,
  docStale: false,
  loadFailure: null,
};

const enc = encodeURIComponent;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** เอกสารที่ server ส่งมาใช้งานได้ไหม; ไม่ได้ = RangeError (เวลาใน analysis_period/animation อ่านไม่ได้ก็เช่นกัน) */
function assertDoc(doc: unknown): asserts doc is ScenarioDoc {
  if (!isRecord(doc) || typeof doc.name !== "string" || !isRecord(doc.analysis_period) || !Array.isArray(doc.objects)) {
    throw new RangeError("the scenario document is incomplete");
  }
  timeFromScenario(doc as ScenarioDoc);
}

function assertTree(tree: unknown): asserts tree is ObjectTree {
  if (!isRecord(tree) || !Array.isArray(tree.children)) throw new RangeError("the object tree is incomplete");
}

function assertUsable(doc: unknown, tree: unknown): asserts doc is ScenarioDoc {
  assertDoc(doc);
  assertTree(tree);
}

/** ตัวแปรที่กำหนดว่าต้องโหลด catalog ใหม่ไหม */
const catalogInputs = (doc: ScenarioDoc | null): string | null =>
  doc === null ? null : JSON.stringify([doc.orbit_snapshot, doc.analysis_period.start, doc.analysis_period.stop]);

const timeInputs = (doc: ScenarioDoc | null): string | null => (doc === null ? null : JSON.stringify([doc.analysis_period, doc.animation ?? null]));

function isCatalogEntry(x: unknown): x is CatalogEntry {
  return isRecord(x) && typeof x.norad === "number" && typeof x.prn === "string" && Array.isArray(x.flags);
}

async function fetchCatalog(doc: ScenarioDoc, signal: AbortSignal | undefined): Promise<Map<number, CatalogEntry>> {
  const start = parseIsoUtc(doc.analysis_period.start);
  const stop = parseIsoUtc(doc.analysis_period.stop);
  if (start === null || stop === null) throw new RangeError("analysis_period is not readable");
  const q = new URLSearchParams({ snapshot: doc.orbit_snapshot, start: start.toISOString(), stop: stop.toISOString() });
  const { data } = await apiGet<unknown>(`/catalog?${q}`, { signal });
  if (!Array.isArray(data)) throw new RangeError("the catalog is not a list");
  return new Map(data.filter(isCatalogEntry).map((e) => [e.norad, e]));
}

/** catalog ล้มเหลว (เช่น snapshot หาย) = ว่างพร้อมเตือน scenario ยังเปิดได้ ยกเลิกโยนต่อ */
async function loadCatalog(doc: ScenarioDoc, signal: AbortSignal | undefined): Promise<Map<number, CatalogEntry>> {
  try {
    return await fetchCatalog(doc, signal);
  } catch (e) {
    if (isAbortError(e)) throw e;
    report("warning", e instanceof ApiError ? e.code : "CATALOG", msg("catalog.failed", { message: errorText(e) }));
    return new Map();
  }
}

export const useScenario = create<ScenarioState>()((set, get) => {
  let loadSeq = 0;
  let loadCtl: AbortController | null = null;
  /** จำนวนการเขียนของเราที่ยังค้าง (รอคิวหรือกำลังทำ): event ของ scenario ช่วงนี้เป็นของการเขียนนั้น ไม่ต้องโหลดซ้อน */
  let writing = 0;
  /** ท้ายคิวการเขียน (null = คิวว่าง) */
  let tail: Promise<void> | null = null;
  /** นับทุกครั้งที่ doc/ETag ถูกเปลี่ยน: การโหลดที่เริ่มก่อนหน้านั้นและตอบมาทีหลังเป็นข้อมูลเก่า ทิ้ง */
  let version = 0;
  /** scenario ที่กำลังเปิดอยู่ (load ยังไม่เสร็จ) และ event `scenario` ของมันที่มาถึงก่อนเปิดเสร็จ: เก็บไว้เล่นซ้ำหลังเปิด */
  let opening: { name: string; token: number; events: ScenarioEvent[] } | null = null;

  const base = (name: string) => `/scenarios/${enc(name)}`;

  /** doc + ETag (+ tree, catalog ถ้ามี) เข้า store พร้อมกันทีเดียว ล้าง docStale และตั้งเวลาใหม่ถ้าช่วงวิเคราะห์หรือ animation เปลี่ยน */
  const applyDoc = (doc: ScenarioDoc, etag: string | null, extra: { tree?: ObjectTree; catalog?: Map<number, CatalogEntry> } = {}): void => {
    const prev = get().doc;
    version++;
    set({ doc, etag: etag ?? get().etag, docStale: false, ...extra });
    if (timeInputs(prev) !== timeInputs(doc)) useTime.getState().init(doc);
  };

  /** ใส่ doc/tree/ETag ที่ได้มา (ถ้า guard ยังจริง) โหลด catalog ก่อนถ้า snapshot หรือช่วงวิเคราะห์เปลี่ยน จะได้เปลี่ยนพร้อมกัน */
  const commit = async (doc: ScenarioDoc, etag: string | null, tree: ObjectTree, guard: () => boolean): Promise<void> => {
    const catalog = catalogInputs(get().doc) === catalogInputs(doc) ? get().catalog : await loadCatalog(doc, undefined);
    if (!guard()) return;
    applyDoc(doc, etag, { tree, catalog });
  };

  /** โหลด doc + tree ของ scenario ที่เปิดอยู่ ผิดพลาดโยน; onlyIfChanged = ดึง doc ก่อน ETag เท่าเดิมก็จบ */
  const pull = async (onlyIfChanged = false): Promise<void> => {
    const name = get().name;
    if (name === null) return;
    const v0 = version;
    let docRes: ApiResult<unknown>;
    let treeRes: ApiResult<unknown>;
    if (onlyIfChanged) {
      docRes = await apiGet<unknown>(base(name));
      const have = get().etag;
      if (have !== null && docRes.etag !== null && normalizeEtag(have) === normalizeEtag(docRes.etag)) return;
      treeRes = await apiGet<unknown>(`${base(name)}/objects`);
    } else {
      [docRes, treeRes] = await Promise.all([apiGet<unknown>(base(name)), apiGet<unknown>(`${base(name)}/objects`)]);
    }
    assertUsable(docRes.data, treeRes.data);
    await commit(docRes.data, docRes.etag, treeRes.data as ObjectTree, () => get().name === name && version === v0);
  };

  /** pull ที่ผิดพลาดแล้วแค่เตือน (ใช้หลังเขียนสำเร็จ และตอนโหลดเงียบจาก event) */
  const pullQuiet = async (onlyIfChanged = false): Promise<void> => {
    const name = get().name;
    try {
      await pull(onlyIfChanged);
    } catch (e) {
      warnReload(name ?? "", e);
    }
  };

  const openName = (): string => {
    const name = get().name;
    if (name === null) throw new Error("no scenario is open");
    return name;
  };

  const warnReload = (name: string, e: unknown): void => {
    if (isAbortError(e)) return;
    report("warning", e instanceof ApiError ? e.code : "SCENARIO_UNUSABLE", msg("scenario.reloadFailed", { name, message: errorText(e) }));
  };

  /** ทำการเขียนทีละอย่างตามลำดับที่เรียก (คิวว่าง = เริ่มทันทีในจังหวะเดียวกับที่เรียก) ที่ล้มเหลวไม่ขวางอันถัดไป */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    writing++;
    const exec = async (): Promise<T> => {
      try {
        return await task();
      } finally {
        writing--;
      }
    };
    const run = tail === null ? exec() : tail.then(exec);
    const mine = run.then(
      () => undefined,
      () => undefined,
    );
    tail = mine;
    void mine.then(() => {
      if (tail === mine) tail = null;
    });
    return run;
  };

  /** เขียนไปที่ scenario `scenario` (ต้องยังเป็นตัวที่เปิดอยู่) ด้วย ETag ล่าสุด เรียกจากในคิวการเขียน (serial) เท่านั้น */
  const send = async <T>(scenario: string, method: string, suffix: string, body?: unknown): Promise<ApiResult<T>> => {
    const etag = get().name === scenario ? get().etag : null;
    if (etag === null) throw new Error("no scenario is open");
    try {
      return await apiSend<T>(method, `${base(scenario)}${suffix}`, body, etag);
    } catch (e) {
      if (e instanceof ApiError && e.status === 412 && get().name === scenario) set({ conflict: true });
      throw e;
    }
  };

  /** หลังเขียนสำเร็จ (ตอบแค่ ETag): เก็บ ETag ใหม่ แล้วโหลด doc + tree ใหม่ (และผลลัพธ์ถ้าตอนนี้ไม่ตรงแล้ว) */
  const afterWrite = async (name: string, res: ApiResult<{ etag?: unknown; results_stale?: unknown }>): Promise<WriteResult> => {
    const stale = isRecord(res.data) && res.data.results_stale === true;
    if (get().name !== name) return { stale }; // ปิดหรือสลับ scenario ระหว่างเขียน: ไม่ใช่เรื่องของ store นี้แล้ว
    const bodyTag = isRecord(res.data) && typeof res.data.etag === "string" ? res.data.etag : null;
    const tag = res.etag ?? bodyTag;
    version++;
    // doc ที่ถืออยู่เก่ากว่า ETag ใหม่จนกว่าจะโหลดใหม่สำเร็จ (applyDoc ล้างเครื่องหมายนี้)
    set({ ...(tag !== null ? { etag: tag } : {}), docStale: true });
    await Promise.all([pullQuiet(), stale ? useResults.getState().refresh() : undefined]);
    return { stale };
  };

  const write = async (method: string, suffix: string, body?: unknown): Promise<WriteResult> => {
    const name = openName(); // scenario ที่เปิดอยู่ตอนสั่ง: ถึงคิวแล้วถ้าสลับไปแล้วไม่เขียนทับของใหม่ (send ตรวจ)
    return serial(async () => afterWrite(name, await send(name, method, suffix, body)));
  };

  /** putDoc ต้องใช้ doc ล่าสุด: ถ้า doc เก่ากว่า ETag (docStale) โหลดใหม่ก่อน โหลดไม่ได้ = ปฏิเสธ ไม่เอา doc เก่าไปทับ */
  const ensureFreshDoc = async (name: string): Promise<void> => {
    try {
      await pull();
    } catch {
      // ตกไปตรวจ docStale ด้านล่าง (ข้อความ server ไม่ใช่เรื่องของผู้ใช้ตรงนี้: เรื่องคือยังบันทึกไม่ได้)
    }
    if (get().name !== name) throw new Error("the open scenario changed");
    if (get().docStale) throw new ApiError({ status: 0, code: "DOC_STALE", text: msg("scenario.docStale") });
  };

  /** ต้นไม้ใหม่หลัง PUT (doc มาแล้วกับตัว PUT) ล้มเหลวแค่เตือน ต้นไม้เก่ากว่าไม่กระทบการเขียนครั้งถัดไป */
  const refreshTree = async (name: string): Promise<void> => {
    const v0 = version;
    try {
      const { data } = await apiGet<unknown>(`${base(name)}/objects`);
      assertTree(data);
      if (get().name === name && version === v0) set({ tree: data });
    } catch (e) {
      warnReload(name, e);
    }
  };

  /** catalog ใหม่หลัง PUT ถ้า snapshot หรือช่วงวิเคราะห์เปลี่ยน (doc เข้า store ไปแล้ว catalog ตามมา) */
  const refreshCatalog = async (name: string, before: ScenarioDoc | null, saved: ScenarioDoc): Promise<void> => {
    if (catalogInputs(before) === catalogInputs(saved)) return;
    const catalog = await loadCatalog(saved, undefined);
    if (get().name === name && catalogInputs(get().doc) === catalogInputs(saved)) set({ catalog });
  };

  return {
    ...EMPTY,

    load: async (name) => {
      loadCtl?.abort();
      const ctl = new AbortController();
      loadCtl = ctl;
      const token = ++loadSeq;
      opening = { name, token, events: [] };
      if (get().loadFailure !== null) set({ loadFailure: null });
      const { signal } = ctl;
      try {
        const [docRes, treeRes] = await Promise.all([
          apiGet<unknown>(base(name), { signal }),
          apiGet<unknown>(`${base(name)}/objects`, { signal }),
        ]);
        assertUsable(docRes.data, treeRes.data);
        const doc = docRes.data;
        const catalog = await loadCatalog(doc, signal);
        if (token !== loadSeq) return false;
        const held = opening?.token === token ? opening.events : [];
        opening = null;
        version++;
        set({ name, doc, etag: docRes.etag, tree: treeRes.data as ObjectTree, catalog, conflict: false, docStale: false });
        useSelection.getState().select(null);
        useResults.getState().reset();
        useTime.getState().init(doc);
        // event ที่มาถึงระหว่างเปิด (ก่อนมี doc ให้เทียบ ETag) เล่นซ้ำตอนนี้: ETag ต่างจากที่โหลดมา = โหลดใหม่, ถูกลบ = ปิด, results_stale = ดึงผลลัพธ์
        await Promise.all([useResults.getState().refresh(), ...held.map((e) => get().onScenarioEvent(e))]);
        return true;
      } catch (e) {
        if (token !== loadSeq) return false; // มี load ใหม่กว่า (หรือ close) แล้ว ผลของรอบนี้ไม่ใช่เรื่องของใครอีก
        opening = null;
        ctl.abort();
        if (isAbortError(e)) return false;
        const code = e instanceof ApiError ? e.code : "SCENARIO_UNUSABLE";
        set({ loadFailure: { name, status: e instanceof ApiError ? e.status : 0, code } });
        report("error", code, msg("scenario.openFailed", { name, message: errorText(e) }));
        return false;
      }
    },

    reload: async () => {
      const name = get().name;
      if (name === null) return;
      try {
        await pull();
      } catch (e) {
        if (isAbortError(e)) return;
        report("error", e instanceof ApiError ? e.code : "SCENARIO_UNUSABLE", msg("scenario.reloadFailed", { name, message: errorText(e) }));
        return;
      }
      if (get().name === name) set({ conflict: false });
    },

    clearConflict: () => set({ conflict: false }),

    resync: () => pullQuiet(true),

    close: () => {
      loadSeq++;
      loadCtl?.abort();
      loadCtl = null;
      opening = null;
      version++;
      set({ ...EMPTY, catalog: new Map() });
      useResults.getState().reset();
      useSelection.getState().select(null);
    },

    putDoc: async (mutate) => {
      const name = openName();
      return serial(async () => {
        if (get().docStale) await ensureFreshDoc(name);
        const doc = get().doc; // อ่านเมื่อถึงคิว: ต่อยอดจากเอกสารที่การเขียนก่อนหน้าเพิ่งบันทึก
        if (doc === null || get().name !== name) throw new Error("no scenario is open");
        const draft = structuredClone(doc);
        mutate(draft);
        const res = await send<ScenarioDoc>(name, "PUT", "", draft);
        const stale = res.headers.get("X-Results-Stale")?.trim().toLowerCase() === "true";
        if (get().name !== name) return { stale }; // ปิดหรือสลับ scenario ระหว่างเขียน
        const refreshResults = stale ? useResults.getState().refresh() : undefined;
        let saved: ScenarioDoc | null = null;
        try {
          assertDoc(res.data);
          saved = res.data;
        } catch {
          saved = null;
        }
        if (saved !== null && res.etag !== null) {
          // เอกสารที่ server ตอบกลับคือที่บันทึกจริง (เติมค่าเริ่มต้นแล้ว) ใช้พร้อม ETag ใหม่ทันที ต่อให้โหลดต้นไม้ไม่ได้ doc กับ ETag ก็ยังไปด้วยกัน
          const before = get().doc;
          applyDoc(saved, res.etag);
          await Promise.all([refreshCatalog(name, before, saved), refreshTree(name), refreshResults]);
        } else {
          // ตอบมาไม่ครบ (ไม่มี ETag หรือเอกสารอ่านไม่ได้): ไม่รู้ว่า doc กับ ETag ตัวไหนถูก โหลดใหม่ทั้งหมด
          version++;
          set({ docStale: true });
          await Promise.all([pullQuiet(), refreshResults]);
        }
        return { stale };
      });
    },

    patchObject: (cls, name, pages) => write("PATCH", `/objects/${enc(cls)}/${enc(name)}`, pages),

    insert: async (body) => {
      const name = openName();
      return serial(async () => {
        const res = await send<{ created?: unknown; etag?: unknown; results_stale?: unknown }>(name, "POST", "/objects", body);
        await afterWrite(name, res);
        return Array.isArray(res.data.created) ? res.data.created.filter((p): p is string => typeof p === "string") : [];
      });
    },

    rename: (cls, name, newName) => write("POST", `/objects/${enc(cls)}/${enc(name)}/rename`, { new_name: newName }),

    remove: (cls, name) => write("DELETE", `/objects/${enc(cls)}/${enc(name)}`),

    setGroup: (name, members) => write("POST", "/groups", { name, members }),

    onScenarioEvent: async (e) => {
      if (opening !== null && e.name === opening.name) {
        opening.events.push(e); // ยังเปิดอยู่ ยังไม่มี ETag ให้เทียบ: เก็บไว้เล่นซ้ำหลังเปิดเสร็จ
        return;
      }
      const s = get();
      if (s.name === null || e.name !== s.name) return;
      if (e.etag === null) {
        get().close();
        report("warning", "SCENARIO_DELETED", msg("scenario.deleted", { name: e.name }));
        return;
      }
      const tasks: Promise<void>[] = [];
      if (writing === 0 && (s.etag === null || normalizeEtag(s.etag) !== normalizeEtag(e.etag))) tasks.push(pullQuiet());
      if (e.results_stale) tasks.push(useResults.getState().refresh());
      await Promise.all(tasks);
    },
  };
});
