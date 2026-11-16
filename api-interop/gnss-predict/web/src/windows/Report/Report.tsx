// หน้าต่างรายงาน (spec §6.1, STK ref §F): ตารางของ POST /scenarios/{sc}/reports แบบ JSON
//
// - Report/Graph: สร้างรายงานครั้งเดียวตอนเปิด (และเมื่อ Refresh / F5) ไม่เดินตามเวลา animation แถวมาจาก flattenRows (table.ts)
//   ตารางวาดแบบ virtual (TanStack Virtual): มีใน DOM เฉพาะแถวใกล้พื้นที่เห็น รายงานหลายแสนแถวเลื่อนได้
// - Dynamic Display (params.dynamic): โหลดทั้งช่วงครั้งเดียว แล้วแสดงแถวของเวลา animation ปัจจุบัน (valueAt ของ data/dynamic.ts
//   วิธีประมาณค่าต่อคอลัมน์จาก GET /dataproviders) รีเฟรชไม่เกิน ~10 ครั้งต่อวินาที ไม่เรียก server ทุกเฟรม
//   ช่องว่างระหว่างแถวที่ยาวเกิน max(step ของคำขอ, step ของ scenario) × 1.5 = นอกข้อมูล (No Data)
// - แถบเครื่องมือ: Refresh (F5 เมื่อโฟกัสอยู่ในหน้าต่างนี้), Export ▸ To Excel or CSV Format (ชื่อตาม help.agi.com ไฟล์เป็น CSV) / Setup... (Export Setup เก็บใน windowProps ของหน้าต่าง)
// - คลิกขวาที่ช่องเวลา: Set Animation Time (ตั้งเวลา animation เป็นเวลาของช่องนั้น)
// - ข้อผิดพลาด (spec §8):
//     409 RESULTS_NOT_CURRENT = แถบเตือนเดียวกับหน้าต่าง 3D/2D (ResultsBanner) และ Refresh (หรือ Apply บนแถบ) สั่งคำนวณใหม่:
//       object แบบ Access → POST /access/compute (If-Match) ของ access ที่มีอยู่แล้วซึ่งครอบดาวนั้น (ไม่มี = Facility → ดาวนั้น)
//       ได้ job (202) = รอจน job สำเร็จแล้วสร้างรายงานใหม่ ไม่มี job (ผล current แล้ว) = สร้างใหม่ทันที; object ที่เป็นดาว = POST /propagate
//       รายงานของ Facility ที่ยังไม่มี access = ถามก่อน (confirm) แล้ว Compute ไปทุก Constellation แบบไม่เพิ่มแถว Timeline (ไม่ propagate เพราะไม่ได้ dop.csv)
//       แถบเตือนแสดงทั้งเมื่อ server ตอบ 409 และเมื่อ useResults บอกว่า bundle ของ object ไม่ current (staleStatus)
//     422 STYLE_INVALID = ข้อความใน Message Viewer และตารางว่างพร้อมคำอธิบาย ข้อผิดพลาดอื่น = Message Viewer + ข้อความในหน้าต่าง
// - การโหลด Refresh/F5 แถบเตือน และการคำนวณใหม่อยู่ใน useReportLoader ซึ่งหน้าต่างกราฟ (windows/Graph/Graph.tsx) ใช้ร่วม

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menubar from "@radix-ui/react-menubar";
import { useVirtualizer, type Rect } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { postAccess } from "../../api/access";
import { ApiError, errorText, isAbortError } from "../../api/client";
import { startJob } from "../../api/startJob";
import { confirm } from "../../chrome/Dialogs";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import {
  downloadReport, fetchProviders, fetchReport, type ElementInfo, type ExportSetup, type ReportJson, type ReportRequest,
} from "../../data/reports";
import { t } from "../../labels/labels";
import { msg, type MsgKey } from "../../labels/messages.th";
import { getPanelDef, isPanelKind, registerPanel, type PanelProps } from "../../layout/panels";
import { useJobs } from "../../stores/jobs";
import { useLayout } from "../../stores/layout";
import { report as notify } from "../../stores/messages";
import { useResults, type ResultsInfo } from "../../stores/results";
import { useScenario, type ScenarioDoc } from "../../stores/scenario";
import { useTime } from "../../stores/time";
import type { DateFormat } from "../../time/format";
import { ResultsBanner } from "../graphics/GraphicsFrame";
import { observeViewportWithFallback } from "../virtualList";
import { ExportSetupDialog, parseExportSetup } from "./ExportSetupDialog";
import { columnWidths, dynamicRows, flattenRows, prepareDynamic, registerShownRows, type DynamicSection, type FlatRow } from "./table";

export type ReportParams = {
  style: string;
  kind: "report" | "graph";
  objects: string[];
  time: ReportRequest["time"];
  dynamic: boolean;
};

/** เปิดหน้าต่างของรายงาน (kind graph เปิดหน้าต่างกราฟเมื่อมีชนิดนั้นลงทะเบียนแล้ว ไม่งั้นแสดงเป็นตาราง) params เดิม = โฟกัสบานเดิม */
export function openReport(params: ReportParams): void {
  const kind: string = params.kind;
  useLayout.getState().openPanel(kind !== "report" && isPanelKind(kind) ? kind : "report", params);
}

