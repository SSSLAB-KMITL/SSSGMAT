// scenario ที่เปิดอยู่: เอกสาร, ต้นไม้ Object Browser, รายชื่อดาวของ snapshot (W9) และ ETag สำหรับเขียนกลับ
//
// - load(name) ดึงเอกสาร + ต้นไม้ + catalog แล้วค่อยใส่ store ทีเดียว ไม่ทิ้งสถานะครึ่งเปิด ล้มเหลวทุกแบบจบด้วยข้อความไทยใน Message Viewer ไม่โยน
// - การเขียนทุกแบบส่ง If-Match = ETag ที่อ่านล่าสุดตามตัว (มีเครื่องหมายคำพูด) 412 -> conflict = true แล้วโยน ApiError ต่อ doc/ETag ไม่เปลี่ยน
//   (การแก้ถูกบันทึกทันทีตอน Apply จึงหลังเขียนสำเร็จโหลด doc และ tree ใหม่ ไม่เก็บสำเนาในเครื่อง)
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
  /** เปิด scenario; true = เปิดได้ false = เปิดไม่ได้ (มีข้อความใน Message Viewer; scenario ที่เปิดอยู่ก่อนไม่เปลี่ยน) */
  load(name: string): Promise<boolean>;
  /** โหลด doc + tree ใหม่จาก server แล้วล้าง conflict (ล้มเหลว = ข้อความใน Message Viewer และ conflict ค้างอยู่) */
  reload(): Promise<void>;
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
};

