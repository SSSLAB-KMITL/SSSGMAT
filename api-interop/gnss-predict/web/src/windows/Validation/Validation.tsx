// หน้า Validation (spec §7, เพิ่มเอง): ประวัติการตรวจ predicted.sp3 เทียบ SP3 จริง เปิดจาก Analysis → Validation... เป็นหน้าต่าง Integrated บานเดียว
//
// - ตารางรายวัน: ประวัติ (`GET /validation/history`) รวมกับวันที่ยังไม่มีผล (`GET /validation/pending`) เรียงวันใหม่สุดก่อน; ΔEl ค่ากลาง/P99 ต่อระบบ สลับเป็น ΔAz ได้;
//   Result = Pass / Fail / Pending (พร้อมเวลาที่จะลองครั้งถัดไป ตาม DateFormat ของ scenario ที่เปิดอยู่ ไม่มี = UTCG) / Gave up (rows.ts)
//   คอลัมน์เรียง Day, Scenario, Result, Failing แล้วจึง Truth กับคอลัมน์ระบบ: บนหน้าต่างแคบ (หลายระบบ) ผลตัดสินและเวลาลองครั้งถัดไปยังอยู่ในจอ
//   ระบบที่ไม่ผ่านมี ✗ กับข้อความซ่อนสำหรับโปรแกรมอ่านจอ (ไม่ใช้สีอย่างเดียว) วัน Gave up มีข้อความสั้นให้เห็นในช่อง Result
// - ตารางรายวันเป็นหน้าต่างเดียวที่ใช้คีย์บอร์ดได้แบบเดียวกับ Satellite Catalog: role="grid" แถวเป็นจุดหยุดเดียว (roving tabindex) ลูกศรขึ้นลง Home End เลื่อนโฟกัส
//   Enter / Space หรือคลิกที่ใดก็ได้ในแถวของวันที่ตรวจแล้ว (Pass / Fail) = ตารางรายดวง (`GET /validation/{sc}/{day}`) กรองตามระบบและผลได้
//   (aria-current ที่แถวของวันที่เปิดอยู่) วัน Pending / Gave up เข้าถึงได้แต่เปิดไม่ได้และไม่ไฮไลต์ตอนชี้; พื้นที่เลื่อนของทั้งสองตารางโฟกัสได้ (region)
// - กราฟแนวโน้ม P99 ต่อระบบพร้อมเส้นเกณฑ์ (0.2° / 0.5°) และกราฟอายุข้อมูลกับระยะคลาด 3 มิติ: ECharts จาก loadECharts (windows/Graph/chart.ts) เท่านั้น
//   กราฟอายุต้องใช้ผลรายดวงของวันที่ตรวจแล้วใหม่สุดไม่เกิน AGE_DAYS_LIMIT (180) วัน: ดึงด้วยกลุ่มคำขอที่เลื่อนต่อเนื่อง AGE_POOL (8) คำขอพร้อมกัน
//   ที่เก็บผลรายวัน (promise ต่อวัน + created_utc ของบรรทัดประวัติ) ใช้ร่วมกับตารางรายดวงจึงไม่ดึงวันเดียวกันซ้ำ; วันที่อ่านไม่ได้ถูกจำไว้ตลอดที่หน้าต่างเปิดอยู่
//   (ตัวโหลดของกราฟไม่ถามซ้ำ Refresh ล้างความจำนี้ การคลิกวันนั้นเองลองใหม่เสมอ) ตรวจซ้ำแล้ว created_utc เปลี่ยน = ดึงใหม่
//   ปิดหน้าต่าง = ยกเลิกคำขอที่ค้างและไม่ส่งคำขอใหม่; กราฟอายุวาดใหม่ไม่เกินทุก AGE_FLUSH_MS แล้วอีกครั้งตอนจบ และไม่ล้างจุดเดิมตอนโหลดใหม่จนกว่าจุดใหม่จะมา
//   ใต้หัวกราฟอายุมีข้อความสรุป (จำนวนดวง จำนวนวัน ค่ากลางของอายุ) และจำนวนวันสูงสุดที่อ่าน
// - งานตรวจ (job validate) ที่จบลง (สำเร็จ ล้มเหลว หรือถูกยกเลิก) ทำให้โหลดสองรายการใหม่เอง (วัน Pending กลายเป็นผล หรือเวลาลองครั้งถัดไปเปลี่ยน); Refresh โหลดเอง
// - ไม่ผูกกับ scenario: ใช้ได้โดยไม่เปิด scenario ไม่เรียก POST /validate หรือ /daily/run (หน้านี้อ่านอย่างเดียว)
// - chunk ของ ECharts โหลดไม่ได้ = ข้อความไทย role="alert" (ตารางยังใช้ได้) Refresh ลองโหลดใหม่ ปิดหน้าต่าง = dispose ทั้งสองกราฟ