/** params ของหน้าต่าง (อาจมาจาก workbook ที่แก้มือ) ใช้ไม่ได้ = null */
export function parseReportParams(x: unknown): ReportParams | null {
  if (typeof x !== "object" || x === null) return null;
  const p = x as Record<string, unknown>;
  if (typeof p.style !== "string" || p.style === "") return null;
  if (!Array.isArray(p.objects) || p.objects.length === 0 || !p.objects.every((o) => typeof o === "string" && o !== "")) return null;
  const time = p.time === undefined || p.time === null ? null : typeof p.time === "object" ? (p.time as ReportParams["time"]) : undefined;
  if (time === undefined) return null;
  return { style: p.style, kind: p.kind === "graph" ? "graph" : "report", objects: [...(p.objects as string[])], time, dynamic: p.dynamic === true };
}

export const requestOf = (p: ReportParams): ReportRequest => ({ style: p.style, kind: p.kind, objects: p.objects, time: p.time, dynamic: p.dynamic });

/** อายุของรายงานที่ Report & Graph Manager สร้างไว้ให้หน้าต่างที่เพิ่งเปิด (เกินนี้หน้าต่างสร้างใหม่เอง) */
export const PRIMED_TTL_MS = 30_000;
/** ผลที่ฝากไว้หนึ่งช่อง: กุญแจ = scenario, ETag ของ doc ตอนสร้าง และคำขอ (แก้ scenario แล้ว = ใช้ไม่ได้) */
let primed: { key: string; report: ReportJson; at: number } | null = null;
/** หน้าต่างที่เปิดอยู่ฟังการฝาก: บานที่คำขอตรงกันรับผลไปแสดงทันที (เปิดซ้ำด้วยคำขอเดิม = โฟกัสบานเดิม จึงต้องส่งผลใหม่ให้) */
const primeListeners = new Set<(key: string) => void>();

const primeKey = (sc: string, req: ReportRequest): string => JSON.stringify([sc, useScenario.getState().etag, req]);

/** เก็บผลลงช่องฝาก (ไม่แจ้งหน้าต่างที่เปิดอยู่) คืนกุญแจ */
function storePrimed(sc: string, req: ReportRequest, report: ReportJson): string {
  const key = primeKey(sc, req);
  primed = { key, report, at: Date.now() };
  return key;
}

/**
 * Report & Graph Manager สร้างรายงานก่อนเปิดหน้าต่าง (เพื่อแสดง 409/422 ในกล่องของตัวเอง) แล้วฝากผลไว้ที่นี่
 * - หน้าต่างใหม่ของคำขอเดียวกันใช้ผลนี้ในการโหลดครั้งแรกเท่านั้นแทนการ POST ซ้ำ (Refresh / F5 / คำนวณใหม่ สร้างใหม่ตามปกติ)
 * - หน้าต่างของคำขอเดียวกันที่เปิดอยู่แล้วรับผลนี้ไปแสดงทันที
 * - ผลที่ฝากก่อน doc เปลี่ยน (ETag ต่าง) หรือเก่ากว่า PRIMED_TTL_MS ไม่ถูกใช้
 */
export function primeReport(sc: string, req: ReportRequest, report: ReportJson): void {
  const key = storePrimed(sc, req, report);
  for (const listener of [...primeListeners]) listener(key);
}

/** ใช้ใน test เท่านั้น: ฝากผลโดยไม่ส่งให้หน้าต่างที่เปิดอยู่ (จำลองผลที่ฝากไว้แล้วหน้าต่างไม่ได้รับ) */
export function primeReportUnheardForTest(sc: string, req: ReportRequest, report: ReportJson): void {
  storePrimed(sc, req, report);
}

/** ผลที่ฝากไว้ของคำขอนี้ (ใช้ได้ครั้งเดียว) ไม่มี ไม่ตรง (scenario / ETag / คำขอ) หรือเก่าเกิน PRIMED_TTL_MS = null */
function takePrimed(sc: string, req: ReportRequest): ReportJson | null {
  const hit = primed;
  if (hit === null || hit.key !== primeKey(sc, req)) return null;
  primed = null;
  return Date.now() - hit.at <= PRIMED_TTL_MS ? hit.report : null;
}

const FACILITY = "*/Facility/";
const SATELLITE = "*/Satellite/";
const CONSTELLATION = "*/Constellation/";

/** ชนิดของ object ในรายงาน: คู่ path (P1) = Access */
function objectClass(path: string): "Access" | "Facility" | "Satellite" | null {
  if (path.includes(" ")) return "Access";
  if (path.startsWith(FACILITY)) return "Facility";
  if (path.startsWith(SATELLITE)) return "Satellite";
  return null;
}

/** body ของ POST /access/compute (timeline: false = access ที่สร้างให้รายงานของ Facility ไม่เพิ่มแถวใน Timeline View) */
type Compute = { from: string; to: string[]; timeline?: boolean };

