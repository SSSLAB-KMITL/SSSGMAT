// หน้าต่างกราฟ (spec §6.2, STK ref §F): ECharts ของ POST /scenarios/{sc}/reports แบบ JSON (style ชนิด graph)
//
// - การโหลด Refresh (F5) แถบเตือนผลลัพธ์ไม่ตรง (409) และการคำนวณใหม่ ใช้ useReportLoader ตัวเดียวกับหน้าต่างรายงาน (windows/Report/Report.tsx)
// - ECharts โหลดแบบ lazy ผ่าน loadECharts (chart.ts) เท่านั้น ไฟล์นี้ import echarts ได้แค่ type; chunk โหลดไม่ได้ = ข้อความไทย role="alert"
//   และ Refresh ลองโหลดใหม่ (chart.ts ไม่จำการโหลดที่ล้ม)
// - option มาจาก options.ts: setOption เต็ม (notMerge) เมื่อข้อมูล/รูปแบบเวลา/สีเปลี่ยน (สีตาม colorKeyOf: แก้ส่วนอื่นของ scenario ไม่วาดใหม่),
//   ส่วนที่ตามเวลา animation (เส้นเวลา, จุดปัจจุบันของ polar, แกนของ Strip Chart) setOption แบบ merge ไม่เกินทุก GRAPH_TIME_REFRESH_MS ms ไม่เรียก server ซ้ำ
//   ปุ่มสลับ (เส้นเวลา, Crosshair Cursor) ก็ merge: การซูมของผู้ใช้คงอยู่; Zoom Out ใช้ไม่ได้กับกราฟ polar (ไม่มีการซูมตามเวลา)
// - Strip Chart = style ที่เปิด Dynamic Display (params.dynamic) ชนิด time_xy: แกนเวลาแสดง STRIP_CHART_DURATION_S วินาทีล่าสุดที่จบที่เวลาปัจจุบัน
// - แถบเครื่องมือ: Save (PNG), Copy to Clipboard (PNG), Zoom Out, Refresh, Toggle Animation Timeline, Crosshair Cursor
//   สองปุ่มสลับจำไว้ใน windowProps ของหน้าต่าง (อยู่ใน workbook)
// - คลิกขวา: Show Animation Time Line, Set Animation Time (เวลาที่ตำแหน่งคลิกบนแกนเวลา: เฉพาะ time_xy/interval ในพื้นที่กราฟ), Export (ชื่อเมนูตาม help.agi.com)
//   (ข้อมูลของกราฟทั้งช่วงเป็นไฟล์ CSV จาก server)
// - panel เปลี่ยนขนาด = chart.resize() ปิดหน้าต่าง = dispose

import * as ContextMenu from "@radix-ui/react-context-menu";
import type { EChartsType } from "echarts";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ApiError, errorText } from "../../api/client";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { downloadReport, type ReportJson } from "../../data/reports";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout, usePanelResize } from "../../stores/layout";
import { report as notify } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { useTime } from "../../stores/time";
import { ResultsBanner } from "../graphics/GraphicsFrame";
import { parseReportParams, requestOf, useReportLoader, type LoaderMessages, type PrepareReport } from "../Report/Report";
import { loadECharts, type ECharts } from "./chart";
import { drawnState } from "./drawnState";
import {
  colorKeyOf, graphCrosshairOption, graphOption, graphState, graphTimeOption, objectColorOf, readGraphTheme, registerGraphState, STRIP_CHART_DURATION_S,
  type GraphCtx,
} from "./options";

/** setOption ตามเวลา animation ไม่บ่อยกว่านี้ (ms) */
export const GRAPH_TIME_REFRESH_MS = 250;

const GRAPH_MESSAGES: LoaderMessages = { codePrefix: "GRAPH", failed: "graph.failed", computeFailed: "graph.computeFailed", computeJobFailed: "graph.computeJobFailed" };
/** กราฟไม่ต้องเตรียมอะไรเพิ่มหลังได้รายงาน (จุดปัจจุบันของ polar ประมาณค่าเองใน options.ts) */
const prepareNothing: PrepareReport<null> = async () => null;

/** ชื่อไฟล์แบบ report_filename ของ engine: `THBK-To-G01_AER.png` (หนึ่ง object) หรือ `AER.png` (หลาย object) อักขระแปลกเป็น `_` */
function fileName(report: ReportJson, ext: string): string {
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");
  const stem = report.sections.length === 1 ? `${safe(report.sections[0].title)}_${safe(report.style)}` : safe(report.style);
  return `${stem}.${ext}`;
}

