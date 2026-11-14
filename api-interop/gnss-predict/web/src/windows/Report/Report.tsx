// หน้าต่างรายงาน (spec §6.1, STK ref §F): ตารางของ POST /scenarios/{sc}/reports แบบ JSON
//
// - Report/Graph: สร้างรายงานครั้งเดียวตอนเปิด (และเมื่อ Refresh / F5) ไม่เดินตามเวลา animation แถวมาจาก flattenRows (table.ts)
//   ตารางวาดแบบ virtual (TanStack Virtual): มีใน DOM เฉพาะแถวใกล้พื้นที่เห็น รายงานหลายแสนแถวเลื่อนได้
// - Dynamic Display (params.dynamic): โหลดทั้งช่วงครั้งเดียว แล้วแสดงแถวของเวลา animation ปัจจุบัน (valueAt ของ data/dynamic.ts
//   วิธีประมาณค่าต่อคอลัมน์จาก GET /dataproviders) รีเฟรชไม่เกิน ~10 ครั้งต่อวินาที ไม่เรียก server ทุกเฟรม
//   ช่องว่างระหว่างแถวที่ยาวเกิน max(step ของคำขอ, step ของ scenario) × 1.5 = นอกข้อมูล (No Data)
// - แถบเครื่องมือ: Refresh (F5 เมื่อโฟกัสอยู่ในหน้าต่างนี้), Export ▸ To CSV Format... / Setup... (Export Setup เก็บใน windowProps ของหน้าต่าง)
// - คลิกขวาที่ช่องเวลา: Set Animation Time (ตั้งเวลา animation เป็นเวลาของช่องนั้น)
// - ข้อผิดพลาด (spec §8):
//     409 RESULTS_NOT_CURRENT = แถบเตือนเดียวกับหน้าต่าง 3D/2D (ResultsBanner) และ Refresh (หรือ Apply บนแถบ) สั่งคำนวณใหม่:
//       object แบบ Access → POST /access/compute (If-Match) ของ access ที่มีอยู่แล้วซึ่งครอบดาวนั้น (ไม่มี = Facility → ดาวนั้น)
//       ได้ job (202) = รอจน job สำเร็จแล้วสร้างรายงานใหม่ ไม่มี job (ผล current แล้ว) = สร้างใหม่ทันที; object ที่เป็นดาว = POST /propagate
//     422 STYLE_INVALID = ข้อความใน Message Viewer และตารางว่างพร้อมคำอธิบาย ข้อผิดพลาดอื่น = Message Viewer + ข้อความในหน้าต่าง

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menubar from "@radix-ui/react-menubar";
import { useVirtualizer, type Rect } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ApiError, apiSend, errorText, isAbortError } from "../../api/client";
import { recordQueuedJob, startJob } from "../../api/startJob";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import {
  downloadReport, fetchProviders, fetchReport, type ElementInfo, type ExportSetup, type ReportJson, type ReportRequest,
} from "../../data/reports";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, isPanelKind, registerPanel, type PanelProps } from "../../layout/panels";
import { useJobs } from "../../stores/jobs";
import { useLayout } from "../../stores/layout";
import { report as notify } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario, type ScenarioDoc } from "../../stores/scenario";
import { useTime } from "../../stores/time";
import type { DateFormat } from "../../time/format";
import { ResultsBanner } from "../graphics/GraphicsFrame";
import { observeViewportWithFallback } from "../virtualList";
import { ExportSetupDialog, parseExportSetup } from "./ExportSetupDialog";
import { dynamicRows, flattenRows, prepareDynamic, registerShownRows, type DynamicSection, type FlatRow } from "./table";

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

const requestOf = (p: ReportParams): ReportRequest => ({ style: p.style, kind: p.kind, objects: p.objects, time: p.time, dynamic: p.dynamic });

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

type Compute = { from: string; to: string[] };

/**
 * สิ่งที่ต้องคำนวณใหม่ให้ object ของรายงาน: Compute ของ access ต่อ Facility (ใช้ `to` ของ access ที่มีอยู่แล้วซึ่งครอบดาวนั้น ตรง ๆ หรือผ่าน
 * Constellation ไม่มี = ดาวนั้นเอง) และ propagate สำหรับ object ที่เป็นดาว (หรือ Facility ที่ไม่มี access ให้ Compute)
 */