export interface RecomputePlan {
  /** Compute ที่สั่งได้เลย (access ที่มีอยู่แล้ว หรือคู่ Facility–ดาวของรายงาน Access เมื่อ Facility นั้นยังไม่มี access เลย) */
  computes: Compute[];
  /** object ที่เป็นดาว: POST /propagate (ไม่ใช้กับ Facility เพราะ propagate ไม่สร้าง dop.csv) */
  propagate: boolean;
  /** รายงานของ Facility ที่ยังไม่มี access: ต้องถามผู้ใช้ก่อนสร้าง access ใหม่ (ไปทุก Constellation หรือทุกดาวถ้าไม่มี Constellation) */
  needsAccess: Compute[];
  /** Facility ที่คำนวณไม่ได้เพราะ scenario ไม่มีดาวเลย */
  unreachable: string[];
}

/**
 * สิ่งที่ต้องคำนวณใหม่ให้ object ของรายงาน
 * - ดาวในคู่ Access: Compute ของ access ที่มีอยู่แล้วซึ่งครอบดาวนั้น (ตรง ๆ หรือผ่าน Constellation) ไม่มีตัวที่ครอบแต่ Facility มี access อื่น = ใช้ access
 *   นั้น (analyze คำนวณทุกดาวของ Facility อยู่แล้ว ไม่สร้างรายการใหม่) Facility ไม่มี access เลย = Compute คู่นั้นเอง
 * - Facility เปล่า (DOP, N Asset Coverage): access ใดก็ได้ของมัน ไม่มี = needsAccess (ผู้เรียกถามก่อน) ไม่มีดาวใน scenario = unreachable
 * - ดาวเปล่า (LLA): propagate
 */
export function recomputePlan(doc: ScenarioDoc | null, objects: readonly string[]): RecomputePlan {
  const accesses = doc?.accesses ?? [];
  const members = new Map<string, string[]>();
  const constellations: string[] = [];
  const satellites: string[] = [];
  for (const o of doc?.objects ?? []) {
    if (o.class === "Constellation") {
      constellations.push(`${CONSTELLATION}${o.name}`);
      members.set(`${CONSTELLATION}${o.name}`, (o as { assigned_objects?: string[] }).assigned_objects ?? []);
    } else if (o.class === "Satellite") {
      satellites.push(`${SATELLITE}${o.name}`);
    }
  }
  const covers = (to: readonly string[], sat: string): boolean => to.some((p) => p === sat || (members.get(p)?.includes(sat) ?? false));

  const byFacility = new Map<string, Set<string>>();
  let propagate = false;
  for (const obj of objects) {
    const parts = obj.split(" ");
    const facility = parts.find((p) => p.startsWith(FACILITY));
    if (facility === undefined) {
      if (parts.some((p) => p.startsWith(SATELLITE))) propagate = true;
      continue;
    }
    const sats = byFacility.get(facility) ?? new Set<string>();
    for (const p of parts) if (p.startsWith(SATELLITE)) sats.add(p);
    byFacility.set(facility, sats);
  }

  const computes = new Map<string, Compute>();
  const add = (c: Compute): void => void computes.set(JSON.stringify(c), c);
  const needsAccess: Compute[] = [];
  const unreachable: string[] = [];
  for (const [facility, sats] of byFacility) {
    const own = accesses.filter((a) => a.from === facility && Array.isArray(a.to) && a.to.length > 0);
    if (own.length === 0) {
      if (sats.size > 0) add({ from: facility, to: [...sats] });
      else if (constellations.length > 0 || satellites.length > 0) {
        needsAccess.push({ from: facility, to: constellations.length > 0 ? constellations : satellites, timeline: false });
      } else unreachable.push(facility);
      continue;
    }
    if (sats.size === 0) add({ from: facility, to: [...own[0].to] });
    for (const sat of sats) add({ from: facility, to: [...(own.find((a) => covers(a.to, sat)) ?? own[0]).to] });
  }
  return { computes: [...computes.values()], propagate, needsAccess, unreachable };
}

/**
 * สถานะของแถบเตือนผลลัพธ์ของรายงาน: จากสถานะ bundle ใน useResults (access ของ Facility สำหรับ object แบบ Access/Facility, ephem สำหรับดาว)
 * missing ก่อน stale; ไม่มีตัวใดไม่ตรงแต่ server ตอบ 409 (notCurrent) = stale; ไม่งั้น null (ไม่แสดงแถบ)
 */
export function staleStatus(objects: readonly string[], info: ResultsInfo | null, notCurrent: boolean): "stale" | "missing" | null {
  let stale = false;
  for (const obj of objects) {
    const parts = obj.split(" ");
    const facility = parts.find((x) => x.startsWith(FACILITY));
    const status = facility !== undefined ? info?.access[facility.slice(FACILITY.length)]?.status
      : parts.some((x) => x.startsWith(SATELLITE)) ? info?.ephem.status : undefined;
    if (status === "missing") return "missing";
    if (status === "stale") stale = true;
  }
  return stale || notCurrent ? "stale" : null;
}

