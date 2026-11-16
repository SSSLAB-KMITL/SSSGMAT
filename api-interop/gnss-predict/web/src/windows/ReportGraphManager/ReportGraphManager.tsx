// Report & Graph Manager (spec §5, STK ref §F, help.agi.com): หน้าต่างลอยบานเดียว params {objectType?, objects?} (commands.ts)
//
// - Object Type: All Types / Access / Facility / Satellite / Constellation (Constellation ไม่มี style ของตัวเอง: ต้นไม้ว่าง)
//   Objects: รายชื่อตามชนิด เลือกหลายตัวด้วย Ctrl/Shift; Access = คู่ P1 จาก doc.accesses (Constellation ขยายเป็นดาว) แสดงเป็น THBK-To-G01
// - Styles: ต้นไม้ Installed Styles (ล็อก) / My Styles / Scenario Styles จาก GET /styles?scenario= (fetchStyleList) กรองตามชนิดและ Show Reports / Show Graphs
//   style ที่ไฟล์มีโครงไม่ครบ (My Styles ที่แก้มือ) อยู่ในต้นไม้เป็นรายการที่ใช้ไม่ได้พร้อมเหตุผลภาษาไทย ลบได้ (เฉพาะ All Types)
//   อ่านใหม่เมื่อ scenario / doc เปลี่ยน (Scenario Styles) และเมื่อ My Styles เปลี่ยน (useStyleRevision)
// - Generate As: Report/Graph หรือ Dynamic Display/Strip Chart (style ที่ canDynamic ไม่ได้เป็นสีเทา)
// - Generate...: กล่อง Time Properties (ค่าตั้งต้นจาก style.time) แล้ว POST /reports แบบ JSON ก่อนเปิดหน้าต่าง (ฝากผลให้หน้าต่างด้วย primeReport)
//   ส่ง time เสมอ: {mode: "object" | "specify", start?, stop?, step_s}
//   409 RESULTS_NOT_CURRENT = ถาม Yes / No ว่าจะ Compute ก่อนไหม (recomputePlan เดียวกับหน้าต่างรายงาน) Yes = รอ job เสร็จแล้วสร้างใหม่
//   422 time.* = ช่องนั้นกรอบแดงพร้อมข้อความของ server, 422 objects (Time Period ของ access ไม่เท่ากัน) = ข้อความไทยในกล่อง,
//   422 STYLE_INVALID = Message Viewer
// - คลิกขวาที่ style: Generate as .txt file... / .csv file... (downloadReport ด้วยเวลาของ style), Properties, Copy to My Styles, Delete
//   (Installed ล็อก; My Styles = DELETE /styles/{name}; Scenario Styles = putDoc ตัดออกจาก doc.styles) ทั้งหมดผ่านคำถามยืนยันก่อนลบ
// - New... / Properties... เปิดหน้าต่างแก้ style (StyleEditor.tsx) Close ปิดหน้าต่างนี้

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { postAccess } from "../../api/access";
import { ApiError, errorText, isAbortError } from "../../api/client";
import { startJob } from "../../api/startJob";
import { confirm } from "../../chrome/Dialogs";
import { useTimeFormatter } from "../../chrome/hooks";
import {
  accessName, accessPath, deleteMyStyle, downloadReport, fetchReport, fetchStyleList, saveMyStyle, type ReportRequest, type StyleDef, type StyleTiers,
  type UnusableStyle,
} from "../../data/reports";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { report as notify } from "../../stores/messages";
import { useScenario, type ScenarioDoc } from "../../stores/scenario";
import { parseIsoUtc, parseTime } from "../../time/parse";
import { constellations } from "../AccessTool/state";
import { openReport, primeReport, recomputePlan, waitForJobs } from "../Report/Report";
import { RGM_KIND, RGM_OBJECT_TYPES, STYLE_EDITOR_KIND, useStyleRevision, type RgmObjectType } from "./commands";
import { canDynamic, copyName } from "./styleForm";

type Tier = keyof StyleTiers;
type ReportTime = NonNullable<ReportRequest["time"]>;

const TIERS: readonly Tier[] = ["installed", "my", "scenario"];
const TIER_LABELS: Record<Tier, LabelKey> = { installed: "rgm.installedStyles", my: "rgm.myStyles", scenario: "rgm.scenarioStyles" };
const TYPE_LABELS: Record<RgmObjectType, LabelKey> = {
  All: "rgm.allTypes", Access: "rgm.typeAccess", Facility: "ob.class.facility", Satellite: "ob.class.satellite", Constellation: "rgm.constellation",
};

