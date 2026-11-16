// หน้า Validation (spec §7, เพิ่มเอง): ประวัติการตรวจ predicted.sp3 เทียบ SP3 จริง เปิดจาก Analysis → Validation... เป็นหน้าต่าง Integrated บานเดียว
//
// - ตารางรายวัน: ประวัติ (`GET /validation/history`) รวมกับวันที่ยังไม่มีผล (`GET /validation/pending`) เรียงวันใหม่สุดก่อน; ΔEl ค่ากลาง/P99 ต่อระบบ สลับเป็น ΔAz ได้;
//   Result = Pass / Fail / Pending (พร้อมเวลาที่จะลองครั้งถัดไป ตาม DateFormat ของ scenario ที่เปิดอยู่ ไม่มี = UTCG) / Gave up (rows.ts)
// - คลิกวันที่ตรวจแล้ว (Pass / Fail) = ตารางรายดวง (`GET /validation/{sc}/{day}`) กรองตามระบบและผลได้ วัน Pending / Gave up ไม่มีผลให้เปิด
// - กราฟแนวโน้ม P99 ต่อระบบพร้อมเส้นเกณฑ์ (0.2° / 0.5°) และกราฟอายุข้อมูลกับระยะคลาด 3 มิติของทุกวันรวมกัน: ECharts จาก loadECharts (windows/Graph/chart.ts) เท่านั้น
//   กราฟอายุต้องใช้ผลรายดวงของทุกวัน: ดึงทีละกลุ่มเล็ก ๆ ตอนเปิดหน้าต่าง ที่เก็บผลรายวัน (promise ต่อวัน + created_utc ของบรรทัดประวัติ) ใช้ร่วมกับตารางรายดวง
//   จึงไม่ดึงวันเดียวกันซ้ำ; วันที่อ่านไม่ได้ข้ามเงียบ ๆ (ตารางรายดวงของวันนั้นแจ้งเองเมื่อคลิก) ตรวจซ้ำแล้ว created_utc เปลี่ยน = ดึงใหม่
// - งานตรวจ (job validate) ที่จบลง (สำเร็จ ล้มเหลว หรือถูกยกเลิก) ทำให้โหลดสองรายการใหม่เอง (วัน Pending กลายเป็นผล หรือเวลาลองครั้งถัดไปเปลี่ยน); Refresh โหลดเอง
// - ไม่ผูกกับ scenario: ใช้ได้โดยไม่เปิด scenario ไม่เรียก POST /validate หรือ /daily/run (หน้านี้อ่านอย่างเดียว)
// - chunk ของ ECharts โหลดไม่ได้ = ข้อความไทย role="alert" (ตารางยังใช้ได้) Refresh ลองโหลดใหม่ ปิดหน้าต่าง = dispose ทั้งสองกราฟ

import type { EChartsType } from "echarts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, errorText } from "../../api/client";
import { useTimeFormatter } from "../../chrome/hooks";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { isActiveJob, useJobs } from "../../stores/jobs";
import { usePanelResize } from "../../stores/layout";
import { parseIsoUtc } from "../../time/parse";
import { loadECharts, type ECharts } from "../Graph/chart";
import { readGraphTheme } from "../Graph/options";
import { VALIDATION_KIND } from "./commands";
import { ageOption, trendOption, type ChartCtx } from "./options";
import {
  ageScatter, dailyRows, docSystems, fixed, pairText, parseDay, parseHistory, parsePending, satelliteRows, systemLetters, trendSeries,
  type DailyRow, type DayResult, type HistoryRecord, type Metric, type PendingDay, type ValidationDoc,
} from "./rows";

/** ผลรายวันที่ดึงพร้อมกันในหนึ่งกลุ่ม (กราฟอายุ) */
const AGE_BATCH = 8;
const DASH = "—";

const SYSTEM_LABELS: Record<string, LabelKey> = {
  G: "option.system.gps", R: "option.system.glonass", E: "option.system.galileo", C: "option.system.beidou",
};
/** ชื่อที่แสดงของระบบจากอักษรนำ (G -> GPS) อักษรที่ไม่รู้จักแสดงตามที่เป็น */
const systemName = (letter: string): string => (Object.hasOwn(SYSTEM_LABELS, letter) ? t(SYSTEM_LABELS[letter]) : letter);