/** รอ job ทั้งหมดจบ: true = สำเร็จทุกตัว, false = ตัวใดล้มเหลว/ถูกยกเลิก หรือ signal ยกเลิก (Report & Graph Manager ใช้ด้วย) */
export function waitForJobs(ids: readonly string[], signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const check = (): boolean => {
      if (signal.aborted) return finish(false);
      const states = ids.map((id) => useJobs.getState().jobs[id]?.state);
      if (states.some((s) => s === "failed" || s === "cancelled")) return finish(false);
      if (states.every((s) => s === "succeeded")) return finish(true);
      return false;
    };
    let unsubscribe: (() => void) | null = null;
    const onAbort = (): void => void check();
    const finish = (ok: boolean): true => {
      unsubscribe?.();
      signal.removeEventListener("abort", onAbort);
      resolve(ok);
      return true;
    };
    if (check()) return;
    unsubscribe = useJobs.subscribe(() => void check());
    signal.addEventListener("abort", onAbort);
  });
}

/** element ของทุก provider ของชนิด object ในรายงาน (วิธีประมาณค่าของ Dynamic Display) */
async function providerElements(sc: string, objects: readonly string[], signal: AbortSignal): Promise<ElementInfo[]> {
  const classes = [...new Set(objects.map(objectClass).filter((c) => c !== null))];
  const lists = await Promise.all(classes.map((c) => fetchProviders(sc, c, null, { signal })));
  return lists.flat().flatMap((p) => p.elements);
}

type Phase = "loading" | "ready" | "notCurrent" | "styleInvalid" | "failed";

/** ข้อความไทยและรหัสใน Message Viewer ที่ต่างกันระหว่างหน้าต่างรายงานกับหน้าต่างกราฟ */
export interface LoaderMessages {
  /** คำนำรหัสของข้อความ: REPORT_FAILED / GRAPH_FAILED, *_COMPUTE, *_NO_SATELLITES, *_NEEDS_ACCESS (รหัสจาก server ใช้ตามที่ได้มา) */
  codePrefix: "REPORT" | "GRAPH";
  failed: MsgKey;
  computeFailed: MsgKey;
  computeJobFailed: MsgKey;
}

/** สิ่งที่หน้าต่างเตรียมเพิ่มหลังได้รายงาน (Dynamic Display: วิธีประมาณค่า) ก่อนแสดง ยกเลิกด้วย signal */
export type PrepareReport<T> = (report: ReportJson, sc: string, signal: AbortSignal, object: string | null) => Promise<T>;

export interface ReportLoader<T> {
  sc: string | null;
  phase: Phase;
  /** ข้อความของ phase failed */
  failure: string | null;
  loaded: { report: ReportJson; extra: T } | null;
  /** กำลัง Compute / propagate ให้ผลลัพธ์ตรง */
  computing: boolean;
  /** สถานะของ ResultsBanner (null = ไม่แสดง) */
  bannerStatus: "stale" | "missing" | null;
  /** onApply ของ ResultsBanner */
  recompute(): Promise<void>;
  /** Refresh / F5: ผลลัพธ์ไม่ตรง = คำนวณใหม่ก่อน ไม่งั้นสร้างรายงานใหม่ */
  refresh(): void;
  /** ref ของกรอบหน้าต่าง: ได้โฟกัสเมื่อหน้าต่างเปิดหรือถูกเลือก (F5 ใช้ได้ทันทีหลัง Generate) */
  root: RefObject<HTMLDivElement>;
  /** onKeyDown ของกรอบหน้าต่าง: F5 = refresh */
  onKeyDown(e: KeyboardEvent): void;
}

/**
 * โหลดรายงานของหน้าต่างรายงานและหน้าต่างกราฟ (spec §6, §8): POST /reports แบบ JSON ครั้งเดียวต่อ (scenario, params, Refresh)
 * ไม่ขึ้นกับเวลา animation, 409 RESULTS_NOT_CURRENT = แถบเตือน + Refresh/Apply สั่งคำนวณใหม่ (recomputePlan) แล้วสร้างใหม่เมื่อ job สำเร็จ,
 * 422 STYLE_INVALID = Message Viewer, อื่น ๆ = Message Viewer + ข้อความในหน้าต่าง; F5 ในหน้าต่าง = Refresh
 * prepare อ่านจาก ref (ไม่ต้องคงที่)
 */
