// หน้าต่าง Access tool (spec §4, STK ref §F): หน้าต่างลอยบานเดียว params {from} = path ของ Access For (Facility หรือ Satellite)
//
// - Associated Objects: ต้นไม้จาก state.ts ติ๊กได้ทั้งกลุ่มและรายดวง ตัวหนา = access ที่ computed และผลของ Facility current
//   คลิกขวา: Select All; เปลี่ยน Access For = ล้างที่ติ๊ก
//   คีย์บอร์ดแบบรายการของ Report & Graph Manager (roving tabindex): ทั้งรายการเป็นจุดหยุด Tab เดียว ลูกศรขึ้นลง / Home / End ย้าย Space ติ๊ก
// - Compute / Clear / Clear All / Remove / Remove All: POST /access/compute|clear|remove พร้อม If-Match (server §6.6)
//   Access For เป็นดาว = หนึ่งคำขอต่อ Facility ทุกคำขอผ่าน postAccess (api/access.ts: คิวการเขียนของ useScenario, ETag ต่อกัน,
//   ดึง doc ใหม่ครั้งเดียวหลังเขียน) ปุ่มปลดเมื่อทั้งหมดเสร็จ
//   202 = job analyze (recordQueuedJob) ปุ่มทั้งชุดเป็นสีเทาระหว่างที่มี job ใดของ scenario นี้รอหรือรันอยู่ (แถบสถานะแสดงความคืบหน้า)
//   Clear / Remove ที่ไม่มีรายการตรง (n = 0) = ข้อความ info ไม่ใช่ error (P8)
//   412 = กล่อง Reload / Cancel ของทั้งแอป (useScenario.conflict) ไม่ลง Message Viewer; ข้อผิดพลาดอื่น = Message Viewer
// - Time Period: Use Object Time Period ({mode: "object"}) / Specify Time Period (Start, Stop ตาม DateFormat ของ scenario) อ่านไม่ได้หรือ
//   Stop ไม่หลัง Start = กรอบแดงและ Compute ใช้ไม่ได้
// - Auto Add to Timeline (ติ๊กไว้ตั้งต้น) = `timeline` ของ Compute; Add Timeline = Compute รายการที่เลือกด้วย `timeline: true` อย่างเดียว
// - Animation Graphics ส่งทั้งก้อนใน `graphics` ของ Compute (ชื่อช่องตรงกับ AccessGraphics ของ server) custom_color ส่งเฉพาะเมื่อมีสี
//   (สีที่เก็บไว้หรือที่เลือก) Use Object Colors จึงไม่ลบสีที่เก็บไว้ แก้ช่องกราฟิกใดก็ตาม = เลิกติ๊ก Inherit Settings from Scenario
//   (แบบเดียวกับ ColorRow ของ Properties Browser: ค่าที่แก้ไม่มีผลถ้ายัง inherit) ผู้ใช้ติ๊กกลับเองได้
// - ค่าในฟอร์ม (กราฟิก สี ช่วงเวลา) เริ่มจาก access ที่เก็บไว้เมื่อรายการที่ติ๊กตรงกับ access หนึ่งตัว (storedSettings) และเริ่มใหม่ทุกครั้งที่
//   รายการที่ติ๊กเปลี่ยน รายการใหม่ที่ไม่มี access = ค่าตั้งต้น (ถ้าก่อนหน้านั้นฟอร์มมาจาก access ที่เก็บไว้) ไม่งั้นคงค่าที่ผู้ใช้ตั้งไว้
// - Start/Stop ที่ผู้ใช้ยังไม่แก้แสดงตาม DateFormat และช่วงวิเคราะห์ (หรือช่วงที่เก็บไว้) ปัจจุบันเสมอ
// - Reports / Graphs: Access..., AER... เปิดหน้าต่างรายงาน/กราฟของคู่ P1 ที่ติ๊ก (openReport)
//   Report & Graph Manager... เปิด Manager ที่ Object Type = Access และเลือกคู่ที่ติ๊กไว้ (ใช้ได้ตามสถานะของคำสั่ง analysis.reportGraphManager)