const DAY_RESULT_LABELS: Record<DayResult, LabelKey> = {
  pass: "validation.result.pass", fail: "validation.result.fail", pending: "validation.result.pending", gave_up: "validation.result.gaveUp",
};
const SAT_RESULT_LABELS: Record<string, LabelKey> = {
  pass: "validation.result.pass", fail: "validation.result.fail",
  insufficient_data: "validation.result.insufficientData", unverified: "validation.result.unverified",
};
/** ค่าของตัวกรองผลรายดวงตามลำดับที่แสดง */
const SAT_RESULTS = ["pass", "fail", "insufficient_data", "unverified"] as const;
const satResultName = (result: string | null): string =>
  result === null ? DASH : Object.hasOwn(SAT_RESULT_LABELS, result) ? t(SAT_RESULT_LABELS[result]) : result;

const METRIC_LABELS: Record<Metric, LabelKey> = { el: "validation.metric.el", az: "validation.metric.az" };

interface Lists {
  /** null = โหลดไม่สำเร็จ (historyError บอกเหตุ) */
  history: HistoryRecord[] | null;
  historyError: string | null;
  pending: PendingDay[];
  pendingError: string | null;
}

interface Detail {
  key: string;
  doc: ValidationDoc | null;
  error: string | null;
}

interface Ages {
  docs: ValidationDoc[];
  done: number;
  total: number;
}

/** กราฟหนึ่งกราฟบน div ที่ส่งมา (null = ยังไม่มี div หรือยังไม่ได้โหลด ECharts) */
function useChartInstance(lib: ECharts | null, el: HTMLDivElement | null): EChartsType | null {
  const [chart, setChart] = useState<EChartsType | null>(null);
  useEffect(() => {
    if (lib === null || el === null) return;
    const c = lib.init(el, undefined, { renderer: "canvas" });
    setChart(c);
    return () => {
      setChart(null);
      c.dispose();
    };
  }, [lib, el]);
  return chart;
}