export function useReportLoader<T>(p: ReportParams | null, panelId: string, prepare: PrepareReport<T>, messages: LoaderMessages): ReportLoader<T> {
  const key = p === null ? "" : JSON.stringify(requestOf(p));
  // scenario ที่หน้าต่างนี้เปิดให้ (ชื่อแรกที่ไม่ใช่ null): เปิด scenario อื่นทับ = sc เป็น null (ไม่สร้าง Refresh คำนวณใหม่ หรือ Export กับ scenario ใหม่)
  // scenarioFiles ปิดหน้าต่างที่ผูกกับ scenario ตอนชื่อเปลี่ยนอยู่แล้ว ตัวนี้กันช่วงก่อนปิดและกรณีที่ไม่มีใครปิด
  const current = useScenario((s) => s.name);
  const boundSc = useRef<string | null>(null);
  if (boundSc.current === null && current !== null) boundSc.current = current;
  const sc = current !== null && current === boundSc.current ? current : null;
  const resultsInfo = useResults((s) => s.info);
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ report: ReportJson; extra: T } | null>(null);
  const [revision, setRevision] = useState(0);
  const [computing, setComputing] = useState(false);
  const latest = useRef({ p, sc, prepare, messages });
  latest.current = { p, sc, prepare, messages };
  // ผลที่ Manager ฝากไว้: หยิบเฉพาะการโหลดครั้งแรกของหน้าต่าง (และเมื่อ Manager ส่งผลใหม่ให้บานนี้) เก็บใน ref จนใช้สำเร็จ
  // effect ที่ถูกยกเลิกแล้วรันซ้ำ (StrictMode) ใช้ตัวเดิมได้ Refresh / คำนวณใหม่ไม่หยิบจากช่องฝาก
  const firstLoad = useRef(true);
  /** rev = revision ที่ผลนี้มีไว้ให้ (โหลดครั้งแรก = 0, ส่งจาก Manager = revision ใหม่) การโหลดของ revision อื่น (Refresh / คำนวณใหม่) ไม่ใช้ */
  const pending = useRef<{ sc: string; key: string; report: ReportJson; rev: number } | null>(null);
  const revisionRef = useRef(0);
  revisionRef.current = revision;
  useEffect(() => {
    const listener = (primedFor: string): void => {
      const { p: cur, sc: name } = latest.current;
      if (cur === null || name === null || primedFor !== primeKey(name, requestOf(cur))) return;
      const report = takePrimed(name, requestOf(cur));
      if (report === null) return;
      const rev = revisionRef.current + 1;
      revisionRef.current = rev;
      pending.current = { sc: name, key: JSON.stringify(requestOf(cur)), report, rev };
      setRevision(rev);
    };
    primeListeners.add(listener);
    return () => void primeListeners.delete(listener);
  }, []);
  // โฟกัสหน้าต่างเมื่อเปิดหรือถูกเลือก (หลัง Generate F5 ใช้ได้ทันที) โฟกัสที่อยู่ในหน้าต่างแล้วไม่ย้าย
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focus = (): void => {
      const el = root.current;
      if (el !== null && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    };
    const panel = useLayout.getState().api?.getPanel(panelId);
    if (panel === undefined) {
      focus();
      return;
    }
    if (panel.api.isActive) focus();
    const sub = panel.api.onDidActiveChange((e) => {
      if (e.isActive) focus();
    });
    return () => sub.dispose();
  }, [panelId]);
  /** ยกเลิกการรอ job ของ Refresh เมื่อหน้าต่างปิด */
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    life.current = ctrl;
    return () => ctrl.abort();
  }, []);

  // สร้างรายงาน: ตอนเปิด, เมื่อ scenario/params เปลี่ยน และเมื่อ Refresh (revision) ไม่ขึ้นกับเวลา animation
  useEffect(() => {
    const { p: cur, prepare: prep, messages: text } = latest.current;
    if (cur === null || sc === null) return;
    const ctrl = new AbortController();
    const object = cur.objects.length === 1 ? cur.objects[0] : null;
    if (firstLoad.current) {
      firstLoad.current = false;
      const report = takePrimed(sc, requestOf(cur));
      if (report !== null) pending.current = { sc, key: JSON.stringify(requestOf(cur)), report, rev: revision };
    }
    // ใช้ได้เฉพาะการโหลดของ revision ที่ฝากไว้ (effect ที่ถูกยกเลิกแล้วรันซ้ำใน revision เดียวกัน = StrictMode ใช้ต่อได้)
    // การโหลดที่ถูกยกเลิกเพราะ Refresh / คำนวณใหม่ (revision ใหม่) ไม่ใช้ และทิ้งไป
    const held = pending.current;
    const given = held !== null && held.sc === sc && held.key === JSON.stringify(requestOf(cur)) && held.rev === revision ? held : null;
    if (given === null) pending.current = null;
    setPhase("loading");
    void (async () => {
      try {
        const report = given?.report ?? (await fetchReport(sc, requestOf(cur), ctrl.signal));
        const extra = await prep(report, sc, ctrl.signal, object);
        if (ctrl.signal.aborted) return;
        if (given !== null && pending.current === given) pending.current = null;
        setLoaded({ report, extra });
        setFailure(null);
        setPhase("ready");
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) return;
        if (given !== null && pending.current === given) pending.current = null; // ล้มเหลว: ไม่ใช้ผลที่ฝากซ้ำ
        setLoaded(null);
        if (e instanceof ApiError && e.code === "RESULTS_NOT_CURRENT") {
          setPhase("notCurrent");
        } else if (e instanceof ApiError && e.code === "STYLE_INVALID") {
          notify("error", e.code, e.text, object);
          setPhase("styleInvalid");
        } else {
          const failed = msg(text.failed, { message: errorText(e) });
          notify("error", e instanceof ApiError ? e.code : `${text.codePrefix}_FAILED`, failed, object);
          setFailure(failed);
          setPhase("failed");
        }
      }
    })();
    return () => ctrl.abort();
  }, [sc, key, revision]);

  /** ผลลัพธ์ไม่ตรง: Compute / propagate แล้วรอ job จบก่อนสร้างรายงานใหม่ (ผู้เรียกแจ้งข้อผิดพลาดเอง) */
  const recompute = useCallback(async (): Promise<void> => {
    const { p: cur, sc: name, messages: text } = latest.current;
    const signal = life.current?.signal;
    if (cur === null || name === null || signal === undefined) return;
    const object = cur.objects.length === 1 ? cur.objects[0] : null;
    const plan = recomputePlan(useScenario.getState().doc, cur.objects);
    const short = (path: string): string => path.slice(FACILITY.length);
    setComputing(true);
    try {
      for (const facility of plan.unreachable) notify("error", `${text.codePrefix}_NO_SATELLITES`, msg("report.noSatellites", { facility: short(facility) }), facility);
      const computes = [...plan.computes];
      if (plan.needsAccess.length > 0) {
        // รายงานของ Facility ที่ยังไม่มี access: การสร้าง access ใหม่แก้ scenario จึงถามก่อน ไม่ตกลง = หยุด (ไม่ propagate ไม่สร้างรายงานซ้ำวน)
        const yes = await confirm(msg("report.needsAccess", { facility: plan.needsAccess.map((c) => short(c.from)).join(", ") }));
        if (signal.aborted) return;
        if (!yes) {
          notify("info", `${text.codePrefix}_NEEDS_ACCESS`, msg("report.needsAccessDeclined"), object);
          return;
        }
        computes.push(...plan.needsAccess);
      }
      if (computes.length === 0 && !plan.propagate) return; // ไม่มีอะไรคำนวณได้: ไม่สร้างรายงานซ้ำ (จะได้ 409 เดิม)
      // คิวการเขียนของ useScenario: ETag ต่อกันทีละคำขอ ดึง doc ใหม่หลังเขียน 412 = กล่อง Reload / Cancel ของทั้งแอป
      const jobs = computes.length === 0 ? [] : (await postAccess(name, "compute", computes)).jobs;
      if (plan.propagate) jobs.push(await startJob(`/scenarios/${encodeURIComponent(name)}/propagate`, "propagate", name));
      const ok = await waitForJobs(jobs, signal);
      if (signal.aborted) return;
      if (ok) setRevision((r) => r + 1);
      else notify("error", `${text.codePrefix}_COMPUTE`, msg(text.computeJobFailed), object);
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 412; // กล่องของ store แจ้งแล้ว
      if (!signal.aborted && !conflict) notify("error", e instanceof ApiError ? e.code : `${text.codePrefix}_COMPUTE`, msg(text.computeFailed, { message: errorText(e) }), object);
    } finally {
      if (!signal.aborted) setComputing(false);
    }
  }, []);

  const bannerStatus = p === null ? null : staleStatus(p.objects, resultsInfo, phase === "notCurrent");

  const refresh = (): void => {
    if (computing) return;
    if (phase === "notCurrent" || bannerStatus !== null) void recompute();
    else setRevision((r) => r + 1);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "F5" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    e.preventDefault(); // ไม่ให้ browser โหลดหน้าเว็บใหม่
    e.stopPropagation();
    refresh();
  };

  return { sc, phase, failure, loaded, computing, bannerStatus, recompute, refresh, root, onKeyDown };
}