export function recomputePlan(doc: ScenarioDoc | null, objects: readonly string[]): { computes: Compute[]; propagate: boolean } {
  const accesses = doc?.accesses ?? [];
  const members = new Map<string, string[]>();
  for (const o of doc?.objects ?? []) {
    if (o.class === "Constellation") members.set(`${CONSTELLATION}${o.name}`, (o as { assigned_objects?: string[] }).assigned_objects ?? []);
  }
  const covers = (to: readonly string[], sat: string): boolean => to.some((p) => p === sat || (members.get(p)?.includes(sat) ?? false));

  const byFacility = new Map<string, Set<string>>();
  let propagate = false;
  for (const obj of objects) {
    const parts = obj.split(" ");
    const facility = parts.find((p) => p.startsWith(FACILITY));
    if (facility === undefined) {
      propagate = true;
      continue;
    }
    const sats = byFacility.get(facility) ?? new Set<string>();
    for (const p of parts) if (p.startsWith(SATELLITE)) sats.add(p);
    byFacility.set(facility, sats);
  }

  const computes = new Map<string, Compute>();
  const add = (c: Compute): void => void computes.set(JSON.stringify(c), c);
  for (const [facility, sats] of byFacility) {
    const own = accesses.filter((a) => a.from === facility && Array.isArray(a.to) && a.to.length > 0);
    if (sats.size === 0) {
      // รายงานของ Facility (DOP, N Asset Coverage): คำนวณผ่าน access ใดก็ได้ของมัน ไม่มี access = propagate (ได้แค่ ephem)
      if (own.length > 0) add({ from: facility, to: [...own[0].to] });
      else propagate = true;
      continue;
    }
    const loose: string[] = [];
    for (const sat of sats) {
      const entry = own.find((a) => covers(a.to, sat));
      if (entry !== undefined) add({ from: facility, to: [...entry.to] });
      else loose.push(sat);
    }
    if (loose.length > 0) add({ from: facility, to: loose });
  }
  return { computes: [...computes.values()], propagate };
}

