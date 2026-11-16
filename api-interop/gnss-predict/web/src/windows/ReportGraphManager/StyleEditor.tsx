// หน้าต่างแก้ style (spec §5.1; STK เรียกว่า Properties ของ style): New... / Properties... ของ Report & Graph Manager
// params {style, tier} (Properties) หรือ {kind, objectType} (New...) หนึ่งบานต่อชื่อ style ("new" = style ใหม่)
//
// - Content: ซ้าย Data Providers (provider → group → element ของ Object Type จาก GET /dataproviders) ขวา Report Contents / Graph Contents
//   ปุ่ม Add, Remove, Up, Down (styleForm.ts) หลาย provider ได้ Time ให้เอง (engine รวมแถวตาม Time)
// - Time: Use Object Time Period / Specify Time Properties (Start, Stop ตาม DateFormat ของ scenario), Use default time points / Use step size
// - Summary: Min, Max, Mean, Total, Std Deviation ของ element ที่เลือก (+ Number of Accesses เมื่อมี Access Data) และ Summary Only
// - Graph (style กราฟ): Type (Time XY / Interval / Polar) และแกนของแต่ละ element (Y Axis (Y1) / Y2 Axis (Y2))
// - Dynamic Display/Strip Chart ติ๊กได้เฉพาะ style ที่ canDynamic
// - OK: Save To = My Styles → PUT /styles/{name} (saveMyStyle) หรือ Scenario Styles → useScenario.putDoc แก้ doc.styles (P4)
//   ชื่อตามกฎ P5 และห้ามซ้ำกับ style ในชั้นใด (ไม่สนตัวพิมพ์) ยกเว้นตัวที่กำลังแก้ในชั้นเดิม: ข้อความไทยและ OK ใช้ไม่ได้
//   Installed ล็อก: Properties ของมันเริ่มเป็นสำเนา "<ชื่อ> Copy" ใน My Styles
//   422 STYLE_INVALID = ข้อความใน Message Viewer หน้าต่างยังเปิดอยู่; 412 = กล่อง Reload / Cancel ของทั้งแอป; สำเร็จ = ปิดหน้าต่าง

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ApiError, errorText, isAbortError } from "../../api/client";
import { useTimeFormatter } from "../../chrome/hooks";
import {
  fetchProviders, fetchStyleList, saveMyStyle, type GraphType, type ProviderInfo, type StyleDef, type StyleKind, type StyleObjectType, type StyleTiers,
  type UnusableStyle,
} from "../../data/reports";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { report as notify } from "../../stores/messages";
import { useScenario } from "../../stores/scenario";
import { parseIsoUtc, parseTime } from "../../time/parse";
import { STYLE_EDITOR_KIND, useStyleRevision } from "./commands";
import { moveIndex } from "./ReportGraphManager";
import {
  ACCESS_DATA, activeStats, addColumn, axisOf, canDynamic, columnsOf, copyName, elementsOf, formFromStyle, formProblem, moveColumn, newForm, NUMBER_OF_ACCESSES,
  removeColumn, setAxis, setGraphType, setSummaryOnly, STAT_FUNCTIONS, styleFromForm, TIME, toggleStat, type StatFunction, type StyleForm,
} from "./styleForm";

type Tier = keyof StyleTiers;
type SaveTier = "my" | "scenario";
type Tab = "content" | "time" | "summary" | "graph";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/;
const TIER_LABELS: Record<Tier, LabelKey> = { installed: "rgm.installedStyles", my: "rgm.myStyles", scenario: "rgm.scenarioStyles" };
const STAT_LABELS: Record<StatFunction, LabelKey> = {
  Min: "rgm.statMin", Max: "rgm.statMax", Mean: "rgm.statMean", Total: "rgm.statTotal", "Std Deviation": "rgm.statStdDeviation",
};
const GRAPH_TYPES: readonly [GraphType, LabelKey][] = [["time_xy", "rgm.timeXY"], ["interval", "rgm.interval"], ["polar90", "rgm.polar"]];
const OBJECT_TYPES: readonly StyleObjectType[] = ["Access", "Facility", "Satellite"];