const REPORT_MESSAGES: LoaderMessages = { codePrefix: "REPORT", failed: "report.failed", computeFailed: "report.computeFailed", computeJobFailed: "report.computeJobFailed" };

/** Dynamic Display: วิธีประมาณค่าของแต่ละคอลัมน์จาก /dataproviders (อ่านไม่ได้ = คำเตือนแล้วประมาณตามชนิดคอลัมน์) รายงานธรรมดา = null */
const prepareReport = (p: ReportParams | null): PrepareReport<DynamicSection[] | null> => async (report, sc, signal, object) => {
  if (p === null || !p.dynamic) return null;
  let elements: ElementInfo[] = [];
  try {
    elements = await providerElements(sc, p.objects, signal);
  } catch (e) {
    if (isAbortError(e) || signal.aborted) throw e;
    notify("warning", e instanceof ApiError ? e.code : "REPORT_PROVIDERS", msg("report.providersFailed", { message: errorText(e) }), object);
  }
  return prepareDynamic(report, elements);
};

export function Report({ params, panelId }: PanelProps) {
  const p = useMemo(() => parseReportParams(params), [params]);
  const stepS = useScenario((s) => s.doc?.step_s ?? 30);
  const { fmt, ltz } = useTimeFormatter();
  const { sc, phase, failure, loaded, computing, bannerStatus, recompute, refresh, root, onKeyDown } =
    useReportLoader(p, panelId, prepareReport(p), REPORT_MESSAGES);
  const [setupOpen, setSetupOpen] = useState(false);
  const stored = useLayout((s) => s.windowProps[panelId]?.exportSetup);
  const setup = useMemo(() => parseExportSetup(stored), [stored]);

  const exportCsv = async (): Promise<void> => {
    if (p === null || sc === null) return;
    try {
      await downloadReport(sc, requestOf(p), "csv", setup);
    } catch (e) {
      notify("error", e instanceof ApiError ? e.code : "REPORT_EXPORT", msg("report.exportFailed", { message: errorText(e) }), p.objects.length === 1 ? p.objects[0] : null);
    }
  };

  const saveSetup = (value: ExportSetup): void => {
    const props = useLayout.getState().windowProps[panelId] ?? {};
    useLayout.getState().setWindowProps(panelId, { ...props, exportSetup: value });
  };

  const maxGapMs = Math.max(p?.time?.step_s ?? 0, stepS) * 1.5 * 1000;

  let body: ReactNode;
  if (p === null) body = <p className="rpt-note">{msg("report.badParams")}</p>;
  else if (sc === null) body = <p className="rpt-note">{msg("tooltip.noScenario")}</p>;
  else if (loaded !== null && phase !== "notCurrent" && phase !== "styleInvalid" && phase !== "failed") {
    body = loaded.extra === null
      ? <StaticTable panelId={panelId} report={loaded.report} fmt={fmt} ltz={ltz} />
      : <DynamicTable panelId={panelId} report={loaded.report} prepared={loaded.extra} maxGapMs={maxGapMs} fmt={fmt} ltz={ltz} />;
  } else {
    const note = computing ? msg("report.computing")
      : phase === "notCurrent" ? msg("report.notCurrent")
      : phase === "styleInvalid" ? msg("report.styleInvalid")
      : phase === "failed" ? (failure ?? "")
      : msg("report.loading");
    body = <p className="rpt-note">{note}</p>;
  }

  return (
    <div ref={root} className="rpt" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="rpt-toolbar" role="toolbar" aria-label={t("window.report")}>
        <button
          type="button"
          className="btn"
          disabled={p === null || sc === null || computing}
          title={computing ? msg("banner.running") : msg("report.refreshHint")}
          onClick={refresh}
        >
          {t("report.refresh")}
        </button>
        <Menubar.Root className="rpt-menubar">
          <Menubar.Menu value="export">
            <Menubar.Trigger className="menubar-trigger" disabled={p === null || sc === null}>{t("report.export")}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="menu-content" align="start" sideOffset={0} loop>
                <Menubar.Item className="menu-item" disabled={loaded === null} title={msg("report.export")} onSelect={() => void exportCsv()}>
                  <span className="menu-label">{t("report.toExcelOrCsvFormat")}</span>
                </Menubar.Item>
                <Menubar.Item className="menu-item" onSelect={() => setSetupOpen(true)}>
                  <span className="menu-label">{t("report.setup")}</span>
                </Menubar.Item>
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        </Menubar.Root>
        {phase === "loading" && loaded !== null && <span className="rpt-busy">{msg("report.loading")}</span>}
      </div>
      <ResultsBanner status={bannerStatus} onApply={recompute} />
      <div className="rpt-body">{body}</div>
      <ExportSetupDialog open={setupOpen} value={setup} onSave={saveSetup} onClose={() => setSetupOpen(false)} />
    </div>
  );
}