/** style ในต้นไม้: usable = style ที่ใช้ได้, ไม่งั้นเป็นรายการที่โครงไม่ครบ */
type Entry = { tier: Tier; style: StyleDef; unusable?: undefined } | { tier: Tier; style?: undefined; unusable: UnusableStyle; index: number };
const entryName = (e: Entry): string => e.style?.name ?? e.unusable?.name ?? "";
/** กุญแจของรายการ: style = (ชั้น, ชื่อ, ชนิด); รายการที่ใช้ไม่ได้ = ลำดับใน unusable (ชื่ออาจว่างหรือซ้ำ) */
const entryKey = (e: Entry): string => (e.style === undefined ? JSON.stringify(["unusable", e.tier, e.index]) : JSON.stringify([e.tier, e.style.name, e.style.kind]));
const WHERE: Record<Tier, "rgm.whereMy" | "rgm.whereScenario" | "rgm.whereInstalled"> = { installed: "rgm.whereInstalled", my: "rgm.whereMy", scenario: "rgm.whereScenario" };
/** เหตุผลภาษาไทยของรายการที่ใช้ไม่ได้: Installed (ล็อก) = แก้ไฟล์เท่านั้น; ไม่มีชื่อ = ลบจากที่นี่ไม่ได้; ที่เหลือ = แก้หรือ Delete */
const unusableText = (tier: Tier, u: UnusableStyle): string =>
  msg(tier === "installed" ? "rgm.unusableLocked" : u.name === null ? "rgm.unusableUnnamed" : "rgm.unusable", { field: u.field, where: msg(WHERE[tier]) });

/** ปุ่มเปิดเมนูคลิกขวาจากคีย์บอร์ด: ปุ่ม Context Menu หรือ Shift+F10 */
export const isMenuKey = (e: ReactKeyboardEvent): boolean => e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/** เปิดเมนูคลิกขวาของ element จากคีย์บอร์ด (Radix ContextMenu เปิดจาก event contextmenu ที่มุมล่างซ้ายของ element) */
/** ตำแหน่งใหม่ของรายการตามปุ่มลูกศร / Home / End (ไม่ใช่ปุ่มเหล่านี้ = null) */
export function moveIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return Math.min(count - 1, index + 1);
  if (key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function openContextMenuAt(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.bottom }));
}

/** เวลา UTC แบบที่ server รับ (UtcZ): ไม่มีเศษวินาที = ไม่เขียน .000 */
const utcZ = (d: Date): string => d.toISOString().replace(".000Z", "Z");
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** ชนิดของ object: คู่ path (P1) = Access */
export function objectTypeOf(path: string): RgmObjectType | null {
  if (path.includes(" ")) return "Access";
  const cls = /^\*\/(Facility|Satellite|Constellation)\//.exec(path)?.[1];
  return (cls as RgmObjectType | undefined) ?? null;
}

/** ชื่อที่แสดง: Access = THBK-To-G01 ที่เหลือ = ชื่อ object */
export const objectLabel = (path: string): string => (path.includes(" ") ? accessName(path) : nameOf(path));

/** คู่ Facility–ดาวของทุก access ใน doc (Constellation ขยายเป็นดาวสมาชิก ไม่ซ้ำ ตามลำดับ access แล้วลำดับใน to) */
export function accessObjects(doc: ScenarioDoc | null): string[] {
  if (doc === null) return [];
  const members = new Map(constellations(doc));
  const facilities = new Set(doc.objects.filter((o) => o.class === "Facility").map((o) => `*/Facility/${o.name}`));
  const satellites = new Set(doc.objects.filter((o) => o.class === "Satellite").map((o) => `*/Satellite/${o.name}`));
  const out = new Set<string>();
  for (const a of doc.accesses ?? []) {
    const to = Array.isArray(a.to) ? a.to : [];
    const expand = (p: string): string[] => members.get(p) ?? [p];
    if (facilities.has(a.from)) {
      for (const sat of to.flatMap(expand)) if (satellites.has(sat)) out.add(accessPath(nameOf(a.from), nameOf(sat)));
    } else if (satellites.has(a.from)) {
      for (const fac of to) if (facilities.has(fac)) out.add(accessPath(nameOf(fac), nameOf(a.from)));
    }
  }
  return [...out];
}

/** object ของชนิดนั้น (All = ทุกชนิด: Facility, Satellite, Constellation แล้ว Access) */
export function objectsOf(doc: ScenarioDoc | null, type: RgmObjectType): string[] {
  const byClass = (cls: string): string[] => (doc?.objects ?? []).filter((o) => o.class === cls).map((o) => `*/${cls}/${o.name}`);
  if (type === "Access") return accessObjects(doc);
  if (type !== "All") return byClass(type);
  return [...byClass("Facility"), ...byClass("Satellite"), ...byClass("Constellation"), ...accessObjects(doc)];
}

/** เวลาของ style เป็น time ของคำขอ (style specify ที่ไม่มี start/stop = Use Object Time Period) */
export function timeOfStyle(style: StyleDef): ReportTime {
  const { mode, start, stop, step_s } = style.time;
  return mode === "specify" && start !== undefined && stop !== undefined ? { mode: "specify", start, stop, step_s } : { mode: "object", step_s };
}