import * as ContextMenu from "@radix-ui/react-context-menu";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { postAccess } from "../../api/access";
import { ApiError, errorText } from "../../api/client";
import { useCommands, useTimeFormatter } from "../../chrome/hooks";
import { commandTooltip, isEnabled } from "../../commands";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useJobs } from "../../stores/jobs";
import { report as notify } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario, type ScenarioDoc } from "../../stores/scenario";
import { parseIsoUtc, parseTime } from "../../time/parse";
import { SelectObjectDialog } from "../InsertObjects/SelectObjectDialog";
import { openReport } from "../Report/Report";
import { openReportGraphManager } from "../ReportGraphManager/commands";
import { moveIndex } from "../ReportGraphManager/ReportGraphManager";
import { ACCESS_TOOL_KIND, openAccessTool } from "./commands";
import {
  accessForClass, allSelections, associatedTree, computedSatellites, DEFAULT_GRAPHICS, leavesOf, pairOf, reportObjects, selections, storedSettings,
  type AccessGraphics, type AccessSelection, type AccessTimePeriod, type AssocNode, type StatusByFacility, type StoredSettings,
} from "./state";

type Action = "compute" | "clear" | "remove";

const EMPTY: ReadonlySet<string> = new Set();
/** กุญแจของแถวใน Associated Objects (ดาวตัวเดียวกันอยู่ได้ทั้งเป็นลูกของ Constellation และเป็นแถวเดี่ยวในต้นไม้ต่างชุด) */
const rowKey = (node: AssocNode, child: boolean): string => `${child ? "c" : "n"}:${node.path}`;
/** สีที่ช่อง Color แสดงเมื่อยังไม่มีสีที่เก็บไว้หรือเลือกไว้ (ส่งเมื่อเลือก Use Custom Color แล้วไม่ได้เลือกสี) */
const FALLBACK_COLOR = "#ffff00";

/** เวลา UTC แบบที่ server รับ (UtcZ): ไม่มีเศษวินาที = ไม่เขียน .000 */
const utcZ = (d: Date): string => d.toISOString().replace(".000Z", "Z");

/** path ของ Facility และ Satellite ทั้งหมด (ตัวเลือกของ Select Object...) */
const accessForChoices = (doc: ScenarioDoc | null): string[] =>
  (doc?.objects ?? []).filter((o) => o.class === "Facility" || o.class === "Satellite").map((o) => `*/${o.class}/${o.name}`);