const utcZ = (d: Date): string => d.toISOString().replace(".000Z", "Z");
const isTier = (x: unknown): x is Tier => x === "installed" || x === "my" || x === "scenario";

export interface StyleEditorParams {
  style?: StyleDef;
  tier?: Tier;
  kind?: StyleKind;
  objectType?: StyleObjectType;
}

type StyleList = { tiers: StyleTiers; unusable: UnusableStyle[] };

/** ชื่อทั้งหมดในทุกชั้น (รวมรายการที่ใช้ไม่ได้ที่มีชื่อ) */
const allNames = (list: StyleList): string[] => [
  ...(["installed", "my", "scenario"] as const).flatMap((tier) => list.tiers[tier].map((s) => s.name)),
  ...list.unusable.flatMap((u) => (u.name === null ? [] : [u.name])),
];

/** บันทึกลง Scenario Styles ไม่ได้เพราะ doc ล่าสุดมีชื่อนี้แล้ว (ตรวจใน putDoc กับ doc ที่เพิ่งอ่าน) */
class NameTakenError extends Error {
  constructor(readonly tier: Tier) {
    super("name taken");
  }
}

/** ชั้นที่ใช้ชื่อนี้อยู่แล้ว (ไม่สนตัวพิมพ์) ยกเว้นตัวที่กำลังแก้ (ชื่อเดิมในชั้นเดียวกับที่จะบันทึก) ไม่ชน = null */
export function nameTakenBy(
  name: string, target: SaveTier, original: { tier: Tier; name: string } | null,
  list: { tiers: StyleTiers; unusable: UnusableStyle[] } | null,
): Tier | null {
  if (list === null) return null;
  const wanted = name.toLowerCase();
  const self = (tier: Tier, other: string): boolean => original !== null && original.tier === target && tier === target && other.toLowerCase() === original.name.toLowerCase();
  for (const tier of ["installed", "my", "scenario"] as const) {
    const names = [...list.tiers[tier].map((s) => s.name), ...list.unusable.filter((u) => u.tier === tier).flatMap((u) => (u.name === null ? [] : [u.name]))];
    if (names.some((n) => n.toLowerCase() === wanted && !self(tier, n))) return tier;
  }
  return null;
}

function isoText(iso: string | null | undefined, format: (d: Date) => string): string {
  const d = iso === null || iso === undefined ? null : parseIsoUtc(iso);
  return d === null ? "" : format(d);
}