import type { EChartsType } from "echarts";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { apiGet, errorText, isAbortError } from "../../api/client";
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
  AGE_DAYS_LIMIT, ageScatter, ageSummary, dailyRows, docSystems, fixed, pairText, parseDay, parseHistory, parsePending, satelliteRows, shownResult, systemLetters,
  trendSeries, type DailyRow, type DayResult, type HistoryRecord, type Metric, type PendingDay, type ValidationDoc,
} from "./rows";

/** คำขอผลรายวันที่ค้างพร้อมกันได้ไม่เกินนี้ (กราฟอายุ) */
const AGE_POOL = 8;
/** กราฟอายุวาดใหม่ระหว่างโหลดไม่บ่อยกว่านี้ (ms) แล้ววาดอีกครั้งตอนจบ */
const AGE_FLUSH_MS = 250;
const DASH = "—";

const SYSTEM_LABELS: Record<string, LabelKey> = {
  G: "option.system.gps", R: "option.system.glonass", E: "option.system.galileo", C: "option.system.beidou",
};
/** ชื่อที่แสดงของระบบจากอักษรนำ (G -> GPS) อักษรที่ไม่รู้จักแสดงตามที่เป็น */
const systemName = (letter: string): string => (Object.hasOwn(SYSTEM_LABELS, letter) ? t(SYSTEM_LABELS[letter]) : letter);

const DAY_RESULT_LABELS: Record<DayResult, LabelKey> = {
  pass: "validation.result.pass", fail: "validation.result.fail", pending: "validation.result.pending", gave_up: "validation.result.gaveUp",
  undecided: "validation.result.undecided", no_gnss: "validation.result.noGnss",
};
const SAT_RESULT_LABELS: Record<string, LabelKey> = {
  pass: "validation.result.pass", fail: "validation.result.fail",
  insufficient_data: "validation.result.insufficientData", unverified: "validation.result.unverified",
};
/** ค่าของตัวกรองผลรายดวงตามลำดับที่แสดง */
const SAT_RESULTS = ["pass", "fail", "insufficient_data", "unverified"] as const;
/** วันที่ตรวจแล้ว (มีไฟล์ผลรายดวงให้เปิด): ทุกแถวจาก history (Pass, Fail, Undecided ; ข2) ไม่ใช่ Pending / Gave up */
const opensDetail = (row: DailyRow): boolean => row.result !== "pending" && row.result !== "gave_up";
/** ผลรายวันที่ไม่มีดาวเลย (แทนเอกสารจริงของวันที่จำไว้ใน emptyDays) */
const EMPTY_DAY: ValidationDoc = { day: "", satellites: {} };
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
  loading: boolean;
}