/** สิ่งที่จะสร้าง: style, object, Dynamic Display */
interface Job {
  style: StyleDef;
  objects: string[];
  dynamic: boolean;
}

/** ข้อผิดพลาดที่แสดงในกล่อง Time Properties (field = ช่องที่ server ชี้ เช่น time.step) */
interface DialogError {
  field: string | null;
  text: string;
}

export function ReportGraphManager({ params, panelId }: PanelProps) {
  const sc = useScenario((s) => s.name);
  const doc = useScenario((s) => s.doc);
  const revision = useStyleRevision((s) => s.revision);
  const ids = useId();

  const [objectType, setObjectType] = useState<RgmObjectType>("All");
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [styleKey, setStyleKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [showReports, setShowReports] = useState(true);
  const [showGraphs, setShowGraphs] = useState(true);
  const [dynamic, setDynamic] = useState(false);
  const [list, setList] = useState<{ tiers: StyleTiers; unusable: UnusableStyle[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Job | null>(null);
  const [dialogError, setDialogError] = useState<DialogError | null>(null);
  const [busy, setBusy] = useState(false);
  // คีย์บอร์ด (roving tabindex): แต่ละรายการเป็นจุดหยุด Tab เดียว รายการที่โฟกัสอยู่ (หรือตัวแรก) รับ Tab
  const [focusObject, setFocusObject] = useState<string | null>(null);
  const objectRefs = useRef(new Map<string, HTMLElement>());
  const styleRefs = useRef(new Map<string, HTMLElement>());

  // params ใหม่ (เปิดซ้ำจากเมนูของ object หรือจาก Access tool) = Object Type และ object ที่เลือกตามนั้น
  const paramsKey = JSON.stringify([params?.objectType ?? null, params?.objects ?? null]);
  useEffect(() => {
    const type = RGM_OBJECT_TYPES.find((x) => x === params?.objectType);
    if (type !== undefined) setObjectType(type);
    if (Array.isArray(params?.objects)) setSelected(params.objects.filter((o: unknown): o is string => typeof o === "string"));
  }, [paramsKey]);

  /** ยกเลิกการรอ job เมื่อหน้าต่างปิด */
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    life.current = ctrl;
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (sc === null) return;
    const ctrl = new AbortController();
    fetchStyleList(null, sc, { signal: ctrl.signal })
      .then((r) => {
        setList(r);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!isAbortError(e) && !ctrl.signal.aborted) setLoadError(msg("rgm.loadFailed", { message: errorText(e) }));
      });
    return () => ctrl.abort();
  }, [sc, doc, revision]);

  const objects = useMemo(() => objectsOf(doc, objectType), [doc, objectType]);
  const shown = useMemo(() => new Set(objects), [objects]);
  // object ที่เลือกเฉพาะตัวที่อยู่ในรายการตอนนี้ ตามลำดับในรายการ
  const chosen = useMemo(() => {
    const set = new Set(selected);
    return objects.filter((o) => set.has(o));
  }, [objects, selected]);

  const entries = useMemo<Entry[]>(() => {
    if (list === null) return [];
    const out: Entry[] = [];
    for (const tier of TIERS) {
      for (const style of list.tiers[tier]) {
        if (objectType !== "All" && style.object_type !== objectType) continue;
        if (style.kind === "report" ? !showReports : !showGraphs) continue;
        out.push({ tier, style });
      }
      if (objectType === "All" && (showReports || showGraphs)) {
        for (const [index, u] of list.unusable.entries()) if (u.tier === tier) out.push({ tier, unusable: u, index });
      }
    }
    return out;
  }, [list, objectType, showReports, showGraphs]);

  const current = entries.find((e) => entryKey(e) === styleKey) ?? null;
  const menuEntry = entries.find((e) => entryKey(e) === menuKey) ?? null;

  /** เหตุที่ style นี้ใช้สร้างไม่ได้ตอนนี้ (null = ได้) */
  const styleProblem = (e: Entry): string | null => {
    if (e.style === undefined) return unusableText(e.tier, e.unusable);
    if (dynamic && !canDynamic(e.style)) return msg("rgm.notDynamic");
    return null;
  };
  /** เหตุที่สร้างจาก style นี้กับ object ที่เลือกไม่ได้ (null = ได้) */
  const generateProblem = (e: Entry | null, asDynamic: boolean): string | null => {
    if (e === null || e.style === undefined) return e === null ? null : unusableText(e.tier, e.unusable);
    if (asDynamic && !canDynamic(e.style)) return msg("rgm.notDynamic");
    if (chosen.length === 0) return msg("rgm.selectObjects");
    if (chosen.some((o) => objectTypeOf(o) !== e.style.object_type)) return msg("rgm.objectsMismatch", { type: e.style.object_type });
    return null;
  };
  const canGenerate = (e: Entry | null, asDynamic: boolean): boolean => e !== null && e.style !== undefined && sc !== null && !busy && generateProblem(e, asDynamic) === null;

  // ---------- object ----------

  const clickObject = (path: string, e: ReactMouseEvent): void => {
    if (e.shiftKey && anchor.current !== null && shown.has(anchor.current)) {
      const a = objects.indexOf(anchor.current);
      const b = objects.indexOf(path);
      setSelected(objects.slice(Math.min(a, b), Math.max(a, b) + 1));
      return;
    }
    anchor.current = path;
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.includes(path) ? s.filter((p) => p !== path) : [...s, path]));
    else setSelected([path]);
  };

  /** ลูกศร / Home / End ย้ายโฟกัส (Shift = ขยายช่วงที่เลือก) Space / Enter = เลือกหรือเอาออก (แบบ Ctrl+คลิก) Ctrl+A = ทั้งหมด */
  const onObjectKeyDown = (e: ReactKeyboardEvent, index: number): void => {
    const path = objects[index];
    const to = moveIndex(e.key, index, objects.length);
    if (to !== null) {
      e.preventDefault();
      const next = objects[to];
      setFocusObject(next);
      objectRefs.current.get(next)?.focus();
      if (e.shiftKey && anchor.current !== null && shown.has(anchor.current)) {
        const a = objects.indexOf(anchor.current);
        setSelected(objects.slice(Math.min(a, to), Math.max(a, to) + 1));
      }
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      anchor.current = path;
      setSelected((sel) => (sel.includes(path) ? sel.filter((p) => p !== path) : [...sel, path]));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected([...objects]);
    }
  };

  // ---------- Compute ก่อน (409) ----------

  /** ถามว่าจะ Compute ก่อนไหม Yes = สั่งแล้วรอ job ทั้งหมดสำเร็จ (true) ไม่งั้น false (ข้อผิดพลาดลง Message Viewer) */
  const computeFirst = async (objs: readonly string[]): Promise<boolean> => {
    const signal = life.current?.signal;
    if (sc === null || signal === undefined) return false;
    const plan = recomputePlan(useScenario.getState().doc, objs);
    for (const facility of plan.unreachable) notify("error", "RGM_NO_SATELLITES", msg("report.noSatellites", { facility: nameOf(facility) }), facility);
    const computes = [...plan.computes, ...plan.needsAccess];
    if (computes.length === 0 && !plan.propagate) {
      notify("error", "RGM_NOTHING_TO_COMPUTE", msg("rgm.nothingToCompute"), objs.length === 1 ? objs[0] : null);
      return false;
    }
    const facilities = [...new Set(computes.map((c) => nameOf(c.from)))];
    const text = facilities.length > 0 ? msg("rgm.computeFirst", { facility: facilities.join(", ") }) : msg("rgm.propagateFirst");
    if (!(await confirm(text, { okLabel: t("dialog.yes"), cancelLabel: t("dialog.no") }))) return false;
    try {
      const jobs = computes.length === 0 ? [] : (await postAccess(sc, "compute", computes)).jobs;
      if (plan.propagate) jobs.push(await startJob(`/scenarios/${encodeURIComponent(sc)}/propagate`, "propagate", sc));
      const ok = await waitForJobs(jobs, signal);
      if (!ok && !signal.aborted) notify("error", "RGM_COMPUTE", msg("rgm.computeJobFailed"));
      return ok;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 412) && !signal.aborted) {
        notify("error", e instanceof ApiError ? e.code : "RGM_COMPUTE", msg("rgm.computeFailed", { message: errorText(e) }));
      }
      return false;
    }
  };

  // ---------- Generate ----------

  const requestOf = (job: Job, time: ReportTime): ReportRequest => ({ style: job.style.name, kind: job.style.kind, objects: job.objects, time, dynamic: job.dynamic });

  /** POST /reports แบบ JSON แล้วเปิดหน้าต่าง; 409 = ถามว่าจะ Compute ก่อน (สร้างใหม่ครั้งเดียวเมื่อเสร็จ) ข้อผิดพลาดอื่นแสดงในกล่องเวลา */
  const generate = async (job: Job, time: ReportTime, retried = false): Promise<void> => {
    if (sc === null) return;
    const req = requestOf(job, time);
    setBusy(true);
    setDialogError(null);
    try {
      const signal = life.current?.signal;
      const etag = useScenario.getState().etag;
      const report = await fetchReport(sc, req, signal);
      // หน้าต่างปิด หรือสลับ scenario ระหว่างรอ: ไม่ฝากผลและไม่เปิดหน้าต่าง
      if (signal?.aborted === true || useScenario.getState().name !== sc) return;
      // scenario ถูกแก้ระหว่างรอ: ผลนี้อาจไม่ตรงแล้ว ไม่ฝาก หน้าต่างสร้างรายงานเอง (หรือแสดงแถบผลลัพธ์ไม่ตรง)
      if (useScenario.getState().etag === etag) primeReport(sc, req, report);
      openReport({ style: req.style, kind: job.style.kind, objects: job.objects, time, dynamic: job.dynamic });
      setDialog(null);
    } catch (e) {
      if (isAbortError(e) || life.current?.signal.aborted === true) return;
      if (e instanceof ApiError && e.code === "RESULTS_NOT_CURRENT" && !retried) {
        setDialog(null);
        if (await computeFirst(job.objects)) await generate(job, time, true);
        return;
      }
      // หลัง Compute กล่องเวลาปิดไปแล้ว: ข้อผิดพลาดทุกแบบไปที่ Message Viewer
      if (!retried && e instanceof ApiError && e.status === 422 && e.field?.startsWith("time.")) setDialogError({ field: e.field, text: e.text });
      else if (!retried && e instanceof ApiError && e.status === 422 && e.field === "objects") setDialogError({ field: "objects", text: msg("rgm.periodsDiffer") });
      else {
        const text = e instanceof ApiError && e.code === "STYLE_INVALID" ? e.text : msg("rgm.generateFailed", { message: errorText(e) });
        notify("error", e instanceof ApiError ? e.code : "RGM_GENERATE", text, job.objects.length === 1 ? job.objects[0] : null);
        setDialogError({ field: null, text });
      }
    } finally {
      setBusy(false);
    }
  };

  /** Generate as .txt / .csv file...: เวลาของ style ไม่ถามกล่องเวลา 409 = ถาม Compute ก่อนแบบเดียวกัน */
  const generateFile = async (job: Job, format: "txt" | "csv", retried = false): Promise<void> => {
    if (sc === null) return;
    setBusy(true);
    try {
      await downloadReport(sc, requestOf(job, timeOfStyle(job.style)), format);
    } catch (e) {
      if (e instanceof ApiError && e.code === "RESULTS_NOT_CURRENT" && !retried) {
        if (await computeFirst(job.objects)) await generateFile(job, format, true);
        return;
      }
      const text = e instanceof ApiError && (e.code === "STYLE_INVALID" || e.status === 422) ? e.text : msg("rgm.generateFailed", { message: errorText(e) });
      notify("error", e instanceof ApiError ? e.code : "RGM_GENERATE", text, job.objects.length === 1 ? job.objects[0] : null);
    } finally {
      setBusy(false);
    }
  };

  const openDialog = (e: Entry | null): void => {
    if (e === null || e.style === undefined || !canGenerate(e, dynamic)) return;
    setDialogError(null);
    setDialog({ style: e.style, objects: chosen, dynamic });
  };

  // ---------- style ----------

  const allNames = (): string[] => (list === null ? [] : [...TIERS.flatMap((tier) => list.tiers[tier].map((s) => s.name)), ...list.unusable.flatMap((u) => (u.name === null ? [] : [u.name]))]);

  const copyToMyStyles = async (style: StyleDef): Promise<void> => {
    const name = copyName(style.name, allNames());
    try {
      await saveMyStyle({ ...style, name });
      notify("info", "STYLE_COPIED", msg("rgm.copied", { name }));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 412)) notify("error", e instanceof ApiError ? e.code : "STYLE_SAVE", msg("rgm.saveFailed", { message: errorText(e) }));
    } finally {
      useStyleRevision.getState().bump();
    }
  };

  const remove = async (e: Entry): Promise<void> => {
    const name = entryName(e);
    if (e.tier === "installed" || name === "") return;
    if (!(await confirm(msg("rgm.deleteConfirm", { name, tier: t(TIER_LABELS[e.tier]) })))) return;
    try {
      if (e.tier === "my") {
        await deleteMyStyle(name);
        useStyleRevision.getState().bump();
      } else {
        const kind = e.style?.kind;
        await useScenario.getState().putDoc((d) => {
          const styles: unknown[] = Array.isArray(d.styles) ? d.styles : [];
          d.styles = styles.filter((s) => {
            const r = s as { name?: unknown; kind?: unknown } | null;
            return !(typeof r?.name === "string" && r.name.toLowerCase() === name.toLowerCase() && (kind === undefined || r.kind === kind));
          });
        });
      }
      if (styleKey === entryKey(e)) setStyleKey(null);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 412)) notify("error", err instanceof ApiError ? err.code : "STYLE_DELETE", msg("rgm.deleteFailed", { message: errorText(err) }));
    }
  };

  const openEditor = (e: Entry): void => {
    if (e.style === undefined) return;
    useLayout.getState().openPanel(STYLE_EDITOR_KIND, { style: e.style, tier: e.tier });
  };

  const openNew = (): void => {
    const type = objectType === "Access" || objectType === "Facility" || objectType === "Satellite" ? objectType : "Access";
    useLayout.getState().openPanel(STYLE_EDITOR_KIND, { kind: showReports || !showGraphs ? "report" : "graph", objectType: type });
  };

  // ---------- วาด ----------

  const kindText = (s: StyleDef): string => t(s.kind === "report" ? "rgm.kindReport" : "rgm.kindGraph");
  const objectTab = focusObject !== null && shown.has(focusObject) ? focusObject : (objects[0] ?? null);
  const styleTab = entries.some((e) => entryKey(e) === styleKey) ? styleKey : (entries[0] === undefined ? null : entryKey(entries[0]));

  /** ต้นไม้ style: ลูกศร / Home / End เลือกและย้ายโฟกัส, Enter = Generate..., Space = เลือก, ปุ่ม Context Menu / Shift+F10 = เมนูคลิกขวา */
  const onStyleKeyDown = (e: ReactKeyboardEvent<HTMLElement>, entry: Entry): void => {
    const index = entries.indexOf(entry);
    const to = moveIndex(e.key, index, entries.length);
    if (to !== null) {
      e.preventDefault();
      const key = entryKey(entries[to]);
      setStyleKey(key);
      styleRefs.current.get(key)?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      setStyleKey(entryKey(entry));
      openDialog(entry);
    } else if (e.key === " ") {
      e.preventDefault();
      setStyleKey(entryKey(entry));
    } else if (isMenuKey(e)) {
      e.preventDefault();
      openContextMenuAt(e.currentTarget);
    }
  };
  const generateHint = generateProblem(current, dynamic) ?? undefined;
  const emptyObjects = objectType === "Access" ? msg("rgm.noAccessObjects") : msg("rgm.noObjects");

  return (
    <div className="rgm">
      <div className="rgm-top">
        <label htmlFor={`${ids}-type`}>{t("rgm.objectType")}</label>
        <select id={`${ids}-type`} className="field" value={objectType} onChange={(e) => setObjectType(e.target.value as RgmObjectType)}>
          {RGM_OBJECT_TYPES.map((type) => (
            <option key={type} value={type}>{t(TYPE_LABELS[type])}</option>
          ))}
        </select>
      </div>

      <div className="rgm-main">
        <fieldset className="props-group rgm-objects">
          <legend id={`${ids}-objects`}>{t("rgm.objects")}</legend>
          <div className="rgm-list" role="listbox" aria-multiselectable="true" aria-labelledby={`${ids}-objects`}>
            {objects.map((path) => (
              <div
                key={path}
                ref={(el) => {
                  if (el === null) objectRefs.current.delete(path);
                  else objectRefs.current.set(path, el);
                }}
                role="option"
                tabIndex={objectTab === path ? 0 : -1}
                aria-selected={chosen.includes(path)}
                className={chosen.includes(path) ? "rgm-item rgm-selected" : "rgm-item"}
                onClick={(e) => {
                  setFocusObject(path);
                  clickObject(path, e);
                }}
                onKeyDown={(e) => onObjectKeyDown(e, objects.indexOf(path))}
              >
                {objectLabel(path)}
              </div>
            ))}
          </div>
          {objects.length === 0 && <p className="props-note">{emptyObjects}</p>}
        </fieldset>

        <fieldset className="props-group rgm-styles">
          <legend id={`${ids}-styles`}>{t("rgm.styles")}</legend>
          <ContextMenu.Root onOpenChange={(open) => !open && setMenuKey(null)}>
            <ContextMenu.Trigger asChild>
              <div className="rgm-list" role="tree" aria-labelledby={`${ids}-styles`}>
                {TIERS.map((tier) => {
                  const mine = entries.filter((e) => e.tier === tier);
                  return (
                    <div key={tier} role="group" aria-label={t(TIER_LABELS[tier])}>
                      <div className="rgm-tier" aria-hidden="true">{t(TIER_LABELS[tier])}</div>
                      {mine.map((e) => {
                        const key = entryKey(e);
                        const problem = styleProblem(e);
                        const name = entryName(e) || "?";
                        return (
                          <div
                            key={key}
                            ref={(el) => {
                              if (el === null) styleRefs.current.delete(key);
                              else styleRefs.current.set(key, el);
                            }}
                            role="treeitem"
                            tabIndex={styleTab === key ? 0 : -1}
                            aria-selected={styleKey === key}
                            aria-disabled={problem !== null ? true : undefined}
                            title={problem ?? undefined}
                            data-name={entryName(e)}
                            data-kind={e.style?.kind ?? ""}
                            className={["rgm-item", "rgm-style", styleKey === key ? "rgm-selected" : "", problem !== null ? "rgm-disabled" : ""].join(" ").trim()}
                            onClick={() => setStyleKey(key)}
                            onDoubleClick={() => openDialog(e)}
                            onKeyDown={(ev) => onStyleKeyDown(ev, e)}
                            onContextMenu={() => {
                              setStyleKey(key);
                              setMenuKey(key);
                            }}
                          >
                            <span>{name}{e.style?.ours === true ? t("ob.oursMark") : ""}</span>
                            <span className="rgm-kind">{e.style === undefined ? "" : kindText(e.style)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              {menuEntry !== null && (
                <ContextMenu.Content className="menu-content">
                  <ContextMenu.Item className="menu-item" disabled={!canGenerate(menuEntry, false)} onSelect={() => menuEntry.style && void generateFile({ style: menuEntry.style, objects: chosen, dynamic: false }, "txt")}>
                    {t("rgm.generateTxt")}
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" disabled={!canGenerate(menuEntry, false)} onSelect={() => menuEntry.style && void generateFile({ style: menuEntry.style, objects: chosen, dynamic: false }, "csv")}>
                    {t("rgm.generateCsv")}
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" disabled={menuEntry.style === undefined} onSelect={() => openEditor(menuEntry)}>
                    {t("rgm.propertiesItem")}
                  </ContextMenu.Item>
                  <ContextMenu.Item className="menu-item" disabled={menuEntry.style === undefined || list === null} onSelect={() => menuEntry.style && void copyToMyStyles(menuEntry.style)}>
                    {t("rgm.copyToMyStyles")}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="menu-item"
                    disabled={menuEntry.tier === "installed" || entryName(menuEntry) === ""}
                    title={menuEntry.tier === "installed" ? msg("rgm.lockedDelete") : undefined}
                    onSelect={() => void remove(menuEntry)}
                  >
                    {t("rgm.delete")}
                  </ContextMenu.Item>
                </ContextMenu.Content>
              )}
            </ContextMenu.Portal>
          </ContextMenu.Root>
          {list !== null && entries.length === 0 && <p className="props-note">{msg("rgm.noStyles")}</p>}
          {loadError !== null && <p className="form-error">{loadError}</p>}
          <div className="rgm-filters">
            <label className="access-choice">
              <input type="checkbox" checked={showReports} onChange={(e) => setShowReports(e.target.checked)} />
              {t("rgm.showReports")}
            </label>
            <label className="access-choice">
              <input type="checkbox" checked={showGraphs} onChange={(e) => setShowGraphs(e.target.checked)} />
              {t("rgm.showGraphs")}
            </label>
          </div>
        </fieldset>
      </div>

      <div className="rgm-bottom">
        <fieldset className="props-group rgm-as">
          <legend>{t("rgm.generateAs")}</legend>
          <label className="access-choice">
            <input type="radio" name={`${ids}-as`} checked={!dynamic} onChange={() => setDynamic(false)} />
            {t("rgm.reportGraph")}
          </label>
          <label className="access-choice">
            <input type="radio" name={`${ids}-as`} checked={dynamic} onChange={() => setDynamic(true)} />
            {t("rgm.dynamicDisplay")}
          </label>
        </fieldset>
        <div className="rgm-buttons">
          <button type="button" className="btn" disabled={!canGenerate(current, dynamic)} title={generateHint} onClick={() => openDialog(current)}>
            {t("rgm.generate")}
          </button>
          <button type="button" className="btn" disabled={sc === null} onClick={openNew}>
            {t("rgm.new")}
          </button>
          <button type="button" className="btn" disabled={current?.style === undefined} onClick={() => current !== null && openEditor(current)}>
            {t("rgm.properties")}
          </button>
          <button type="button" className="btn" onClick={() => useLayout.getState().closePanel(panelId)}>
            {t("rgm.close")}
          </button>
        </div>
      </div>

      {dialog !== null && (
        <TimeDialog
          job={dialog}
          busy={busy}
          error={dialogError}
          onEdit={(field) => setDialogError((err) => (err !== null && (err.field === field || err.field === null) ? null : err))}
          onCancel={() => setDialog(null)}
          onOk={(time) => void generate(dialog, time)}
        />
      )}
    </div>
  );
}

// ---------- กล่อง Time Properties ----------

interface TimeDialogProps {
  job: Job;
  busy: boolean;
  error: DialogError | null;
  /** ผู้ใช้แก้ช่องนี้ (ล้างข้อผิดพลาดของ server ที่ชี้ช่องนี้) */
  onEdit(field: string): void;
  onCancel(): void;
  onOk(time: ReportTime): void;
}

function isoText(iso: string | undefined, format: (d: Date) => string): string {
  const d = iso === undefined ? null : parseIsoUtc(iso);
  return d === null ? "" : format(d);
}

/** Use Object Time Period / Specify Time Properties (Start, Stop) และ Step: Use default time points / Use step size ค่าตั้งต้นจาก style.time */
function TimeDialog({ job, busy, error, onEdit, onCancel, onOk }: TimeDialogProps) {
  const ids = useId();
  const formatter = useTimeFormatter();
  const period = useScenario((s) => s.doc?.analysis_period);
  const seed = job.style.time;
  const [mode, setMode] = useState<"object" | "specify">(seed.mode === "specify" ? "specify" : "object");
  const [startText, setStartText] = useState(() => isoText(seed.mode === "specify" ? (seed.start ?? period?.start) : period?.start, formatter.format));
  const [stopText, setStopText] = useState(() => isoText(seed.mode === "specify" ? (seed.stop ?? period?.stop) : period?.stop, formatter.format));
  const [useStep, setUseStep] = useState(seed.step_s !== null);
  const [stepText, setStepText] = useState(seed.step_s === null ? "" : String(seed.step_s));

  const start = parseTime(startText, formatter.fmt, formatter.ltz);
  const stop = parseTime(stopText, formatter.fmt, formatter.ltz);
  const startBad = mode === "specify" && start === null;
  const stopBad = mode === "specify" && (stop === null || (start !== null && stop.getTime() <= start.getTime()));
  const step = /^\d+$/.test(stepText.trim()) ? Number(stepText.trim()) : null;
  const stepBad = useStep && (step === null || step <= 0);
  const serverBad = (field: string): boolean => error?.field === field;
  const invalid = (bad: boolean, field: string): true | undefined => (bad || serverBad(field) ? true : undefined);
  const ok = !startBad && !stopBad && !stepBad && !busy;

  const submit = (): void => {
    if (!ok) return;
    const step_s = useStep ? step : null;
    if (mode === "object") onOk({ mode: "object", step_s });
    else if (start !== null && stop !== null) onOk({ mode: "specify", start: utcZ(start), stop: utcZ(stop), step_s });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form rgm-time" aria-describedby={undefined}>
          <Dialog.Title className="dlg-title">{t("rgm.timeProperties")}</Dialog.Title>
          <div className="rgm-time-body">
            <label className="access-choice">
              <input type="radio" name={`${ids}-mode`} checked={mode === "object"} onChange={() => { setMode("object"); onEdit("time.start"); }} />
              {t("access.useObjectTimePeriod")}
            </label>
            <label className="access-choice">
              <input type="radio" name={`${ids}-mode`} checked={mode === "specify"} onChange={() => setMode("specify")} />
              {t("rgm.specifyTimeProperties")}
            </label>
            <div className="access-times">
              <label htmlFor={`${ids}-start`}>{t("field.analysisStart")}</label>
              <input
                id={`${ids}-start`}
                className={invalid(startBad, "time.start") ? "field field-time field-invalid" : "field field-time"}
                aria-invalid={invalid(startBad, "time.start")}
                disabled={mode !== "specify"}
                value={startText}
                onChange={(e) => { setStartText(e.target.value); onEdit("time.start"); }}
              />
              <label htmlFor={`${ids}-stop`}>{t("field.analysisStop")}</label>
              <input
                id={`${ids}-stop`}
                className={invalid(stopBad, "time.stop") ? "field field-time field-invalid" : "field field-time"}
                aria-invalid={invalid(stopBad, "time.stop")}
                disabled={mode !== "specify"}
                value={stopText}
                onChange={(e) => { setStopText(e.target.value); onEdit("time.stop"); }}
              />
            </div>
            {(startBad || stopBad) && <p className="form-error">{msg("rgm.timeInvalid", { example: isoText(period?.start, formatter.format) })}</p>}
            <fieldset className="props-group">
              <legend>{t("rgm.step")}</legend>
              <label className="access-choice">
                <input type="radio" name={`${ids}-step`} checked={!useStep} onChange={() => { setUseStep(false); onEdit("time.step"); }} />
                {t("rgm.useDefaultTimePoints")}
              </label>
              <label className="access-choice">
                <input type="radio" name={`${ids}-step`} checked={useStep} onChange={() => setUseStep(true)} />
                {t("rgm.useStepSize")}
              </label>
              <div className="access-choice">
                <label htmlFor={`${ids}-stepS`}>{t("rgm.step")}</label>
                <input
                  id={`${ids}-stepS`}
                  className={invalid(stepBad, "time.step") ? "field rgm-step field-invalid" : "field rgm-step"}
                  inputMode="numeric"
                  aria-invalid={invalid(stepBad, "time.step")}
                  disabled={!useStep}
                  value={stepText}
                  onChange={(e) => { setStepText(e.target.value); onEdit("time.step"); }}
                />
                <span>{t("rgm.seconds")}</span>
              </div>
              {stepBad && <p className="form-error">{msg("rgm.stepInvalid")}</p>}
            </fieldset>
            {error !== null && <p className="form-error" role="alert">{error.text}</p>}
          </div>
          <div className="dlg-buttons">
            <button type="button" className="btn" disabled={!ok} onClick={submit}>{t("dialog.ok")}</button>
            <button type="button" className="btn" onClick={onCancel}>{t("dialog.cancel")}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function registerReportGraphManagerPanel(): void {
  const base = getPanelDef(RGM_KIND);
  if (base === undefined) throw new Error(`panel kind "${RGM_KIND}" is not registered`);
  registerPanel(RGM_KIND, { ...base, component: ReportGraphManager });
}