export function StyleEditor({ params, panelId }: PanelProps) {
  const p = (params ?? {}) as StyleEditorParams;
  const ids = useId();
  const sc = useScenario((s) => s.name);
  const doc = useScenario((s) => s.doc);
  const period = doc?.analysis_period;
  const revision = useStyleRevision((s) => s.revision);
  const formatter = useTimeFormatter();
  const original = p.style !== undefined && isTier(p.tier) && p.tier !== "installed" ? { tier: p.tier, name: p.style.name } : null;
  const locked = p.style !== undefined && p.tier === "installed";

  const [form, setForm] = useState<StyleForm>(() => {
    if (p.style === undefined) return newForm(p.kind === "graph" ? "graph" : "report", OBJECT_TYPES.find((x) => x === p.objectType) ?? "Access");
    const f = formFromStyle(p.style);
    return locked ? { ...f, name: `${p.style.name.slice(0, 43).trimEnd()} Copy` } : f;
  });
  const [saveTier, setSaveTier] = useState<SaveTier>(p.tier === "scenario" ? "scenario" : "my");
  const [tab, setTab] = useState<Tab>("content");
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [list, setList] = useState<StyleList | null>(null);
  /** ผู้ใช้แก้ชื่อเองแล้ว: ไม่ตั้งชื่อสำเนาใหม่ตามรายการ */
  const nameTouched = useRef(false);
  // คีย์บอร์ด: element ของ Data Providers และคอลัมน์ที่รอรับโฟกัสหลังวาดใหม่
  const leafRefs = useRef(new Map<string, HTMLElement>());
  const columnRefs = useRef(new Map<string, HTMLElement>());
  const focusColumn = useRef<string | null>(null);
  const [pick, setPick] = useState<{ provider: string; group: string | null; element: string } | null>(null);
  const [column, setColumn] = useState<number | null>(null);
  const [startEdit, setStartEdit] = useState<string | null>(null);
  const [stopEdit, setStopEdit] = useState<string | null>(null);
  const [stepText, setStepText] = useState(form.time.stepS === null ? "" : String(form.time.stepS));
  const [statElement, setStatElement] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sc === null) return;
    const ctrl = new AbortController();
    fetchProviders(sc, form.objectType, null, { signal: ctrl.signal })
      .then(setProviders)
      .catch((e: unknown) => {
        if (!isAbortError(e) && !ctrl.signal.aborted) setProviders([]);
      });
    return () => ctrl.abort();
  }, [sc, form.objectType]);

  // รายการ style ไว้ตรวจชื่อซ้ำ (P4): อ่านใหม่เมื่อ doc เปลี่ยน (Scenario Styles) และเมื่อ My Styles เปลี่ยน (useStyleRevision) แบบ Manager
  useEffect(() => {
    if (sc === null) return;
    const ctrl = new AbortController();
    fetchStyleList(null, sc, { signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setList(r);
        // Installed ล็อก: สำเนาชื่อที่ยังไม่มีใคร ("AER Copy", "AER Copy 2", ...) จนกว่าผู้ใช้แก้ชื่อเอง
        if (locked && p.style !== undefined && !nameTouched.current) {
          const name = copyName(p.style.name, allNames(r));
          setForm((f) => ({ ...f, name }));
        }
      })
      .catch(() => undefined); // อ่านรายการไม่ได้: ไม่ตรวจชื่อซ้ำฝั่งนี้ (server ยังตอบ 409 ให้ My Styles, putDoc ตรวจ Scenario Styles)
    return () => ctrl.abort();
  }, [sc, doc, revision]);

  useEffect(() => {
    if (focusColumn.current === null) return;
    columnRefs.current.get(focusColumn.current)?.focus();
    focusColumn.current = null;
  });

  const columns = columnsOf(form);
  const elementInfo = useMemo(() => new Map((providers ?? []).flatMap((pr) => pr.elements.map((e) => [e.name, e]))), [providers]);
  const numeric = elementsOf(form).filter((e) => (elementInfo.get(e)?.kind ?? (e.endsWith(TIME) ? "time" : "number")) !== "time");
  const summaryElement = statElement !== null && numeric.includes(statElement) ? statElement : (numeric.includes("Duration") ? "Duration" : numeric[0] ?? null);
  const stats = activeStats(form);
  const style = styleFromForm(form);
  const dynamicOk = canDynamic({ ...style, dynamic: true }, providers ?? undefined);

  // Time: ข้อความที่ยังไม่แก้แสดงตามค่าในฟอร์ม (หรือช่วงวิเคราะห์) ตาม DateFormat ปัจจุบัน
  const startText = startEdit ?? isoText(form.time.start ?? period?.start, formatter.format);
  const stopText = stopEdit ?? isoText(form.time.stop ?? period?.stop, formatter.format);
  const start = parseTime(startText, formatter.fmt, formatter.ltz);
  const stop = parseTime(stopText, formatter.fmt, formatter.ltz);
  const specify = form.time.mode === "specify";
  const startBad = specify && start === null;
  const stopBad = specify && (stop === null || (start !== null && stop.getTime() <= start.getTime()));
  const stepBad = form.time.stepS === null ? false : !(Number.isInteger(form.time.stepS) && form.time.stepS > 0);
  const stepTextBad = stepText.trim() !== "" && !/^\d+$/.test(stepText.trim());

  const nameBad = !NAME_RE.test(form.name);
  const takenBy = nameBad ? null : nameTakenBy(form.name, saveTier, original, list);
  const problem = formProblem(form);
  const noScenario = saveTier === "scenario" && sc === null;
  const okDisabled = saving || nameBad || takenBy !== null || problem !== null || startBad || stopBad || stepBad || stepTextBad || noScenario
    || (form.dynamic && !dynamicOk && providers !== null);

  /** เขียน Start/Stop ที่อ่านได้ลงฟอร์ม (ISO) */
  const setTimeText = (which: "start" | "stop", text: string): void => {
    (which === "start" ? setStartEdit : setStopEdit)(text);
    const d = parseTime(text, formatter.fmt, formatter.ltz);
    if (d !== null) setForm((f) => ({ ...f, time: { ...f.time, [which]: utcZ(d) } }));
  };

  const setMode = (mode: "object_period" | "specify"): void => {
    setForm((f) => {
      if (mode === "object_period") return { ...f, time: { ...f.time, mode } };
      // Specify: เริ่มจากช่วงที่แสดงอยู่ (ช่วงวิเคราะห์ถ้ายังไม่เคยตั้ง)
      return { ...f, time: { ...f.time, mode, start: f.time.start ?? (start === null ? null : utcZ(start)), stop: f.time.stop ?? (stop === null ? null : utcZ(stop)) } };
    });
  };

  const setStep = (text: string): void => {
    setStepText(text);
    const trimmed = text.trim();
    if (/^\d+$/.test(trimmed)) setForm((f) => ({ ...f, time: { ...f.time, stepS: Number(trimmed) } }));
  };

  const setKind = (kind: StyleKind): void => {
    setForm((f) => (f.kind === kind ? f : { ...f, kind, graph: kind === "graph" ? { type: "time_xy", y1: [], y2: [] } : null }));
    if (kind === "report" && tab === "graph") setTab("content");
  };

  const save = async (): Promise<void> => {
    if (okDisabled) return;
    const def = styleFromForm(form);
    setSaving(true);
    setError(null);
    try {
      if (saveTier === "my") {
        await saveMyStyle(def);
        useStyleRevision.getState().bump();
      } else {
        await useScenario.getState().putDoc((fresh) => {
          // ตรวจกับ doc ล่าสุดในคิวการเขียน (อาจมีคนเพิ่ม style ชื่อนี้หลังรายการที่หน้าต่างนี้อ่านไว้) ห้ามทับรายการของผู้อื่น
          const styles: unknown[] = Array.isArray(fresh.styles) ? fresh.styles : [];
          const wanted = def.name.toLowerCase();
          const inPlace = original?.tier === "scenario" && original.name.toLowerCase() === wanted;
          const nameOf = (x: unknown): string | null => {
            const n = (x as { name?: unknown } | null)?.name;
            return typeof n === "string" ? n.toLowerCase() : null;
          };
          if (!inPlace && styles.some((x) => nameOf(x) === wanted)) throw new NameTakenError("scenario");
          const elsewhere = list === null ? null : nameTakenBy(def.name, "scenario", original, { tiers: { ...list.tiers, scenario: [] }, unusable: list.unusable.filter((u) => u.tier !== "scenario") });
          if (elsewhere !== null) throw new NameTakenError(elsewhere);
          // แก้ตัวเดิมชื่อเดิม = แทนที่; ตั้งชื่อใหม่ = เพิ่มตัวใหม่ คงตัวเดิมไว้ (แบบเดียวกับ My Styles)
          fresh.styles = inPlace ? [...styles.filter((x) => nameOf(x) !== wanted), def] : [...styles, def];
        });
      }
      notify("info", "STYLE_SAVED", msg("styleEditor.saved", { name: def.name, tier: t(TIER_LABELS[saveTier]) }));
      useLayout.getState().closePanel(panelId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) return; // กล่อง Reload / Cancel ของทั้งแอป
      if (e instanceof NameTakenError) {
        setError(msg("styleEditor.nameTaken", { name: def.name, tier: t(TIER_LABELS[e.tier]) }));
        return;
      }
      const text = e instanceof ApiError && e.code === "STYLE_INVALID" ? e.text : msg("rgm.saveFailed", { message: errorText(e) });
      notify("error", e instanceof ApiError ? e.code : "STYLE_SAVE", text);
      setError(text);
    } finally {
      setSaving(false);
    }
  };

  // ---------- คีย์บอร์ด ----------
  type Leaf = { provider: string; group: string | null; element: string };
  const leafKey = (l: Leaf): string => JSON.stringify([l.provider, l.group, l.element]);
  const leaves: Leaf[] = (providers ?? []).flatMap((pr) => (pr.groups ?? [null]).flatMap((group) => pr.elements.map((e) => ({ provider: pr.name, group, element: e.name }))));
  const leafTab = pick !== null && leaves.some((l) => leafKey(l) === leafKey(pick)) ? leafKey(pick) : (leaves[0] === undefined ? null : leafKey(leaves[0]));
  const columnKey = (i: number): string => {
    const c = columns[i];
    return c === undefined ? "" : `${c.entry}:${c.element}`;
  };
  const columnTab = column !== null && column < columns.length ? column : 0;

  /** element ของ Data Providers: ลูกศร / Home / End เลือกและย้ายโฟกัส, Space = เลือก, Enter = Add */
  const onLeafKeyDown = (e: ReactKeyboardEvent, leaf: Leaf): void => {
    const to = moveIndex(e.key, leaves.findIndex((l) => leafKey(l) === leafKey(leaf)), leaves.length);
    if (to !== null) {
      e.preventDefault();
      setPick(leaves[to]);
      leafRefs.current.get(leafKey(leaves[to]))?.focus();
    } else if (e.key === " ") {
      e.preventDefault();
      setPick(leaf);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setPick(leaf);
      setForm((f) => addColumn(f, leaf, providers ?? []));
    }
  };

  /** ย้ายคอลัมน์ i ขึ้น/ลงในกลุ่มเดียวกัน (ปุ่ม Up / Down และ Alt+ลูกศร) โฟกัสตามคอลัมน์ที่ย้าย */
  const moveSelected = (i: number, dir: -1 | 1): void => {
    const next = moveColumn(form, i, dir);
    if (next === form) return;
    setForm(next);
    setColumn(i + dir);
  };

  /** Report/Graph Contents: ลูกศร / Home / End เลือกและย้ายโฟกัส, Alt+ลูกศรขึ้น/ลง = Up / Down, Delete = Remove */
  const onColumnKeyDown = (e: ReactKeyboardEvent, i: number): void => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      focusColumn.current = columnKey(i);
      moveSelected(i, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    const to = moveIndex(e.key, i, columns.length);
    if (to !== null) {
      e.preventDefault();
      setColumn(to);
      columnRefs.current.get(columnKey(to))?.focus();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setColumn(i);
    } else if (e.key === "Delete") {
      e.preventDefault();
      setForm((f) => removeColumn(f, i));
      setColumn(null);
    }
  };

  const tabs: [Tab, LabelKey][] = [["content", "rgm.content"], ["time", "rgm.time"], ["summary", "rgm.summary"], ...(form.kind === "graph" ? [["graph", "rgm.graph"] as [Tab, LabelKey]] : [])];
  const contentsLabel = form.kind === "graph" ? t("rgm.graphContents") : t("rgm.reportContents");
  const hasAccessData = form.content.some((c) => c.provider === ACCESS_DATA);

  return (
    <div className="rgm style-editor">
      <div className="rgm-top">
        <label htmlFor={`${ids}-name`}>{t("field.name")}</label>
        <input
          id={`${ids}-name`}
          className={nameBad || takenBy !== null ? "field field-invalid" : "field"}
          aria-invalid={nameBad || takenBy !== null ? true : undefined}
          value={form.name}
          onChange={(e) => {
            nameTouched.current = true;
            setError(null);
            setForm((f) => ({ ...f, name: e.target.value }));
          }}
        />
        <span>{t(TYPE_LABEL[form.objectType])}</span>
        {p.style === undefined ? (
          <span role="radiogroup" aria-label={t("rgm.styleType")} className="rgm-inline">
            <label className="access-choice">
              <input type="radio" name={`${ids}-kind`} checked={form.kind === "report"} onChange={() => setKind("report")} />
              {t("rgm.kindReport")}
            </label>
            <label className="access-choice">
              <input type="radio" name={`${ids}-kind`} checked={form.kind === "graph"} onChange={() => setKind("graph")} />
              {t("rgm.kindGraph")}
            </label>
          </span>
        ) : (
          <span>{t(form.kind === "report" ? "rgm.kindReport" : "rgm.kindGraph")}</span>
        )}
      </div>
      {nameBad && form.name !== "" && <p className="form-error">{msg("styleEditor.nameInvalid")}</p>}
      {takenBy !== null && <p className="form-error">{msg("styleEditor.nameTaken", { name: form.name, tier: t(TIER_LABELS[takenBy]) })}</p>}
      {locked && <p className="props-note">{msg("styleEditor.installedCopy")}</p>}

      <div role="tablist" className="rgm-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "btn rgm-tab rgm-selected" : "btn rgm-tab"} onClick={() => setTab(id)}>
            {t(label)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="rgm-tabpanel">
        {tab === "content" && (
          <div className="rgm-main">
            <fieldset className="props-group rgm-objects">
              <legend id={`${ids}-dp`}>{t("rgm.dataProviders")}</legend>
              <div className="rgm-list" role="tree" aria-labelledby={`${ids}-dp`}>
                {(providers ?? []).map((pr) => (
                  <div key={pr.name} role="treeitem" aria-expanded="true" aria-selected={false} aria-label={pr.name + (pr.ours ? t("ob.oursMark") : "")}>
                    <div className="rgm-tier">{pr.name}{pr.ours ? t("ob.oursMark") : ""}</div>
                    <div role="group">
                      {(pr.groups ?? [null]).map((group) => {
                        const leaves = pr.elements.map((e) => {
                          const on = pick !== null && pick.provider === pr.name && pick.group === group && pick.element === e.name;
                          return (
                            <div
                              key={`${group}:${e.name}`}
                              ref={(el) => {
                                const k = leafKey({ provider: pr.name, group, element: e.name });
                                if (el === null) leafRefs.current.delete(k);
                                else leafRefs.current.set(k, el);
                              }}
                              role="treeitem"
                              tabIndex={leafTab === leafKey({ provider: pr.name, group, element: e.name }) ? 0 : -1}
                              onKeyDown={(ev) => onLeafKeyDown(ev, { provider: pr.name, group, element: e.name })}
                              aria-selected={on}
                              className={on ? "rgm-item rgm-leaf rgm-selected" : "rgm-item rgm-leaf"}
                              onClick={() => setPick({ provider: pr.name, group, element: e.name })}
                              onDoubleClick={() => setForm((f) => addColumn(f, { provider: pr.name, group, element: e.name }, providers ?? []))}
                            >
                              {e.name}
                            </div>
                          );
                        });
                        return group === null ? leaves : (
                          <div key={group} role="treeitem" aria-expanded="true" aria-selected={false} aria-label={group}>
                            <div className="rgm-tier rgm-group">{group}</div>
                            <div role="group">{leaves}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {providers !== null && providers.length === 0 && <p className="props-note">{msg("styleEditor.noProviders")}</p>}
            </fieldset>
            <div className="access-buttons">
              <button type="button" className="btn" disabled={pick === null} onClick={() => pick !== null && setForm((f) => addColumn(f, pick, providers ?? []))}>{t("rgm.add")}</button>
              <button type="button" className="btn" disabled={column === null} onClick={() => { if (column !== null) { setForm((f) => removeColumn(f, column)); setColumn(null); } }}>{t("rgm.remove")}</button>
              <button type="button" className="btn" disabled={column === null || column === 0} onClick={() => column !== null && moveSelected(column, -1)}>{t("rgm.up")}</button>
              <button type="button" className="btn" disabled={column === null || column >= columns.length - 1} onClick={() => column !== null && moveSelected(column, 1)}>{t("rgm.down")}</button>
            </div>
            <fieldset className="props-group rgm-objects">
              <legend id={`${ids}-cols`}>{contentsLabel}</legend>
              <div className="rgm-list" role="listbox" aria-labelledby={`${ids}-cols`}>
                {columns.map((c, i) => (
                  <div
                    key={`${c.entry}:${c.element}`}
                    ref={(el) => {
                      if (el === null) columnRefs.current.delete(`${c.entry}:${c.element}`);
                      else columnRefs.current.set(`${c.entry}:${c.element}`, el);
                    }}
                    role="option"
                    tabIndex={columnTab === i ? 0 : -1}
                    onKeyDown={(ev) => onColumnKeyDown(ev, i)}
                    aria-selected={column === i}
                    title={c.group === null ? c.provider : `${c.provider} / ${c.group}`}
                    className={column === i ? "rgm-item rgm-selected" : "rgm-item"}
                    onClick={() => setColumn(i)}
                  >
                    {c.element}
                  </div>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {tab === "time" && (
          <div className="rgm-stack">
            <label className="access-choice">
              <input type="radio" name={`${ids}-mode`} checked={!specify} onChange={() => setMode("object_period")} />
              {t("access.useObjectTimePeriod")}
            </label>
            <label className="access-choice">
              <input type="radio" name={`${ids}-mode`} checked={specify} onChange={() => setMode("specify")} />
              {t("rgm.specifyTimeProperties")}
            </label>
            <div className="access-times">
              <label htmlFor={`${ids}-start`}>{t("field.analysisStart")}</label>
              <input id={`${ids}-start`} className={startBad ? "field field-time field-invalid" : "field field-time"} aria-invalid={startBad ? true : undefined}
                disabled={!specify} value={startText} onChange={(e) => setTimeText("start", e.target.value)} />
              <label htmlFor={`${ids}-stop`}>{t("field.analysisStop")}</label>
              <input id={`${ids}-stop`} className={stopBad ? "field field-time field-invalid" : "field field-time"} aria-invalid={stopBad ? true : undefined}
                disabled={!specify} value={stopText} onChange={(e) => setTimeText("stop", e.target.value)} />
            </div>
            {(startBad || stopBad) && <p className="form-error">{msg("rgm.timeInvalid", { example: isoText(period?.start, formatter.format) })}</p>}
            <label className="access-choice">
              <input type="radio" name={`${ids}-step`} checked={form.time.stepS === null} onChange={() => setForm((f) => ({ ...f, time: { ...f.time, stepS: null } }))} />
              {t("rgm.useDefaultTimePoints")}
            </label>
            <label className="access-choice">
              <input type="radio" name={`${ids}-step`} checked={form.time.stepS !== null} onChange={() => setStep(stepText.trim() === "" ? "60" : stepText)} />
              {t("rgm.useStepSize")}
            </label>
            <div className="access-choice">
              <label htmlFor={`${ids}-stepS`}>{t("rgm.step")}</label>
              <input id={`${ids}-stepS`} className={stepBad || stepTextBad ? "field rgm-step field-invalid" : "field rgm-step"} inputMode="numeric"
                aria-invalid={stepBad || stepTextBad ? true : undefined} disabled={form.time.stepS === null} value={stepText} onChange={(e) => setStep(e.target.value)} />
              <span>{t("rgm.seconds")}</span>
            </div>
            {(stepBad || stepTextBad) && <p className="form-error">{msg("rgm.stepInvalid")}</p>}
          </div>
        )}

        {tab === "summary" && (
          <div className="rgm-stack">
            <div className="access-choice">
              <label htmlFor={`${ids}-stat`}>{t("rgm.statElement")}</label>
              <select id={`${ids}-stat`} className="field" value={summaryElement ?? ""} disabled={numeric.length === 0} onChange={(e) => setStatElement(e.target.value)}>
                {numeric.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            {STAT_FUNCTIONS.map((fn) => {
              const stat = summaryElement === null ? null : `${fn} ${summaryElement}`;
              return (
                <label key={fn} className="access-choice">
                  <input type="checkbox" disabled={stat === null} checked={stat !== null && stats.includes(stat)} onChange={(e) => stat !== null && setForm((f) => toggleStat(f, stat, e.target.checked))} />
                  {t(STAT_LABELS[fn])}
                </label>
              );
            })}
            {hasAccessData && (
              <label className="access-choice">
                <input type="checkbox" checked={stats.includes(NUMBER_OF_ACCESSES)} onChange={(e) => setForm((f) => toggleStat(f, NUMBER_OF_ACCESSES, e.target.checked))} />
                {t("rgm.numberOfAccesses")}
              </label>
            )}
            <label className="access-choice">
              <input type="checkbox" checked={form.summary.summaryOnly} onChange={(e) => setForm((f) => setSummaryOnly(f, e.target.checked))} />
              {t("rgm.summaryOnly")}
            </label>
          </div>
        )}

        {tab === "graph" && form.graph !== null && (
          <div className="rgm-stack">
            <div className="access-choice">
              <label htmlFor={`${ids}-gtype`}>{t("rgm.graphType")}</label>
              <select id={`${ids}-gtype`} className="field" value={form.graph.type} onChange={(e) => setForm((f) => setGraphType(f, e.target.value as GraphType))}>
                {GRAPH_TYPES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </div>
            {form.graph.type === "time_xy" && numeric.map((e) => (
              <div key={e} className="access-choice">
                <label htmlFor={`${ids}-axis-${e}`}>{e}</label>
                <select id={`${ids}-axis-${e}`} className="field" value={axisOf(form, e) ?? ""} onChange={(ev) => setForm((f) => setAxis(f, e, ev.target.value === "" ? null : (ev.target.value as "y1" | "y2")))}>
                  <option value="">{t("rgm.axisNone")}</option>
                  <option value="y1">{t("rgm.yAxis1")}</option>
                  <option value="y2">{t("rgm.yAxis2")}</option>
                </select>
              </div>
            ))}
            {form.graph.type === "time_xy" && (
              <label className="access-choice">
                <input type="checkbox" checked={form.graph.stack === true} onChange={(e) => setForm((f) => (f.graph === null ? f : { ...f, graph: { ...f.graph, stack: e.target.checked } }))} />
                {t("rgm.stack")}
              </label>
            )}
          </div>
        )}
      </div>

      <label className="access-choice" title={dynamicOk ? undefined : msg("styleEditor.dynamicUnsupported")}>
        <input type="checkbox" checked={form.dynamic} disabled={!dynamicOk && !form.dynamic} onChange={(e) => setForm((f) => ({ ...f, dynamic: e.target.checked }))} />
        {t("rgm.dynamicDisplay")}
      </label>
      {form.dynamic && !dynamicOk && providers !== null && <p className="form-error">{msg("styleEditor.dynamicUnsupported")}</p>}
      {problem !== null && <p className="form-error">{problem}</p>}
      {noScenario && <p className="form-error">{msg("styleEditor.noScenario")}</p>}
      {error !== null && (takenBy === null || error !== msg("styleEditor.nameTaken", { name: form.name, tier: t(TIER_LABELS[takenBy]) })) && (
        <p className="form-error" role="alert">{error}</p>
      )}

      <div className="rgm-bottom">
        <fieldset className="props-group rgm-as">
          <legend>{t("rgm.saveTo")}</legend>
          <label className="access-choice">
            <input type="radio" name={`${ids}-tier`} checked={saveTier === "my"} onChange={() => setSaveTier("my")} />
            {t("rgm.myStyles")}
          </label>
          <label className="access-choice">
            <input type="radio" name={`${ids}-tier`} checked={saveTier === "scenario"} onChange={() => setSaveTier("scenario")} />
            {t("rgm.scenarioStyles")}
          </label>
        </fieldset>
        <div className="rgm-buttons">
          <button type="button" className="btn" disabled={okDisabled} onClick={() => void save()}>{t("dialog.ok")}</button>
          <button type="button" className="btn" onClick={() => useLayout.getState().closePanel(panelId)}>{t("dialog.cancel")}</button>
        </div>
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<StyleObjectType, LabelKey> = { Access: "rgm.typeAccess", Facility: "ob.class.facility", Satellite: "ob.class.satellite" };

export function registerStyleEditorPanel(): void {
  const base = getPanelDef(STYLE_EDITOR_KIND);
  if (base === undefined) throw new Error(`panel kind "${STYLE_EDITOR_KIND}" is not registered`);
  registerPanel(STYLE_EDITOR_KIND, { ...base, component: StyleEditor });
}