// ---------- ตาราง ----------

const ROW_HEIGHT = 20;
/** ขนาดพื้นที่เห็นที่ใช้เมื่อยังวัดไม่ได้ (jsdom, หน้าต่างเพิ่งสร้าง) = ขนาดตั้งต้นของหน้าต่าง */
const FALLBACK_RECT: Rect = { width: 720, height: 360 };
const observeViewport = observeViewportWithFallback(FALLBACK_RECT);
/** padding ซ้าย + ขวาของแต่ละช่อง (px) ต้องตรงกับ .rpt-table td/th ใน theme.css */
const CELL_PADDING_PX = 16;

interface TableProps {
  panelId: string;
  report: ReportJson;
  fmt: DateFormat;
  ltz: string;
}

function StaticTable({ panelId, report, fmt, ltz }: TableProps) {
  const rows = useMemo(() => flattenRows(report, fmt, ltz), [report, fmt, ltz]);
  const timeAt = useCallback((row: FlatRow, col: number): number | null => {
    const section = report.sections[row.section];
    if (row.kind !== "row" || row.row === undefined || section?.columns[col]?.kind !== "time") return null;
    const v = section.rows[row.row]?.[col];
    const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  }, [report]);
  return <RowsTable panelId={panelId} report={report} rows={rows} timeAt={timeAt} />;
}

function DynamicTable({ panelId, report, prepared, maxGapMs, fmt, ltz }: TableProps & { prepared: DynamicSection[]; maxGapMs: number }) {
  const now = useThrottledTime();
  const rows = useMemo(() => dynamicRows(report, prepared, now.getTime(), maxGapMs, fmt, ltz), [report, prepared, now, maxGapMs, fmt, ltz]);
  const timeAt = useCallback((row: FlatRow, col: number): number | null => (
    row.at !== undefined && report.sections[row.section]?.columns[col]?.kind === "time" ? row.at : null
  ), [report]);
  return <RowsTable panelId={panelId} report={report} rows={rows} timeAt={timeAt} />;
}