/** รอ job ทั้งหมดจบ: true = สำเร็จทุกตัว, false = ตัวใดล้มเหลว/ถูกยกเลิก หรือ signal ยกเลิก */
function waitForJobs(ids: readonly string[], signal: AbortSignal): Promise<boolean> {
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

interface Loaded {
  report: ReportJson;
  /** Dynamic Display เท่านั้น */
  dynamic: DynamicSection[] | null;
}

export function Report({ params, panelId }: PanelProps) {
  const p = useMemo(() => parseReportParams(params), [params]);
  const key = p === null ? "" : JSON.stringify(requestOf(p));
  const sc = useScenario((s) => s.name);
  const stepS = useScenario((s) => s.doc?.step_s ?? 30);
  const resultsStatus = useResults((s) => s.status);
  const { fmt, ltz } = useTimeFormatter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [revision, setRevision] = useState(0);
  const [computing, setComputing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const stored = useLayout((s) => s.windowProps[panelId]?.exportSetup);
  const setup = useMemo(() => parseExportSetup(stored), [stored]);
  const latest = useRef({ p, sc });
  latest.current = { p, sc };
  /** ยกเลิกการรอ job ของ Refresh เมื่อหน้าต่างปิด */
  const life = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    life.current = ctrl;
    return () => ctrl.abort();
  }, []);

  // สร้างรายงาน: ตอนเปิด, เมื่อ scenario/params เปลี่ยน และเมื่อ Refresh (revision) ไม่ขึ้นกับเวลา animation
  useEffect(() => {
    const cur = latest.current.p;
    if (cur === null || sc === null) return;
    const ctrl = new AbortController();
    const object = cur.objects.length === 1 ? cur.objects[0] : null;
    setPhase("loading");
    void (async () => {
      try {
        const report = await fetchReport(sc, requestOf(cur), ctrl.signal);
        let dynamic: DynamicSection[] | null = null;
        if (cur.dynamic) {
          let elements: ElementInfo[] = [];
          try {
            elements = await providerElements(sc, cur.objects, ctrl.signal);
          } catch (e) {
            if (isAbortError(e) || ctrl.signal.aborted) return;
            notify("warning", e instanceof ApiError ? e.code : "REPORT_PROVIDERS", msg("report.providersFailed", { message: errorText(e) }), object);
          }
          dynamic = prepareDynamic(report, elements);
        }
        if (ctrl.signal.aborted) return;
        setLoaded({ report, dynamic });
        setFailure(null);
        setPhase("ready");
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) return;
        setLoaded(null);
        if (e instanceof ApiError && e.code === "RESULTS_NOT_CURRENT") {
          setPhase("notCurrent");
        } else if (e instanceof ApiError && e.code === "STYLE_INVALID") {
          notify("error", e.code, e.text, object);
          setPhase("styleInvalid");
        } else {
          const text = msg("report.failed", { message: errorText(e) });
          notify("error", e instanceof ApiError ? e.code : "REPORT_FAILED", text, object);
          setFailure(text);
          setPhase("failed");
        }
      }
    })();
    return () => ctrl.abort();
  }, [sc, key, revision]);

  /** ผลลัพธ์ไม่ตรง: Compute / propagate แล้วรอ job จบก่อนสร้างรายงานใหม่ (ผู้เรียกแจ้งข้อผิดพลาดเอง) */
  const recompute = useCallback(async (): Promise<void> => {
    const { p: cur, sc: name } = latest.current;
    const signal = life.current?.signal;
    if (cur === null || name === null || signal === undefined) return;
    const object = cur.objects.length === 1 ? cur.objects[0] : null;
    const plan = recomputePlan(useScenario.getState().doc, cur.objects);
    setComputing(true);
    try {
      const jobs: string[] = [];
      let etag = useScenario.getState().etag;
      for (const body of plan.computes) {
        const res = await apiSend<{ job?: unknown; etag?: unknown }>("POST", `/scenarios/${encodeURIComponent(name)}/access/compute`, body, etag);
        etag = res.etag ?? (typeof res.data?.etag === "string" ? `"${res.data.etag}"` : etag);
        if (typeof res.data?.job === "string") {
          recordQueuedJob(res.data.job, "analyze", name);
          jobs.push(res.data.job);
        }
      }
      if (plan.propagate) jobs.push(await startJob(`/scenarios/${encodeURIComponent(name)}/propagate`, "propagate", name));
      const ok = await waitForJobs(jobs, signal);
      if (signal.aborted) return;
      if (ok) setRevision((r) => r + 1);
      else notify("error", "REPORT_COMPUTE", msg("report.computeJobFailed"), object);
    } catch (e) {
      if (!signal.aborted) notify("error", e instanceof ApiError ? e.code : "REPORT_COMPUTE", msg("report.computeFailed", { message: errorText(e) }), object);
    } finally {
      if (!signal.aborted) setComputing(false);
    }
  }, []);

  const refresh = (): void => {
    if (computing) return;
    if (phase === "notCurrent") void recompute();
    else setRevision((r) => r + 1);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "F5" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    e.preventDefault(); // ไม่ให้ browser โหลดหน้าเว็บใหม่
    e.stopPropagation();
    refresh();
  };

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

  const bannerStatus = phase === "notCurrent" ? (resultsStatus === "missing" ? "missing" : "stale") : null;
  const maxGapMs = Math.max(p?.time?.step_s ?? 0, stepS) * 1.5 * 1000;

  let body: ReactNode;
  if (p === null) body = <p className="rpt-note">{msg("report.badParams")}</p>;
  else if (sc === null) body = <p className="rpt-note">{msg("tooltip.noScenario")}</p>;
  else if (loaded !== null && phase !== "notCurrent" && phase !== "styleInvalid" && phase !== "failed") {
    body = loaded.dynamic === null
      ? <StaticTable panelId={panelId} report={loaded.report} fmt={fmt} ltz={ltz} />
      : <DynamicTable panelId={panelId} report={loaded.report} prepared={loaded.dynamic} maxGapMs={maxGapMs} fmt={fmt} ltz={ltz} />;
  } else {
    const note = computing ? msg("report.computing")
      : phase === "notCurrent" ? msg("report.notCurrent")
      : phase === "styleInvalid" ? msg("report.styleInvalid")
      : phase === "failed" ? (failure ?? "")
      : msg("report.loading");
    body = <p className="rpt-note">{note}</p>;
  }

  return (
    <div className="rpt" tabIndex={-1} onKeyDown={onKeyDown}>
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
                  <span className="menu-label">{t("report.toCsvFormat")}</span>
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
const TIME_WIDTH = 230;
const VALUE_WIDTH = 130;

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

  const columns = report.sections[0]?.columns ?? [];
  const width = Math.max(2, ...report.sections.map((s) => s.columns.length));

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
          <table className="rpt-table">
            <colgroup>
              {Array.from({ length: width }, (_, i) => (
                <col key={i} style={{ width: columns[i]?.kind === "time" ? TIME_WIDTH : VALUE_WIDTH }} />
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
          <th colSpan={width} scope="colgroup">{row.cells[0]}</th>
        </tr>
      );
    case "header":
      return (
        <tr className="rpt-head" style={style}>
          {row.cells.map((c, i) => <th key={i} scope="col">{c}</th>)}
        </tr>
      );
    case "nodata":
      return (
        <tr className="rpt-nodata" style={style}>
          <td colSpan={width}>{row.cells[0]}</td>
        </tr>
      );
    case "summary":
    case "global":
      return (
        <tr className="rpt-stat" style={style}>
          <td>{row.cells[0]}</td>
          <td className="rpt-num">{row.cells[1]}</td>
        </tr>
      );
    default:
      return (
        <tr className="rpt-row" style={style}>
          {row.cells.map((c, i) => {
            const ms = timeAt(row, i);
            return ms === null
              ? <td key={i} className="rpt-num">{c}</td>
              : <td key={i} className="rpt-time" data-time={ms}>{c}</td>;
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