function downloadDataUrl(url: string, name: string): void {
  const a = document.createElement("a");
  try {
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.append(a);
    a.click();
  } finally {
    a.remove();
  }
}

/** data URL แบบ base64 เป็น Blob */
function dataUrlBlob(url: string): Blob {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (m === null) throw new Error("not a data URL");
  const raw = m[2] !== undefined ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

const isF5 = (e: KeyboardEvent): boolean => e.key === "F5" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

export function Graph({ params, panelId }: PanelProps) {
  const p = useMemo(() => parseReportParams(params), [params]);
  const { sc, phase, failure, loaded, computing, bannerStatus, recompute, refresh, root, onKeyDown } =
    useReportLoader(p, panelId, prepareNothing, GRAPH_MESSAGES);
  const report = loaded?.report ?? null;
  const object = p !== null && p.objects.length === 1 ? p.objects[0] : null;

  const { fmt, ltz } = useTimeFormatter();
  const doc = useScenario((s) => s.doc);
  const stepS = doc?.step_s ?? 30;
  const prnByNorad = useResults((s) => s.prnByNorad);
  // ตัวหาสีสร้างใหม่เฉพาะเมื่อสิ่งที่สีขึ้นอยู่เปลี่ยน (แก้คำอธิบาย/ตำแหน่ง/ช่วงเวลาของ scenario ไม่วาดใหม่ ไม่ล้างการซูม)
  const colorKey = useMemo(() => colorKeyOf(doc, prnByNorad), [doc, prnByNorad]);
  const colorSource = useRef({ doc, prnByNorad });
  colorSource.current = { doc, prnByNorad };
  const colorOf = useMemo(() => objectColorOf(colorSource.current.doc, colorSource.current.prnByNorad), [colorKey]);
  const theme = useMemo(() => readGraphTheme(), []);
  const props = useLayout((s) => s.windowProps[panelId]);
  const showTimeLine = props?.showTimeLine !== false;
  const crosshair = props?.crosshair === true;
  const now = useThrottledTime(GRAPH_TIME_REFRESH_MS).getTime();
  const maxGapMs = Math.max(p?.time?.step_s ?? 0, stepS) * 1.5 * 1000;
  const stripMs = p?.dynamic === true && report?.graph?.type === "time_xy" ? STRIP_CHART_DURATION_S * 1000 : null;
  const ctx: GraphCtx = { dateFormat: fmt, ltz, colorOf, now, showTimeLine, stripMs, maxGapMs, crosshair, theme };
  const latest = useRef({ ctx, report });
  latest.current = { ctx, report };

  // ---------- ECharts ----------
  const [lib, setLib] = useState<ECharts | null>(null);
  const [chunkFailed, setChunkFailed] = useState(false);
  const [chunkAttempt, setChunkAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadECharts().then(
      (m) => {
        if (!alive) return;
        setLib(m);
        setChunkFailed(false);
      },
      () => {
        if (alive) setChunkFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [chunkAttempt]);

  const chartDiv = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<EChartsType | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  /** มี option ของรายงานปัจจุบันอยู่ในกราฟแล้ว (graphState และการล้างกราฟ) */
  const drawn = useRef(false);
  useEffect(() => {
    const el = chartDiv.current;
    if (lib === null || el === null) return;
    const c = lib.init(el, undefined, { renderer: "canvas" });
    chartRef.current = c;
    setChart(c);
    return () => {
      chartRef.current = null;
      drawn.current = false;
      setChart(null);
      c.dispose();
    };
  }, [lib]);
  usePanelResize(panelId, () => chartRef.current?.resize());

  /** ค่าของปุ่มสลับที่อยู่ในกราฟแล้ว (การสลับใช้ setOption แบบ merge ไม่วาดใหม่ทั้งกราฟ การซูมของผู้ใช้จึงคงอยู่) */
  const applied = useRef({ showTimeLine, crosshair });

  // option เต็ม: เมื่อข้อมูล รูปแบบเวลา หรือสีเปลี่ยน (เวลาปัจจุบันและปุ่มสลับอ่านจาก latest)
  useEffect(() => {
    if (chart === null) return;
    const option = report === null ? null : graphOption(report, latest.current.ctx);
    if (option === null) {
      if (drawn.current) chart.clear();
      drawn.current = false;
      return;
    }
    chart.setOption(option, { notMerge: true });
    drawn.current = true;
    applied.current = { showTimeLine: latest.current.ctx.showTimeLine, crosshair: latest.current.ctx.crosshair === true };
  }, [chart, report, fmt, ltz, colorOf, stripMs, maxGapMs, theme]);

  // ส่วนที่ตามเวลา animation และ Show Animation Time Line (merge): เส้นเวลา จุดปัจจุบัน และแกนของ Strip Chart
  useEffect(() => {
    const { report: r, ctx: c } = latest.current;
    if (chart === null || r === null || !drawn.current) return;
    if (!c.showTimeLine && c.stripMs === null && !applied.current.showTimeLine) return; // ซ่อนอยู่แล้ว ไม่มีอะไรเปลี่ยน
    const part = graphTimeOption(r, c);
    if (part !== null) chart.setOption(part);
    applied.current.showTimeLine = c.showTimeLine;
  }, [chart, now, showTimeLine]);

  // Crosshair Cursor (merge)
  useEffect(() => {
    const { report: r, ctx: c } = latest.current;
    if (chart === null || r === null || !drawn.current || applied.current.crosshair === crosshair) return;
    const part = graphCrosshairOption(r, c);
    if (part !== null) chart.setOption(part);
    applied.current.crosshair = crosshair;
  }, [chart, crosshair]);

  useEffect(() => registerGraphState(panelId, () => {
    const { report: r, ctx: c } = latest.current;
    if (r === null || !drawn.current) return null;
    const state = graphState(r, c);
    return state === null ? null : { ...state, drawn: chartRef.current === null ? null : drawnState(chartRef.current) };
  }), [panelId]);

  // ---------- คำสั่ง ----------
  const setProp = (key: "showTimeLine" | "crosshair", value: boolean): void => {
    const cur = useLayout.getState().windowProps[panelId] ?? {};
    useLayout.getState().setWindowProps(panelId, { ...cur, [key]: value });
  };
  const toggleTimeLine = (): void => setProp("showTimeLine", !showTimeLine);

  const pngUrl = (c: EChartsType): string => c.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: theme.bg });

  const save = (): void => {
    if (chart === null || report === null) return;
    try {
      downloadDataUrl(pngUrl(chart), fileName(report, "png"));
    } catch (e) {
      notify("error", "GRAPH_SAVE", msg("graph.saveFailed", { message: errorText(e) }), object);
    }
  };

  const copy = async (): Promise<void> => {
    if (chart === null) return;
    const clipboard = navigator.clipboard as Clipboard | undefined;
    const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (typeof clipboard?.write !== "function" || Item === undefined) {
      notify("error", "GRAPH_CLIPBOARD", msg("graph.clipboardUnavailable"), object);
      return;
    }
    try {
      await clipboard.write([new Item({ "image/png": dataUrlBlob(pngUrl(chart)) })]);
    } catch (e) {
      notify("error", "GRAPH_CLIPBOARD", msg("graph.copyFailed", { message: errorText(e) }), object);
    }
  };

  const zoomOut = (): void => {
    chart?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  };

  /** Refresh ลองโหลด chunk ของ ECharts ใหม่ด้วยเมื่อครั้งก่อนล้ม */
  const refreshAll = (): void => {
    if (chunkFailed) setChunkAttempt((a) => a + 1);
    refresh();
  };
  const onGraphKeyDown = (e: KeyboardEvent): void => {
    if (isF5(e) && chunkFailed) setChunkAttempt((a) => a + 1);
    onKeyDown(e);
  };

  const exportCsv = async (): Promise<void> => {
    if (p === null || sc === null) return;
    try {
      await downloadReport(sc, requestOf(p), "csv");
    } catch (e) {
      notify("error", e instanceof ApiError ? e.code : "GRAPH_EXPORT", msg("graph.exportFailed", { message: errorText(e) }), object);
    }
  };

  // เมนูคลิกขวา: เวลาที่ตำแหน่งคลิก จดตอนคลิก (Radix เปิดเมนูในเหตุการณ์เดียวกัน)
  const [menuTime, setMenuTime] = useState<number | null>(null);
  const onContextMenuCapture = (e: ReactMouseEvent): void => {
    let at: number | null = null;
    const c = chartRef.current;
    const el = chartDiv.current;
    const type = report?.graph?.type;
    if (c !== null && el !== null && drawn.current && (type === "time_xy" || type === "interval")) {
      const rect = el.getBoundingClientRect();
      const px = [e.clientX - rect.left, e.clientY - rect.top];
      if (c.containPixel({ gridIndex: 0 }, px)) {
        const v = c.convertFromPixel({ gridIndex: 0 }, px) as number[] | number;
        const ms = Array.isArray(v) ? v[0] : v;
        if (Number.isFinite(ms)) at = ms;
      }
    }
    setMenuTime(at);
  };

  // ---------- ข้อความแทนกราฟ ----------
  let note: string | null = null;
  if (p === null) note = msg("graph.badParams");
  else if (sc === null) note = msg("tooltip.noScenario");
  else if (computing) note = msg("graph.computing");
  else if (phase === "notCurrent") note = msg("graph.notCurrent");
  else if (phase === "styleInvalid") note = msg("graph.styleInvalid");
  else if (phase === "failed") note = failure ?? "";
  else if (report === null) note = msg("graph.loading");
  else if (report.graph === null) note = msg("graph.noGraph");
  else if (lib === null && !chunkFailed) note = msg("graph.loading");
  const canDraw = chart !== null && report !== null && report.graph !== null && note === null;

  return (
    <div ref={root} className="rpt graph" tabIndex={-1} onKeyDown={onGraphKeyDown}>
      <div className="rpt-toolbar" role="toolbar" aria-label={t("window.graph")}>
        <button type="button" className="btn" disabled={!canDraw} title={msg("graph.saveHint")} onClick={save}>{t("graph.save")}</button>
        <button type="button" className="btn" disabled={!canDraw} title={msg("graph.copyHint")} onClick={() => void copy()}>{t("graph.copyToClipboard")}</button>
        <button type="button" className="btn" disabled={!canDraw || report?.graph?.type === "polar90"} title={msg("graph.zoomOutHint")} onClick={zoomOut}>
          {t("graph.zoomOut")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={p === null || sc === null || computing}
          title={computing ? msg("banner.running") : msg("graph.refreshHint")}
          onClick={refreshAll}
        >
          {t("report.refresh")}
        </button>
        <button type="button" className="btn graph-toggle" aria-pressed={showTimeLine} title={msg("graph.timelineHint")} onClick={toggleTimeLine}>
          {t("graph.toggleAnimationTimeline")}
        </button>
        <button type="button" className="btn graph-toggle" aria-pressed={crosshair} title={msg("graph.crosshairHint")} onClick={() => setProp("crosshair", !crosshair)}>
          {t("graph.crosshairCursor")}
        </button>
        {phase === "loading" && report !== null && <span className="rpt-busy">{msg("graph.loading")}</span>}
      </div>
      <ResultsBanner status={bannerStatus} onApply={recompute} />
      {chunkFailed && <p className="graph-alert" role="alert">{msg("graph.chunkFailed")}</p>}
      <div className="rpt-body">
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div
              ref={chartDiv}
              className="graph-chart"
              style={{ visibility: canDraw ? "visible" : "hidden" }}
              onContextMenuCapture={onContextMenuCapture}
            />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="menu-content">
              <ContextMenu.CheckboxItem className="menu-item" checked={showTimeLine} onSelect={toggleTimeLine}>
                <ContextMenu.ItemIndicator className="menu-indicator">
                  <Check size={12} aria-hidden="true" />
                </ContextMenu.ItemIndicator>
                <span className="menu-label">{t("graph.showAnimationTimeLine")}</span>
              </ContextMenu.CheckboxItem>
              {menuTime !== null && (
                <ContextMenu.Item className="menu-item" onSelect={() => useTime.getState().setCurrent(new Date(menuTime))}>
                  <span className="menu-label">{t("report.setAnimationTime")}</span>
                </ContextMenu.Item>
              )}
              <ContextMenu.Item className="menu-item" disabled={report === null} onSelect={() => void exportCsv()}>
                <span className="menu-label">{t("graph.export")}</span>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        {note !== null && <p className="rpt-note graph-note">{note}</p>}
      </div>
    </div>
  );
}

/** ลงทะเบียนหน้าต่างกราฟเป็นชนิด graph (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด กุญแจ และ persist/scenarioBound คงตามที่ลงไว้ใน layout/panels.ts ลงซ้ำได้ */
export function registerGraphPanel(): void {
  const base = getPanelDef("graph");
  if (base === undefined) throw new Error('panel kind "graph" is not registered');
  registerPanel("graph", { ...base, component: Graph });
}