export function AccessTool({ params }: PanelProps) {
  useCommands(); // ปุ่ม Report & Graph Manager... ตามสถานะคำสั่ง
  const from: string | null = typeof params?.from === "string" && params.from !== "" ? params.from : null;
  const sc = useScenario((s) => s.name);
  const doc = useScenario((s) => s.doc);
  const info = useResults((s) => s.info);
  const jobActive = useJobs((s) => sc !== null && s.activeFor(sc) !== undefined);
  const formatter = useTimeFormatter();
  const ids = useId();

  const cls = accessForClass(doc, from);
  const tree = useMemo(() => associatedTree(doc, from), [doc, from]);
  const leaves = useMemo(() => new Set(leavesOf(tree)), [tree]);
  const status = useMemo<StatusByFacility>(
    () => Object.fromEntries(Object.entries(info?.access ?? {}).map(([name, entry]) => [name, entry.status])),
    [info],
  );
  const bold = useMemo(() => computedSatellites(doc, status), [doc, status]);

  // ที่ติ๊กเป็นของ Access For ตัวที่ติ๊ก: เปลี่ยน Access For = เริ่มว่าง; object ที่หายจาก doc ไม่นับ
  const [ticks, setTicks] = useState<{ from: string | null; set: ReadonlySet<string> }>({ from, set: EMPTY });
  const checked = useMemo(
    () => (ticks.from === from ? new Set([...ticks.set].filter((p) => leaves.has(p))) : EMPTY),
    [ticks, from, leaves],
  );
  const setChecked = (next: ReadonlySet<string>): void => setTicks({ from, set: next });

  const [mode, setMode] = useState<AccessTimePeriod["mode"]>("object");
  // ช่วงตั้งต้นของ Start/Stop (ISO; null = ช่วงวิเคราะห์) และข้อความที่ผู้ใช้พิมพ์เอง (null = ยังไม่แก้: แสดงช่วงตั้งต้นตาม DateFormat ปัจจุบัน)
  const [period, setPeriod] = useState<{ start: string | null; stop: string | null }>({ start: null, stop: null });
  const [startEdit, setStartEdit] = useState<string | null>(null);
  const [stopEdit, setStopEdit] = useState<string | null>(null);
  const [autoAdd, setAutoAdd] = useState(true);
  const [graphics, setGraphics] = useState<AccessGraphics>({ ...DEFAULT_GRAPHICS });
  /** สีของ Use Custom Color: ที่เก็บไว้หรือที่เลือก (null = ยังไม่มี ไม่ส่ง custom_color) */
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const startText = startEdit ?? isoText(period.start ?? doc?.analysis_period.start, formatter.format);
  const stopText = stopEdit ?? isoText(period.stop ?? doc?.analysis_period.stop, formatter.format);
  const start = parseTime(startText, formatter.fmt, formatter.ltz);
  const stop = parseTime(stopText, formatter.fmt, formatter.ltz);
  const startBad = mode === "specify" && start === null;
  const stopBad = mode === "specify" && (stop === null || (start !== null && stop.getTime() <= start.getTime()));
  const timePeriod: AccessTimePeriod | null =
    mode === "object" ? { mode: "object" } : start !== null && stop !== null && !stopBad ? { mode: "specify", start: utcZ(start), stop: utcZ(stop) } : null;

  const locked = busy || jobActive || sc === null;
  const chosen = selections(doc, from, checked);
  const canSelect = !locked && chosen.length > 0;
  const objects = reportObjects(doc, from, checked);

  // ค่าในฟอร์มจาก access ที่เก็บไว้: เริ่มใหม่เมื่อรายการที่ติ๊กเปลี่ยน (ไม่ใช่เมื่อ doc เปลี่ยนเฉย ๆ เช่นหลัง Compute)
  const stored = useMemo(() => storedSettings(doc, from, checked), [doc, from, checked]);
  const latestStored = useRef(stored);
  latestStored.current = stored;
  const seededFromStore = useRef(false);
  const selectionKey = JSON.stringify([from, chosen]);
  useEffect(() => {
    const seed = latestStored.current;
    if (seed === null && !seededFromStore.current) return; // access ใหม่หลังค่าที่ผู้ใช้ตั้งเอง: คงไว้
    seededFromStore.current = seed !== null;
    applySettings(seed);
  }, [selectionKey]);

  /** ใส่ค่าของ access ที่เก็บไว้ลงฟอร์ม (null = ค่าตั้งต้น) ข้อความที่พิมพ์ไว้ใน Start/Stop ถูกทิ้ง */
  function applySettings(seed: StoredSettings | null): void {
    const tp = seed?.time_period ?? { mode: "object" as const };
    setGraphics({ ...(seed?.graphics ?? DEFAULT_GRAPHICS) });
    setCustomColor(seed?.graphics.custom_color ?? null);
    setMode(tp.mode ?? "object");
    setPeriod(tp.mode === "specify" ? { start: tp.start ?? null, stop: tp.stop ?? null } : { start: null, stop: null });
    setStartEdit(null);
    setStopEdit(null);
  }

  /** ส่งชุดที่เลือกผ่าน postAccess (คิวการเขียน ETag ต่อกัน ดึง doc ใหม่หลังเขียน) ปลดปุ่มเมื่อเสร็จทั้งหมด */
  const send = async (action: Action, list: AccessSelection[], extra: Record<string, unknown> = {}): Promise<void> => {
    const name = sc;
    if (name === null) return;
    const none = (): void => notify("info", "ACCESS_NONE", msg(action === "clear" ? "access.nothingToClear" : "access.nothingToRemove"), from);
    if (list.length === 0) {
      if (action !== "compute") none();
      return;
    }
    setBusy(true);
    try {
      const { matched } = await postAccess(name, action, list.map((sel) => ({ from: sel.from, to: sel.to, ...extra })));
      if (action !== "compute" && matched === 0) none();
    } catch (e) {
      // 412: store ตั้ง conflict แล้ว กล่อง Reload / Cancel ของทั้งแอปเป็นตัวแจ้ง
      if (!(e instanceof ApiError && e.status === 412)) {
        notify("error", e instanceof ApiError ? e.code : "ACCESS_FAILED", msg("access.failed", { message: errorText(e) }), from);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const compute = (): void => {
    if (!canSelect || timePeriod === null) return;
    const { custom_color: _unused, ...rest } = graphics;
    const color = customColor ?? (graphics.color_mode === "custom" ? FALLBACK_COLOR : null);
    const g = color === null ? rest : { ...rest, custom_color: color };
    void send("compute", chosen, { time_period: timePeriod, graphics: g, timeline: autoAdd });
  };

  const openStyle = (style: "Access" | "AER", kind: "report" | "graph"): void => {
    if (objects.length > 0) openReport({ style, kind, objects, time: { mode: "object" }, dynamic: false });
  };

  const toggle = (paths: readonly string[], on: boolean): void => {
    const next = new Set(checked);
    for (const p of paths) {
      if (on) next.add(p);
      else next.delete(p);
    }
    setChecked(next);
  };

  /** แก้ช่องกราฟิก = เลิกติ๊ก Inherit (ค่าที่แก้ไม่มีผลถ้ายัง inherit) */
  const setG = (patch: Partial<AccessGraphics>): void => setGraphics((g) => ({ ...g, ...patch, inherit: false }));
  const isBold = (leaf: string): boolean => from !== null && bold.has(pairOf(from, leaf));
  const rgmEnabled = isEnabled("analysis.reportGraphManager");

  // roving tabindex: แถวที่รับ Tab = แถวที่โฟกัสล่าสุด (ยังอยู่ในรายการ) ไม่งั้นแถวแรกที่ติ๊กได้
  const rowKeys = tree.flatMap((node) => [
    ...(node.cls !== "Constellation" || (node.children ?? []).length > 0 ? [rowKey(node, false)] : []),
    ...(node.children ?? []).map((c) => rowKey(c, true)),
  ]);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const tabRow = focusRow !== null && rowKeys.includes(focusRow) ? focusRow : (rowKeys[0] ?? null);
  const rowRefs = useRef(new Map<string, HTMLInputElement>());
  const onRowKeyDown = (e: ReactKeyboardEvent, key: string): void => {
    const to = moveIndex(e.key, rowKeys.indexOf(key), rowKeys.length);
    if (to === null) return; // Space = ติ๊กของ checkbox เอง
    e.preventDefault();
    setFocusRow(rowKeys[to]);
    rowRefs.current.get(rowKeys[to])?.focus();
  };

  const row = (node: AssocNode, child: boolean) => {
    const members = node.cls === "Constellation" ? (node.children ?? []).map((c) => c.path) : [node.path];
    const on = members.filter((p) => checked.has(p)).length;
    const all = members.length > 0 && on === members.length;
    const strong = members.length > 0 && members.every(isBold);
    const key = rowKey(node, child);
    return (
      <div key={key} className={child ? "access-row access-child" : "access-row"} data-computed={strong ? "true" : "false"}>
        <label className="access-choice">
          <input
            type="checkbox"
            aria-label={node.name}
            checked={all}
            disabled={members.length === 0}
            tabIndex={key === tabRow ? 0 : -1}
            ref={(el) => {
              if (el !== null) {
                el.indeterminate = on > 0 && !all;
                rowRefs.current.set(key, el);
              } else rowRefs.current.delete(key);
            }}
            onFocus={() => setFocusRow(key)}
            onKeyDown={(e) => onRowKeyDown(e, key)}
            onChange={() => toggle(members, !all)}
          />
          <span className={strong ? "access-name access-computed" : "access-name"}>{node.name}</span>
        </label>
      </div>
    );
  };

  return (
    <div className="access-tool">
      <div className="access-for">
        <label htmlFor={`${ids}-for`}>{t("access.accessFor")}</label>
        <input id={`${ids}-for`} className="field form-input" readOnly value={cls === null || from === null ? "" : from.slice(2)} />
        <button type="button" className="btn" disabled={sc === null} onClick={() => setPicking(true)}>
          {t("access.selectObject")}
        </button>
      </div>
      {cls === null && <p className="props-note">{msg("access.selectAccessFor")}</p>}

      <div className="access-main">
        <fieldset className="props-group access-assoc">
          <legend>{t("access.associatedObjects")}</legend>
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div className="access-tree">
                {cls !== null && tree.length === 0 && <p className="props-note">{msg("access.noAssociated")}</p>}
                {tree.map((node) => [row(node, false), ...(node.children ?? []).map((c) => row(c, true))])}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="menu-content">
                <ContextMenu.Item className="menu-item" disabled={leaves.size === 0} onSelect={() => setChecked(new Set(leaves))}>
                  {t("access.selectAll")}
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        </fieldset>
        <div className="access-buttons">
          <button type="button" className="btn" disabled={!canSelect || timePeriod === null} onClick={compute}>
            {t("access.compute")}
          </button>
          <button type="button" className="btn" disabled={!canSelect} onClick={() => void send("clear", chosen)}>
            {t("access.clear")}
          </button>
          <button type="button" className="btn" disabled={locked || cls === null} onClick={() => void send("clear", allSelections(doc, from))}>
            {t("access.clearAll")}
          </button>
          <button type="button" className="btn" disabled={!canSelect} onClick={() => void send("remove", chosen)}>
            {t("access.remove")}
          </button>
          <button type="button" className="btn" disabled={locked || cls === null} onClick={() => void send("remove", allSelections(doc, from))}>
            {t("access.removeAll")}
          </button>
          {jobActive && <p className="props-note" role="status">{msg("access.busy")}</p>}
        </div>
      </div>

      <fieldset className="props-group">
        <legend>{t("access.timePeriod")}</legend>
        <label className="access-choice">
          <input type="radio" name={`${ids}-time`} checked={mode === "object"} onChange={() => setMode("object")} />
          {t("access.useObjectTimePeriod")}
        </label>
        <label className="access-choice">
          <input type="radio" name={`${ids}-time`} checked={mode === "specify"} onChange={() => setMode("specify")} />
          {t("access.specifyTimePeriod")}
        </label>
        <div className="access-times">
          <label htmlFor={`${ids}-start`}>{t("field.analysisStart")}</label>
          <input
            id={`${ids}-start`}
            className={startBad ? "field field-time field-invalid" : "field field-time"}
            aria-invalid={startBad ? true : undefined}
            disabled={mode !== "specify"}
            value={startText}
            onChange={(e) => setStartEdit(e.target.value)}
          />
          <label htmlFor={`${ids}-stop`}>{t("field.analysisStop")}</label>
          <input
            id={`${ids}-stop`}
            className={stopBad ? "field field-time field-invalid" : "field field-time"}
            aria-invalid={stopBad ? true : undefined}
            disabled={mode !== "specify"}
            value={stopText}
            onChange={(e) => setStopEdit(e.target.value)}
          />
        </div>
        {(startBad || stopBad) && <p className="form-error">{msg("access.timeInvalid", { example: isoText(doc?.analysis_period.start, formatter.format) })}</p>}
      </fieldset>

      <div className="access-columns">
        <fieldset className="props-group">
          <legend>{t("access.reports")}</legend>
          <button type="button" className="btn" disabled={objects.length === 0} onClick={() => openStyle("Access", "report")}>
            {t("access.accessDots")}
          </button>
          <button type="button" className="btn" disabled={objects.length === 0} onClick={() => openStyle("AER", "report")}>
            {t("access.aerDots")}
          </button>
        </fieldset>
        <fieldset className="props-group">
          <legend>{t("access.graphs")}</legend>
          <button type="button" className="btn" disabled={objects.length === 0} onClick={() => openStyle("Access", "graph")}>
            {t("access.accessDots")}
          </button>
          <button type="button" className="btn" disabled={objects.length === 0} onClick={() => openStyle("AER", "graph")}>
            {t("access.aerDots")}
          </button>
        </fieldset>
        <div className="access-other">
          <button
            type="button"
            className="btn"
            disabled={!rgmEnabled}
            title={commandTooltip("analysis.reportGraphManager")}
            onClick={() => openReportGraphManager({ objectType: "Access", objects })}
          >
            {t("menu.analysis.reportGraphManager")}
          </button>
          <button type="button" className="btn" disabled={!canSelect} onClick={() => void send("compute", chosen, { timeline: true })}>
            {t("access.addTimeline")}
          </button>
          <label className="access-choice">
            <input type="checkbox" checked={autoAdd} onChange={(e) => setAutoAdd(e.target.checked)} />
            {t("access.autoAddToTimeline")}
          </label>
        </div>
      </div>

      <fieldset className="props-group">
        <legend>{t("access.animationGraphics")}</legend>
        <div className="access-columns">
          <div className="access-stack">
            <label className="access-choice">
              <input type="checkbox" checked={graphics.show} onChange={(e) => setG({ show: e.target.checked })} />
              {t("ob.show")}
            </label>
            <label className="access-choice">
              <input type="checkbox" checked={graphics.static_highlight} onChange={(e) => setG({ static_highlight: e.target.checked })} />
              {t("access.staticHighlight")}
            </label>
            <label className="access-choice">
              <input type="checkbox" checked={graphics.animate_highlight} onChange={(e) => setG({ animate_highlight: e.target.checked })} />
              {t("access.animateHighlight")}
            </label>
            <label className="access-choice">
              <input type="checkbox" checked={graphics.animate_line} onChange={(e) => setG({ animate_line: e.target.checked })} />
              {t("access.showAnimateLine")}
            </label>
          </div>
          <div className="access-stack">
            <label className="access-choice">
              <input type="radio" name={`${ids}-color`} checked={graphics.color_mode === "object"} onChange={() => setG({ color_mode: "object" })} />
              {t("access.useObjectColors")}
            </label>
            <label className="access-choice">
              <input type="radio" name={`${ids}-color`} checked={graphics.color_mode === "custom"} onChange={() => setG({ color_mode: "custom" })} />
              {t("access.useCustomColor")}
            </label>
            <label className="access-choice">
              {t("field.color")}
              <input
                type="color"
                className="color-input"
                aria-label={t("field.color")}
                disabled={graphics.color_mode !== "custom"}
                value={customColor ?? FALLBACK_COLOR}
                onChange={(e) => {
                  setCustomColor(e.target.value.toLowerCase());
                  setG({});
                }}
              />
            </label>
            <label className="access-choice">
              <input type="checkbox" checked={graphics.inherit} onChange={(e) => setGraphics((g) => ({ ...g, inherit: e.target.checked }))} />
              {t("access.inheritSettings")}
            </label>
          </div>
        </div>
      </fieldset>

      {picking && (
        <SelectObjectDialog
          choices={accessForChoices(doc)}
          initial={from}
          listLabel={t("access.accessForList")}
          emptyNote={msg("viewFromTo.noObjects")}
          onClose={(path) => {
            setPicking(false);
            if (path !== null && path !== from) openAccessTool(path);
          }}
        />
      )}
    </div>
  );
}

/** ข้อความของเวลา ISO ตาม DateFormat (อ่านไม่ได้ = ว่าง) */
function isoText(iso: string | undefined, format: (d: Date) => string): string {
  const d = iso === undefined ? null : parseIsoUtc(iso);
  return d === null ? "" : format(d);
}

export function registerAccessToolPanel(): void {
  const base = getPanelDef(ACCESS_TOOL_KIND);
  if (base === undefined) throw new Error(`panel kind "${ACCESS_TOOL_KIND}" is not registered`);
  registerPanel(ACCESS_TOOL_KIND, { ...base, component: AccessTool });
}