const enc = encodeURIComponent;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** เอกสารและต้นไม้ที่ server ส่งมาใช้งานได้ไหม; ไม่ได้ = RangeError (เวลาใน analysis_period/animation อ่านไม่ได้ก็เช่นกัน) */
function assertUsable(doc: unknown, tree: unknown): asserts doc is ScenarioDoc {
  if (!isRecord(doc) || typeof doc.name !== "string" || !isRecord(doc.analysis_period) || !Array.isArray(doc.objects)) {
    throw new RangeError("the scenario document is incomplete");
  }
  timeFromScenario(doc as ScenarioDoc);
  if (!isRecord(tree) || !Array.isArray(tree.children)) throw new RangeError("the object tree is incomplete");
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
  /** จำนวนการเขียนของเราที่ยังค้าง: event ของ scenario ช่วงนี้เป็นของการเขียนนั้น ไม่ต้องโหลดซ้อน */
  let writing = 0;
  /** นับทุกครั้งที่ doc/ETag ถูกเปลี่ยน: การโหลดที่เริ่มก่อนหน้านั้นและตอบมาทีหลังเป็นข้อมูลเก่า ทิ้ง */
  let version = 0;

  const base = (name: string) => `/scenarios/${enc(name)}`;

  /** ใส่ doc/tree/ETag ที่ได้มา (ถ้า guard ยังจริง) โหลด catalog ใหม่ถ้า snapshot หรือช่วงวิเคราะห์เปลี่ยน และตั้งเวลาใหม่ถ้าช่วงหรือ animation เปลี่ยน */
  const commit = async (doc: ScenarioDoc, etag: string | null, tree: ObjectTree, guard: () => boolean): Promise<void> => {
    const prev = get().doc;
    const catalog = catalogInputs(prev) === catalogInputs(doc) ? get().catalog : await loadCatalog(doc, undefined);
    if (!guard()) return;
    version++;
    set({ doc, etag: etag ?? get().etag, tree, catalog });
    if (timeInputs(prev) !== timeInputs(doc)) useTime.getState().init(doc);
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
      if (isAbortError(e)) return;
      report("warning", e instanceof ApiError ? e.code : "SCENARIO_UNUSABLE", msg("scenario.reloadFailed", { name: name ?? "", message: errorText(e) }));
    }
  };

  const send = async <T>(method: string, suffix: string, body?: unknown): Promise<ApiResult<T>> => {
    const { name, etag } = get();
    if (name === null || etag === null) throw new Error("no scenario is open");
    writing++;
    try {
      return await apiSend<T>(method, `${base(name)}${suffix}`, body, etag);
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) set({ conflict: true });
      throw e;
    } finally {
      writing--;
    }
  };

  /** หลังเขียนสำเร็จ: เก็บ ETag ใหม่ แล้วโหลด doc + tree ใหม่ (และผลลัพธ์ถ้าตอนนี้ไม่ตรงแล้ว) */
  const afterWrite = async (res: ApiResult<{ etag?: unknown; results_stale?: unknown }>): Promise<WriteResult> => {
    const bodyTag = isRecord(res.data) && typeof res.data.etag === "string" ? res.data.etag : null;
    const tag = res.etag ?? bodyTag;
    version++;
    if (tag !== null) set({ etag: tag });
    const stale = isRecord(res.data) && res.data.results_stale === true;
    await Promise.all([pullQuiet(), stale ? useResults.getState().refresh() : undefined]);
    return { stale };
  };

  const write = async (method: string, suffix: string, body?: unknown): Promise<WriteResult> => afterWrite(await send(method, suffix, body));

  return {
    ...EMPTY,

    load: async (name) => {
      loadCtl?.abort();
      const ctl = new AbortController();
      loadCtl = ctl;
      const token = ++loadSeq;
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
        version++;
        set({ name, doc, etag: docRes.etag, tree: treeRes.data as ObjectTree, catalog, conflict: false });
        useSelection.getState().select(null);
        useResults.getState().reset();
        useTime.getState().init(doc);
        await useResults.getState().refresh();
        return true;
      } catch (e) {
        if (token !== loadSeq) return false; // มี load ใหม่กว่า (หรือ close) แล้ว ผลของรอบนี้ไม่ใช่เรื่องของใครอีก
        ctl.abort();
        if (isAbortError(e)) return false;
        report("error", e instanceof ApiError ? e.code : "SCENARIO_UNUSABLE", msg("scenario.openFailed", { name, message: errorText(e) }));
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

    resync: () => pullQuiet(true),

    close: () => {
      loadSeq++;
      loadCtl?.abort();
      loadCtl = null;
      version++;
      set({ ...EMPTY, catalog: new Map() });
      useResults.getState().reset();
      useSelection.getState().select(null);
    },

    putDoc: async (mutate) => {
      const { doc, name } = get();
      if (doc === null || name === null) throw new Error("no scenario is open");
      const draft = structuredClone(doc);
      mutate(draft);
      const res = await send<ScenarioDoc>("PUT", "", draft);
      const stale = res.headers.get("X-Results-Stale")?.trim().toLowerCase() === "true";
      version++;
      const etag = res.etag ?? get().etag;
      set({ etag });
      // เอกสารที่ server ตอบกลับคือที่บันทึกจริง (เติมค่าเริ่มต้นแล้ว) ใช้เลย ต้นไม้ดึงใหม่
      try {
        const treeRes = await apiGet<unknown>(`${base(name)}/objects`);
        assertUsable(res.data, treeRes.data);
        await commit(res.data, etag, treeRes.data as ObjectTree, () => get().name === name);
      } catch (e) {
        if (!isAbortError(e)) report("warning", e instanceof ApiError ? e.code : "SCENARIO_UNUSABLE", msg("scenario.reloadFailed", { name, message: errorText(e) }));
      }
      if (stale) await useResults.getState().refresh();
      return { stale };
    },

    patchObject: (cls, name, pages) => write("PATCH", `/objects/${enc(cls)}/${enc(name)}`, pages),

    insert: async (body) => {
      const res = await send<{ created?: unknown; etag?: unknown; results_stale?: unknown }>("POST", "/objects", body);
      await afterWrite(res);
      return Array.isArray(res.data.created) ? res.data.created.filter((p): p is string => typeof p === "string") : [];
    },

    rename: (cls, name, newName) => write("POST", `/objects/${enc(cls)}/${enc(name)}/rename`, { new_name: newName }),

    remove: (cls, name) => write("DELETE", `/objects/${enc(cls)}/${enc(name)}`),

    setGroup: (name, members) => write("POST", "/groups", { name, members }),

    onScenarioEvent: async (e) => {
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