/** กุญแจที่เก็บของผลรายวัน: ตรวจซ้ำแล้ว created_utc เปลี่ยน = กุญแจใหม่ */
const docKey = (row: DailyRow): string => `${row.key}@${row.created ?? ""}`;

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
  /** docKey ของวัน Undecided ที่ผลรายวันโหลดแล้วมี satellites ว่าง (แสดงเป็น No GNSS) */
  const [emptyDays, setEmptyDays] = useState<ReadonlySet<string>>(() => new Set());
  /** วันที่ดึงแล้วล้ม (กุญแจ docKey) ตัวโหลดของกราฟข้ามวันเหล่านี้ตลอดที่หน้าต่างเปิดอยู่; Refresh ล้างทิ้ง; การคลิกวันนั้นเองลองใหม่เสมอ */
  const failed = useRef(new Set<string>());
  /** ตัวยกเลิกของหน้าต่างนี้ทั้งหน้า: ปิดหน้าต่าง = ยกเลิกคำขอผลรายวันที่ค้างทั้งหมด (ต้องประกาศก่อน effect อื่นที่เรียก loadDoc) */
  const mountAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const cache = docs.current;
    const bad = failed.current;
    mountAbort.current = ac;
    return () => {
      ac.abort();
      cache.clear(); // ล้างทันที: StrictMode ผูก effect ใหม่ต่อจากนี้เลย ต้องไม่ได้ promise ที่กำลังถูกยกเลิกกลับไป
      bad.clear();
    };
  }, []);
  const loadDoc = useCallback((row: DailyRow, retry = false): Promise<ValidationDoc> => {
    const key = docKey(row);
    if (retry) failed.current.delete(key);
    let found = docs.current.get(key);
    if (found === undefined) {
      const p = apiGet<unknown>(`/validation/${encodeURIComponent(row.scenario)}/${row.day}`, { signal: mountAbort.current?.signal }).then((r) => {
        const doc = parseDay(r.data);
        if (doc === null) throw new Error(msg("validation.dayInvalid"));
        // ข2: วัน Undecided ที่ผลรายวันไม่มีดาวเลย = No GNSS (shownResult) จำเฉพาะวันแบบนี้ ตารางจึงไม่วาดใหม่ทุกครั้งที่กราฟอายุโหลดวันอื่น
        if (row.result === "undecided" && Object.keys(doc.satellites).length === 0) setEmptyDays((prev) => new Set(prev).add(key));
        return doc;
      });
      p.catch((e: unknown) => {
        if (docs.current.get(key) !== p) return; // ล้างไปแล้ว (ปิดหน้าต่าง) ไม่ต้องจำอะไร
        docs.current.delete(key);
        if (!isAbortError(e)) failed.current.add(key);
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
  /** คลิกวันที่เลือกอยู่แล้วหลังโหลดล้ม = ลองใหม่ (เพิ่มตัวนับนี้) */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (selectedRow === null) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail({ key: selectedRow.key, doc: null, error: null });
    loadDoc(selectedRow, true).then(
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
  }, [selectedRow, loadDoc, attempt]);

  const select = (row: DailyRow): void => {
    if (row.key === selectedKey) {
      if (detail?.error != null) setAttempt((n) => n + 1);
      return;
    }
    setSelectedKey(row.key);
    setSystem("");
    setResult("");
  };
  /** คลิกหรือ Enter / Space: เปิดเฉพาะวันที่ตรวจแล้ว (Pending / Gave up ไม่มีผลให้เปิด) */
  const openRow = (row: DailyRow): void => {
    if (opensDetail(row)) select(row);
  };

  // ---------- คีย์บอร์ดของตารางรายวัน (roving tabindex แบบเดียวกับ Satellite Catalog) ----------
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const tabbableKey =
    rows.find((r) => r.key === focusedKey)?.key ?? rows.find((r) => r.key === selectedKey)?.key ?? rows[0]?.key ?? null;
  const focusRow = (index: number): void => {
    const target = rows[Math.min(rows.length - 1, Math.max(0, index))];
    if (target !== undefined) rowRefs.current.get(target.key)?.focus();
  };
  const onRowKeyDown = (e: KeyboardEvent, index: number): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusRow(index + 1); break;
      case "ArrowUp": e.preventDefault(); focusRow(index - 1); break;
      case "Home": e.preventDefault(); focusRow(0); break;
      case "End": e.preventDefault(); focusRow(rows.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); openRow(rows[index]); break;
    }
  };

  const [ages, setAges] = useState<Ages>({ docs: [], done: 0, total: 0, loading: false });
  useEffect(() => {
    let alive = true;
    const list = validated.slice(0, AGE_DAYS_LIMIT); // validated เรียงวันใหม่สุดก่อน
    const total = list.length;
    if (total === 0) {
      setAges({ docs: [], done: 0, total: 0, loading: false });
      return;
    }
    // จุดเดิมคงอยู่จนกว่าการวาดครั้งแรกของรอบนี้ (ไม่กระพริบเป็นกราฟว่างตอนโหลดใหม่)
    setAges((prev) => ({ ...prev, done: 0, total, loading: true }));
    const got: ValidationDoc[] = [];
    let done = 0;
    let next = 0;
    let lastFlush = Date.now();
    const flush = (): void => {
      lastFlush = Date.now();
      setAges({ docs: [...got], done, total, loading: done < total });
    };
    const finish = (doc: ValidationDoc | null): void => {
      done++;
      if (doc !== null) got.push(doc);
      if (done === total || Date.now() - lastFlush >= AGE_FLUSH_MS) flush();
    };
    // กลุ่มคำขอเลื่อนต่อเนื่อง: ตัวทำงาน AGE_POOL ตัวหยิบวันถัดไปทันทีที่ตัวเองเสร็จ ไม่รอทั้งกลุ่ม
    const worker = async (): Promise<void> => {
      for (;;) {
        if (!alive || next >= total) return;
        const row = list[next++];
        if (failed.current.has(docKey(row))) {
          finish(null);
          continue;
        }
        let doc: ValidationDoc | null = null;
        try {
          doc = await loadDoc(row);
        } catch {
          doc = null; // อ่านไม่ได้: ข้าม (loadDoc จำไว้แล้ว ตารางรายดวงของวันนั้นแจ้งเองเมื่อคลิก)
        }
        if (!alive) return;
        finish(doc);
      }
    };
    for (let i = 0; i < Math.min(AGE_POOL, total); i++) void worker();
    return () => {
      alive = false;
    };
  }, [validated, loadDoc]);
  const points = useMemo(() => ageScatter(ages.docs), [ages.docs]);
  const ageSum = useMemo(() => ageSummary(ages.docs), [ages.docs]);
  const ageSubtitle = [
    ageSum.points === 0 ? null : t("validation.ageSummary", { points: ageSum.points, days: ageSum.days, age: fixed(ageSum.medianAge, 2) }),
    validated.length > AGE_DAYS_LIMIT ? t("validation.ageLimited", { n: AGE_DAYS_LIMIT, total: validated.length }) : t("validation.ageLimit", { n: AGE_DAYS_LIMIT }),
  ].filter((x): x is string => x !== null).join(" · ");

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
  const ctx = useMemo<ChartCtx>(() => ({
    theme: readGraphTheme(), systemName, xName: t("validation.ageX"), yName: t("validation.ageY"),
    pointText: (age, d3Km) => t("validation.agePoint", { age: age.toFixed(2), d3: d3Km.toFixed(3) }),
  }), []);
  useEffect(() => {
    if (trendChart !== null) trendChart.setOption(trendOption(trend, ctx), { notMerge: true });
  }, [trendChart, trend, ctx]);
  useEffect(() => {
    if (ageChart !== null) ageChart.setOption(ageOption(points, ctx), { notMerge: true });
  }, [ageChart, points, ctx]);

  const refresh = (): void => {
    if (chunkFailed) setChunkAttempt((a) => a + 1);
    failed.current.clear(); // วันที่ล้มไว้ถูกถามใหม่ (กราฟอายุ)
    setReload((n) => n + 1);
  };

  // ---------- วาด ----------
  const empty = lists !== null && lists.history !== null && lists.history.length === 0 && lists.pending.length === 0;
  const showBody = lists !== null && lists.history !== null && !empty;
  const agesLoading = ages.loading;

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
        {cell?.pass === false && (
          <>
            <span aria-hidden="true"> ✗</span>
            <span className="sr-only"> {t("validation.failed")}</span>
          </>
        )}
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
              <div className="val-scroll val-daily" role="region" tabIndex={0} aria-label={t("validation.dailyTable")}>
                <table className="val-table" role="grid" aria-label={t("validation.dailyTable")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("validation.col.day")}</th>
                      <th scope="col">{t("validation.col.scenario")}</th>
                      <th scope="col">{t("validation.col.result")}</th>
                      <th scope="col">{t("validation.col.failing")}</th>
                      <th scope="col">{t("validation.col.truth")}</th>
                      {letters.map((l) => (
                        <th key={l} scope="col" className="val-num">{t("validation.col.systemStats", { system: systemName(l), metric: t(METRIC_LABELS[metric]) })}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const open = opensDetail(row);
                      const shown = shownResult(row, emptyDays.has(docKey(row)) ? EMPTY_DAY : null);
                      return (
                        <tr
                          key={row.key}
                          ref={(el) => {
                            if (el === null) rowRefs.current.delete(row.key);
                            else rowRefs.current.set(row.key, el);
                          }}
                          className={`val-row${open ? " val-open" : ""}${row.key === selectedKey ? " val-selected" : ""}`}
                          aria-current={row.key === selectedKey ? "true" : undefined}
                          title={row.result === "gave_up" ? msg("validation.gaveUp") : undefined}
                          tabIndex={row.key === tabbableKey ? 0 : -1}
                          onClick={() => openRow(row)}
                          onFocus={() => setFocusedKey(row.key)}
                          onKeyDown={(e) => onRowKeyDown(e, index)}
                        >
                          <td>{row.day}</td>
                          <td>{row.scenario}</td>
                          <td className={`val-result val-${shown}`}>
                            {t(DAY_RESULT_LABELS[shown])}
                            {row.result === "pending" && <span className="val-next"> {nextAttemptText(row.nextAttempt)}</span>}
                            {row.result === "gave_up" && <span className="val-next"> {msg("validation.gaveUpShort")}</span>}
                            {shown === "undecided" && <span className="val-next"> {msg("validation.undecided")}</span>}
                            {shown === "no_gnss" && <span className="val-next"> {msg("validation.noGnss")}</span>}
                          </td>
                          <td>{row.failing.join(", ")}</td>
                          <td className="val-truth" title={row.truth ?? undefined}>{row.truth ?? ""}</td>
                          {letters.map((l) => systemCell(row, l))}
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
                    <p className="val-sub">{ageSubtitle}</p>
                    <div className="val-chartbox">
                      <div ref={setAgeEl} className="val-chart" data-chart="age" role="img" aria-label={`${t("validation.ageTitle")}. ${ageSubtitle}`} />
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
    <div className="val-scroll val-sats" role="region" tabIndex={0} aria-label={t("validation.satTable")}>
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
            <tr key={s.prn}>
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