function RowsTable({ panelId, report, rows, timeAt }: { panelId: string; report: ReportJson; rows: FlatRow[]; timeAt(row: FlatRow, col: number): number | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => registerShownRows(panelId, () => rowsRef.current), [panelId]);

  const width = Math.max(2, ...report.sections.map((s) => s.columns.length));
  // ความกว้างจากข้อความที่ยาวที่สุดของแต่ละคอลัมน์ (เวลา LTZG ชื่อสถิติ หัวคอลัมน์) ตารางกว้างเท่าผลรวม เลื่อนแนวนอนได้เมื่อเกินหน้าต่าง
  const widths = useMemo(() => columnWidths(rows, width), [rows, width]);
  const totalCh = widths.reduce((a, b) => a + b, 0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeViewport,
  });
  const items = virtualizer.getVirtualItems();
  const top = items[0]?.start ?? 0;
  const bottom = Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0));

  // เมนูคลิกขวา: เป้าหมายจดตอนคลิก (Radix เปิดเมนูในเหตุการณ์เดียวกัน ก่อน state ทัน render)
  const [menuTime, setMenuTime] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const target = useRef<number | null>(null);
  const onContextMenuCapture = (e: ReactMouseEvent): void => {
    const cell = (e.target as Element | null)?.closest?.("[data-time]");
    const ms = cell === null || cell === undefined ? Number.NaN : Number(cell.getAttribute("data-time"));
    target.current = Number.isFinite(ms) ? ms : null;
    setMenuTime(target.current);
    if (target.current === null) e.preventDefault(); // ช่องที่ไม่ใช่เวลา: ไม่มีเมนู
  };

  return (
    <ContextMenu.Root
      open={menuOpen}
      onOpenChange={(next) => {
        if (next && target.current === null) return;
        setMenuOpen(next);
        if (!next) target.current = null;
      }}
    >
      <ContextMenu.Trigger asChild>
        <div ref={scrollRef} className="rpt-scroll" tabIndex={0} onContextMenuCapture={onContextMenuCapture}>
          <table className="rpt-table" style={{ width: `calc(${totalCh}ch + ${widths.length * CELL_PADDING_PX}px)` }}>
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: `calc(${w}ch + ${CELL_PADDING_PX}px)` }} />
              ))}
            </colgroup>
            <tbody>
              {top > 0 && (
                <tr className="rpt-spacer" aria-hidden="true">
                  <td colSpan={width} style={{ height: top }} />
                </tr>
              )}
              {items.map((item) => {
                const row = rows[item.index];
                return row === undefined ? null : <ReportRow key={item.key} row={row} width={width} timeAt={timeAt} />;
              })}
              {bottom > 0 && (
                <tr className="rpt-spacer" aria-hidden="true">
                  <td colSpan={width} style={{ height: bottom }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu-content">
          {menuTime !== null && (
            <ContextMenu.Item className="menu-item" onSelect={() => useTime.getState().setCurrent(new Date(menuTime))}>
              <span className="menu-label">{t("report.setAnimationTime")}</span>
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ReportRow({ row, width, timeAt }: { row: FlatRow; width: number; timeAt(row: FlatRow, col: number): number | null }) {
  const style = { height: ROW_HEIGHT };
  switch (row.kind) {
    case "title":
      return (
        <tr className={row.section < 0 ? "rpt-title rpt-global-title" : "rpt-title"} style={style}>
          <th colSpan={width} scope="colgroup" title={row.cells[0]}>{row.cells[0]}</th>
        </tr>
      );
    case "header":
      return (
        <tr className="rpt-head" style={style}>
          {row.cells.map((c, i) => <th key={i} scope="col" title={c}>{c}</th>)}
        </tr>
      );
    case "nodata":
      return (
        <tr className="rpt-nodata" style={style}>
          <td colSpan={width} title={row.cells[0]}>{row.cells[0]}</td>
        </tr>
      );
    case "summary":
    case "global":
      return (
        <tr className="rpt-stat" style={style}>
          <td colSpan={width - 1} title={row.cells[0]}>{row.cells[0]}</td>
          <td className="rpt-num" title={row.cells[1]}>{row.cells[1]}</td>
        </tr>
      );
    default:
      return (
        <tr className="rpt-row" style={style}>
          {row.cells.map((c, i) => {
            const ms = timeAt(row, i);
            return ms === null
              ? <td key={i} className="rpt-num" title={c}>{c}</td>
              : <td key={i} className="rpt-time" data-time={ms} title={c}>{c}</td>;
          })}
        </tr>
      );
  }
}

/** ลงทะเบียนหน้าต่างรายงานเป็นชนิด report (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด กุญแจ และ persist/scenarioBound คงตามที่ลงไว้ใน layout/panels.ts ลงซ้ำได้ */
export function registerReportPanel(): void {
  const base = getPanelDef("report");
  if (base === undefined) throw new Error('panel kind "report" is not registered');
  registerPanel("report", { ...base, component: Report });
}