export function Validation({ panelId }: PanelProps) {
  const { format } = useTimeFormatter();

  // ---------- รายการ (history + pending) ----------
  const [lists, setLists] = useState<Lists | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      const [h, p] = await Promise.allSettled([
        apiGet<unknown>("/validation/history", { signal: ac.signal }),
        apiGet<unknown>("/validation/pending", { signal: ac.signal }),
      ]);
      if (ac.signal.aborted) return;
      setLists({
        history: h.status === "fulfilled" ? parseHistory(h.value.data) : null,
        historyError: h.status === "rejected" ? errorText(h.reason) : null,
        pending: p.status === "fulfilled" ? parsePending(p.value.data) : [],
        pendingError: p.status === "rejected" ? errorText(p.reason) : null,
      });
    })();
    return () => ac.abort();
  }, [reload]);

  // งานตรวจที่จบลง (ไม่ใช่ที่เพิ่งเข้าคิวหรือรายการเก่าที่ดึงมาทีหลัง): โหลดสองรายการใหม่
  useEffect(
    () =>
      useJobs.subscribe((state, prev) => {
        const finished = Object.values(state.jobs).some((j) => {
          const before = prev.jobs[j.id];
          return j.kind === "validate" && before !== undefined && isActiveJob(before) && !isActiveJob(j);
        });
        if (finished) setReload((n) => n + 1);
      }),
    [],
  );

  const [metric, setMetric] = useState<Metric>("el");
  const history = useMemo(() => lists?.history ?? [], [lists]);
  const pending = lists?.pending;
  const rows = useMemo(() => dailyRows(history, pending ?? [], metric), [history, pending, metric]);
  const letters = useMemo(() => systemLetters(rows), [rows]);
  /** วันที่ตรวจแล้ว (เปิดดูรายดวงได้) สถิติของ Metric ไม่เกี่ยว จึงไม่ขึ้นกับ metric */
  const validated = useMemo(() => dailyRows(history, [], "el"), [history]);
  const trend = useMemo(() => trendSeries(history, metric), [history, metric]);

  // ---------- ผลรายวัน (ที่เก็บร่วมของตารางรายดวงกับกราฟอายุ) ----------
  const docs = useRef(new Map<string, Promise<ValidationDoc>>());
  const loadDoc = useCallback((row: DailyRow): Promise<ValidationDoc> => {
    const key = `${row.key}@${row.created ?? ""}`;
    let found = docs.current.get(key);
    if (found === undefined) {
      const p = apiGet<unknown>(`/validation/${encodeURIComponent(row.scenario)}/${row.day}`).then((r) => {
        const doc = parseDay(r.data);
        if (doc === null) throw new Error(msg("validation.dayInvalid"));
        return doc;
      });
      p.catch(() => {
        if (docs.current.get(key) === p) docs.current.delete(key); // ล้ม = ไม่จำ (คลิกหรือ Refresh แล้วลองใหม่ได้)
      });
      docs.current.set(key, p);
      found = p;
    }
    return found;
  }, []);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [system, setSystem] = useState("");
  const [result, setResult] = useState("");
  const selectedRow = useMemo(() => validated.find((r) => r.key === selectedKey) ?? null, [validated, selectedKey]);
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    if (selectedRow === null) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail({ key: selectedRow.key, doc: null, error: null });
    loadDoc(selectedRow).then(
      (doc) => {
        if (alive) setDetail({ key: selectedRow.key, doc, error: null });
      },
      (e: unknown) => {
        if (alive) {
          setDetail({ key: selectedRow.key, doc: null, error: msg("validation.dayFailed", { scenario: selectedRow.scenario, day: selectedRow.day, message: errorText(e) }) });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [selectedRow, loadDoc]);

  const select = (row: DailyRow): void => {
    if (row.key === selectedKey) return;
    setSelectedKey(row.key);
    setSystem("");
    setResult("");
  };

  const [ages, setAges] = useState<Ages>({ docs: [], done: 0, total: 0 });
  useEffect(() => {
    let alive = true;
    const total = validated.length;
    setAges({ docs: [], done: 0, total });
    void (async () => {
      const got: ValidationDoc[] = [];
      for (let i = 0; i < total; i += AGE_BATCH) {
        const batch = await Promise.all(validated.slice(i, i + AGE_BATCH).map((row) => loadDoc(row).catch(() => null)));
        if (!alive) return;
        for (const doc of batch) if (doc !== null) got.push(doc);
        setAges({ docs: [...got], done: Math.min(i + AGE_BATCH, total), total });
      }
    })();
    return () => {
      alive = false;
    };
  }, [validated, loadDoc]);
  const points = useMemo(() => ageScatter(ages.docs), [ages.docs]);

  // ---------- ECharts ----------
  const [lib, setLib] = useState<ECharts | null>(null);
  const [chunkFailed, setChunkFailed] = useState(false);
  const [chunkAttempt, setChunkAttempt] = useState(0);
  /** มีวันที่ตรวจแล้ว = มีกราฟให้วาด: ไม่มี (ประวัติว่าง) ก็ไม่ต้องโหลด ECharts */
  const wantCharts = validated.length > 0;
  useEffect(() => {
    if (!wantCharts) {
      setChunkFailed(false);
      return;
    }
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
  }, [chunkAttempt, wantCharts]);

  const [trendEl, setTrendEl] = useState<HTMLDivElement | null>(null);
  const [ageEl, setAgeEl] = useState<HTMLDivElement | null>(null);
  const trendChart = useChartInstance(lib, trendEl);
  const ageChart = useChartInstance(lib, ageEl);
  const charts = useRef<(EChartsType | null)[]>([]);
  charts.current = [trendChart, ageChart];
  usePanelResize(panelId, () => {
    for (const c of charts.current) c?.resize();
  });
  const ctx = useMemo<ChartCtx>(() => ({ theme: readGraphTheme(), systemName, xName: t("validation.ageX"), yName: t("validation.ageY") }), []);
  useEffect(() => {
    if (trendChart !== null) trendChart.setOption(trendOption(trend, ctx), { notMerge: true });
  }, [trendChart, trend, ctx]);
  useEffect(() => {
    if (ageChart !== null) ageChart.setOption(ageOption(points, ctx), { notMerge: true });
  }, [ageChart, points, ctx]);

  const refresh = (): void => {
    if (chunkFailed) setChunkAttempt((a) => a + 1);
    setReload((n) => n + 1);
  };

  // ---------- วาด ----------
  const empty = lists !== null && lists.history !== null && lists.history.length === 0 && lists.pending.length === 0;
  const showBody = lists !== null && lists.history !== null && !empty;
  const agesLoading = ages.done < ages.total;

  const nextAttemptText = (iso: string | null): string => {
    if (iso === null) return msg("validation.noRetry");
    const at = parseIsoUtc(iso);
    return msg("validation.nextAttempt", { time: at === null ? iso : format(at) });
  };

  const systemCell = (row: DailyRow, letter: string) => {
    const cell = row.systems.find((c) => c.system === letter);
    return (
      <td key={letter} className={cell?.pass === false ? "val-num val-bad" : "val-num"}>
        {cell === undefined ? "" : pairText(cell.median, cell.p99, 3)}
      </td>
    );
  };

  return (
    <div className="rpt val" tabIndex={-1}>
      <div className="rpt-toolbar" role="toolbar" aria-label={t("window.validation")}>
        {(["el", "az"] as const).map((m) => (
          <button key={m} type="button" className="btn graph-toggle" aria-pressed={metric === m} onClick={() => setMetric(m)}>
            {t(METRIC_LABELS[m])}
          </button>
        ))}
        <button type="button" className="btn" title={msg("validation.refreshHint")} onClick={refresh}>{t("report.refresh")}</button>
      </div>
      {lists?.historyError != null && <p className="graph-alert" role="alert">{msg("validation.loadFailed", { message: lists.historyError })}</p>}
      {lists?.pendingError != null && <p className="graph-alert" role="alert">{msg("validation.pendingFailed", { message: lists.pendingError })}</p>}
      {chunkFailed && <p className="graph-alert" role="alert">{msg("graph.chunkFailed")}</p>}
      <div className="val-body">
        {lists === null && <p className="rpt-note">{msg("validation.loading")}</p>}
        {empty && <p className="rpt-note">{msg("validation.empty")}</p>}
        {showBody && (
          <>
            <section className="val-section">
              <div className="val-scroll val-daily">
                <table className="val-table" aria-label={t("validation.dailyTable")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("validation.col.day")}</th>
                      <th scope="col">{t("validation.col.scenario")}</th>
                      <th scope="col">{t("validation.col.truth")}</th>
                      {letters.map((l) => (
                        <th key={l} scope="col" className="val-num">{t("validation.col.systemStats", { system: systemName(l), metric: t(METRIC_LABELS[metric]) })}</th>
                      ))}
                      <th scope="col">{t("validation.col.result")}</th>
                      <th scope="col">{t("validation.col.failing")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const open = row.result === "pass" || row.result === "fail";
                      return (
                        <tr
                          key={row.key}
                          className={row.key === selectedKey ? "val-row val-selected" : "val-row"}
                          title={row.result === "gave_up" ? msg("validation.gaveUp") : undefined}
                        >
                          <td>
                            {open ? (
                              <button type="button" className="val-day" aria-pressed={row.key === selectedKey} onClick={() => select(row)}>{row.day}</button>
                            ) : (
                              row.day
                            )}
                          </td>
                          <td>{row.scenario}</td>
                          <td className="val-truth" title={row.truth ?? undefined}>{row.truth ?? ""}</td>
                          {letters.map((l) => systemCell(row, l))}
                          <td className={`val-result val-${row.result}`}>
                            {t(DAY_RESULT_LABELS[row.result])}
                            {row.result === "pending" && <span className="val-next"> {nextAttemptText(row.nextAttempt)}</span>}
                          </td>
                          <td>{row.failing.join(", ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {validated.length === 0 ? (
              <p className="rpt-note">{msg("validation.noResults")}</p>
            ) : (
              <>
                <section className="val-section">
                  {selectedRow === null ? (
                    <p className="rpt-note">{msg("validation.selectDay")}</p>
                  ) : (
                    <>
                      <div className="val-head">
                        <h3 className="val-h">{t("validation.satellitesOf", { scenario: selectedRow.scenario, day: selectedRow.day })}</h3>
                        <label className="val-filter">
                          {t("validation.filter.system")}
                          <select value={system} onChange={(e) => setSystem(e.target.value)} aria-label={t("validation.filter.system")}>
                            <option value="">{t("validation.filter.all")}</option>
                            {(detail?.doc == null ? [] : docSystems(detail.doc)).map((l) => <option key={l} value={l}>{systemName(l)}</option>)}
                          </select>
                        </label>
                        <label className="val-filter">
                          {t("validation.filter.result")}
                          <select value={result} onChange={(e) => setResult(e.target.value)} aria-label={t("validation.filter.result")}>
                            <option value="">{t("validation.filter.all")}</option>
                            {SAT_RESULTS.map((r) => <option key={r} value={r}>{satResultName(r)}</option>)}
                          </select>
                        </label>
                      </div>
                      {detail?.error != null && <p className="graph-alert" role="alert">{detail.error}</p>}
                      {detail !== null && detail.key === selectedRow.key && detail.doc === null && detail.error === null && (
                        <p className="rpt-note">{msg("validation.dayLoading", { scenario: selectedRow.scenario, day: selectedRow.day })}</p>
                      )}
                      {detail?.doc != null && detail.key === selectedRow.key && (
                        <SatTable doc={detail.doc} system={system} result={result} />
                      )}
                    </>
                  )}
                </section>

                <div className="val-charts">
                  <section className="val-section">
                    <h3 className="val-h" title={msg("validation.trendHint")}>{t(metric === "el" ? "validation.trendTitleEl" : "validation.trendTitleAz")}</h3>
                    <div className="val-chartbox">
                      <div ref={setTrendEl} className="val-chart" data-chart="trend" role="img" aria-label={t(metric === "el" ? "validation.trendTitleEl" : "validation.trendTitleAz")} />
                      {trend.series.length === 0 && <p className="rpt-note graph-note">{msg("validation.noTrend")}</p>}
                    </div>
                  </section>
                  <section className="val-section">
                    <h3 className="val-h" title={msg("validation.ageChartHint")}>{t("validation.ageTitle")}</h3>
                    <div className="val-chartbox">
                      <div ref={setAgeEl} className="val-chart" data-chart="age" role="img" aria-label={t("validation.ageTitle")} />
                      {agesLoading && <p className="rpt-note graph-note">{msg("validation.loadingAges", { done: ages.done, total: ages.total })}</p>}
                      {!agesLoading && points.length === 0 && <p className="rpt-note graph-note">{msg("validation.noAge")}</p>}
                    </div>
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** ตารางรายดวงของหนึ่งวัน (ผลที่กรองแล้ว; ไม่เหลือแถว = ข้อความ) */
function SatTable({ doc, system, result }: { doc: ValidationDoc; system: string; result: string }) {
  const sats = useMemo(() => satelliteRows(doc, { system, result }), [doc, system, result]);
  if (Object.keys(doc.satellites).length === 0) return <p className="rpt-note">{msg("validation.noSatellites")}</p>;
  return (
    <div className="val-scroll val-sats">
      <table className="val-table" aria-label={t("validation.satTable")}>
        <thead>
          <tr>
            <th scope="col">{t("validation.col.prn")}</th>
            <th scope="col">{t("validation.col.truth")}</th>
            <th scope="col" className="val-num">{t("validation.col.pairs")}</th>
            <th scope="col" className="val-num">{t("validation.col.elStats")}</th>
            <th scope="col" className="val-num">{t("validation.col.azStats")}</th>
            <th scope="col" className="val-num">{t("validation.col.d3")}</th>
            <th scope="col" className="val-num" title={msg("validation.ageHint")}>{t("validation.col.age")}</th>
            <th scope="col">{t("validation.col.result")}</th>
          </tr>
        </thead>
        <tbody>
          {sats.map((s) => (
            <tr key={s.prn} className="val-row">
              <td>{s.prn}</td>
              <td>{s.truth ?? DASH}</td>
              <td className="val-num">{s.pairs === null ? DASH : s.pairs}</td>
              <td className="val-num">{pairText(s.elMedian, s.elP99, 3)}</td>
              <td className="val-num">{pairText(s.azMedian, s.azP99, 3)}</td>
              <td className="val-num">{pairText(s.d3Median, s.d3Max, 3)}</td>
              <td className="val-num">{fixed(s.ageDays, 2)}</td>
              <td className={`val-result val-${s.result ?? "none"}`}>{satResultName(s.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sats.length === 0 && <p className="rpt-note">{msg("validation.noMatch")}</p>}
    </div>
  );
}

/** ลงทะเบียนหน้า Validation เป็นชนิด validation (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด และ persist/scenarioBound คงตามที่ลงไว้ใน layout/panels.ts ลงซ้ำได้ */
export function registerValidationPanel(): void {
  const base = getPanelDef(VALIDATION_KIND);
  if (base === undefined) throw new Error(`panel kind "${VALIDATION_KIND}" is not registered`);
  registerPanel(VALIDATION_KIND, { ...base, component: Validation });
}
