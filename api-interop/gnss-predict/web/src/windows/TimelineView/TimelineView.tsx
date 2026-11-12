// Timeline View (spec §10, STK ref §D): หน้าต่าง canvas สามส่วน Global Time Bar (ตัวชี้เวลาสีขาว + กรอบ View Port), Global Time Scale, Time Display
// - แถว = access ที่เปิด Timeline (rows.ts, useIntervals.ts) สี/ช่วงเวลาตามผลที่ server คำนวณ แถวที่ชื่ออยู่ใน timelineHidden ของ workbook ไม่แสดง
// - รูปทรงและการหาจุดที่คลิกอยู่ใน layout.ts (ฟังก์ชันล้วน) การวาดอยู่ใน draw.ts: วาดไม่เกินหนึ่งครั้งต่อเฟรมเมื่อเวลา แถว ขนาด หรือ View Port เปลี่ยน
//   (rAF ตัวเดียวต่อหน้าต่าง; เวลา animation อ่านจาก useTime ตอนวาดเลย ไม่ผ่าน React จึงไม่ต้อง render ทุกเฟรม)
// - เมาส์: คลิก/ลากใน Time Display และ Global Time Scale = ตั้งเวลา; ใน Global Time Bar ลากตัวชี้ = ตั้งเวลา ลากกรอบ = เลื่อน View Port ลากขอบกรอบ = ย่อ/ขยาย;
//   ล้อเมาส์ = ซูมรอบตำแหน่งเมาส์ (Shift + ล้อ = เลื่อนแถว); คลิกขวา = เมนู (Set Animation Time to Here; บนแถบช่วงเวลามีเมนูของช่วงนั้นด้วย)
// - คีย์บอร์ด: Time Display รับโฟกัสได้ ซ้าย/ขวา = ถอย/เดินหน้า 1 step, + / - = ซูม
// - canvas เป็น role="img" พร้อมคำอธิบายเวลา; รายชื่อแถว (และหมายเหตุของแถวที่ไม่มีช่วงเวลา) อยู่ในรายการที่อ่านได้ด้วย screen reader

import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout, usePanelResize } from "../../stores/layout";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { useTime } from "../../stores/time";
import { formatTime, type DateFormat } from "../../time/format";
import { drawTimeline, timelineTheme } from "./draw";
import {
  DISPLAY_TOP, ROW_H, SCROLL_W, hitTest, maxScroll, needsScrollbar, plotOf, type Hit, type Size, type TimelineScene,
} from "./layout";
import { timelineRows, type TimelineRow } from "./rows";
import { centerViewPort, dragViewPort, wheelZoomFactor, xToTime, zoomViewPort, type ViewPort, type ViewPortDrag } from "./scale";
import { useAccessIntervals } from "./useIntervals";

/** ขนาดที่ใช้เมื่อยังวัดไม่ได้ (jsdom, หน้าต่างเพิ่งสร้าง) = ขนาดตั้งต้นของหน้าต่าง */
const FALLBACK_SIZE: Size = { width: 720, height: 280 };

const toSec = (d: Date): number => d.getTime() / 1000;
/** วินาที -> Date ที่ความละเอียดมิลลิวินาที (เท่ากับความละเอียดของเวลาทั้งแอป) */
const toDate = (sec: number): Date => new Date(Math.round(sec * 1000));
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** สิ่งที่เมนูคลิกขวาทำกับ ณ ตำแหน่งที่คลิก (จดไว้ตอนคลิก: แถวและช่วงเวลาอาจเปลี่ยนก่อนเลือกรายการ) */
interface MenuTarget {
  time: number;
  interval?: { row: string; start: number; stop: number };
}

interface Hover {
  x: number;
  y: number;
  text: string;
  row: number;
  interval: number | null;
}

type Drag = { kind: "time"; map: "bar" | "display" } | { kind: ViewPortDrag; start: ViewPort; grabT: number };

const CURSORS: Record<string, string> = { pointer: "ew-resize", edgeLeft: "ew-resize", edgeRight: "ew-resize", viewport: "grab", track: "pointer" };
const cursorFor = (hit: Hit): string =>
  hit.part === "bar" ? CURSORS[hit.zone] : hit.part === "display" ? (hit.interval !== null ? "context-menu" : "crosshair") : hit.part === "scale" ? "crosshair" : "default";

export function TimelineView({ panelId }: Partial<PanelProps>) {
  const doc = useScenario((s) => s.doc);
  const prnByNorad = useResults((s) => s.prnByNorad);
  const hiddenNames = useLayout((s) => s.timelineHidden);
  // ตัวเลข ไม่ใช่ Date: store สร้าง Date ใหม่ทุกครั้งที่ตั้งเวลาใหม่ (เช่นเปลี่ยน Time Step) แต่ช่วงวิเคราะห์เท่าเดิมต้องไม่ล้าง View Port
  const periodStartMs = useTime((s) => s.periodStart.getTime());
  const periodStopMs = useTime((s) => s.periodStop.getTime());
  const current = useThrottledTime();
  const { fmt, ltz, format } = useTimeFormatter();

  const bounds = useMemo<ViewPort>(() => [periodStartMs / 1000, periodStopMs / 1000], [periodStartMs, periodStopMs]);
  const replies = useAccessIntervals();
  const allRows = useMemo(() => timelineRows(doc, replies, { prnByNorad }), [doc, replies, prnByNorad]);
  const rows = useMemo(() => {
    const hidden = new Set(hiddenNames);
    return allRows.filter((r) => !hidden.has(r.name));
  }, [allRows, hiddenNames]);

  const [size, setSize] = useState<Size>(FALLBACK_SIZE);
  // View Port ของช่วงวิเคราะห์นี้: ช่วงวิเคราะห์เปลี่ยน (เปิด scenario ใหม่ หรือแก้ Start/Stop) = กลับไปเต็มช่วง
  const [viewState, setViewState] = useState<{ bounds: ViewPort; view: ViewPort }>({ bounds, view: bounds });
  const view = viewState.bounds === bounds ? viewState.view : bounds;
  const setView = useCallback((next: ViewPort) => setViewState({ bounds, view: next }), [bounds]);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollY = Math.min(scrollTop, maxScroll(size, rows.length));
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** เป้าหมายของเมนูที่จะเปิด (อ่านได้ทันทีในเหตุการณ์เดียวกับที่ Radix เปิดเมนู ซึ่ง state ยังไม่ทัน render) */
  const menuTarget = useRef<MenuTarget | null>(null);

  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const focusTarget = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragEnd = useRef<(() => void) | null>(null);

  /** ค่าล่าสุดสำหรับตัวจัดการเหตุการณ์และตัววาด (ไม่ต้องผูกใหม่ทุกครั้งที่ render) */
  const latest = useRef({ size, rows, view, bounds, scrollY, fmt, ltz, hover, setView });
  latest.current = { size, rows, view, bounds, scrollY, fmt, ltz, hover, setView };
  const scene = (): TimelineScene => {
    const l = latest.current;
    return { size: l.size, rows: l.rows, view: l.view, bounds: l.bounds, current: toSec(useTime.getState().current), scrollY: l.scrollY };
  };

  // ---------- ขนาด ----------
  const applySize = useCallback((width: number, height: number) => {
    if (width > 0 && height > 0) setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  useLayoutEffect(() => {
    const r = host.current?.getBoundingClientRect();
    if (r !== undefined) applySize(Math.floor(r.width), Math.floor(r.height));
  }, [applySize]);
  usePanelResize(panelId ?? "", (s) => applySize(s.width, s.height));

  // แถวเปลี่ยน (ดึงใหม่ ซ่อนแถว): หมายเหตุที่ชี้อยู่เป็นของแถวเดิม
  useEffect(() => setHover(null), [rows]);

  // ---------- วาด: ไม่เกินหนึ่งครั้งต่อเฟรม ----------
  const frame = useRef<number | null>(null);
  const drawNow = useCallback(() => {
    const el = canvas.current;
    if (el === null) return;
    const l = latest.current;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(l.size.width * ratio));
    const h = Math.max(1, Math.round(l.size.height * ratio));
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    const ctx = el.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawTimeline(ctx, {
      scene: { size: l.size, rows: l.rows, view: l.view, bounds: l.bounds, current: toSec(useTime.getState().current), scrollY: l.scrollY },
      rows: l.rows,
      theme: timelineTheme(),
      fmt: l.fmt,
      ltz: l.ltz,
      hover: l.hover === null ? null : { row: l.hover.row, interval: l.hover.interval },
    });
  }, []);
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      drawNow();
    });
  }, [drawNow]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );
  useEffect(schedule, [schedule, size, rows, view, bounds, scrollY, fmt, ltz, hover]);
  // เวลา animation เดินโดยไม่ผ่าน React: ขอเฟรมเมื่อ current เปลี่ยน
  useEffect(() => useTime.subscribe((s, prev) => { if (s.current !== prev.current) schedule(); }), [schedule]);

  // ---------- เมาส์ ----------
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const setTimeAt = (sec: number): void => useTime.getState().setCurrent(toDate(sec));

  const applyDrag = (drag: Drag, x: number): void => {
    const l = latest.current;
    const p = plotOf(l.size, needsScrollbar(l.size, l.rows.length));
    const [lo, hi] = l.bounds;
    if (drag.kind === "time") {
      const [a, b] = drag.map === "bar" ? l.bounds : l.view;
      setTimeAt(clamp(xToTime(x - p.left, a, b, p.width), lo, hi));
    } else {
      l.setView(dragViewPort(drag.kind, drag.start, drag.grabT, xToTime(x - p.left, lo, hi, p.width), l.bounds));
    }
  };
  const startDrag = (drag: Drag): void => {
    dragEnd.current?.();
    const move = (ev: PointerEvent): void => applyDrag(drag, local(ev).x);
    const end = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      dragEnd.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    dragEnd.current = end;
  };
  useEffect(() => () => dragEnd.current?.(), []);

  /** เมนูที่ใต้เมาส์: เวลาที่ตำแหน่งนั้น และถ้าอยู่บนแถบช่วงเวลาก็รวมช่วงนั้นด้วย; ที่ไม่มีเมนู (ชื่อแถว ขอบ) = null */
  const menuTargetFor = (hit: Hit): MenuTarget | null => {
    if (hit.part === "bar" || hit.part === "scale") return { time: hit.time };
    if (hit.part !== "display") return null;
    const row = hit.row === null ? undefined : latest.current.rows[hit.row];
    const iv = row === undefined || hit.interval === null ? undefined : row.intervals[hit.interval];
    return row !== undefined && iv !== undefined ? { time: hit.time, interval: { row: row.name, start: iv.start, stop: iv.stop } } : { time: hit.time };
  };
  const aim = (target: MenuTarget | null): void => {
    menuTarget.current = target;
    setMenu(target);
  };

  const onPointerDown = (e: ReactPointerEvent): void => {
    const s = scene();
    const { x, y } = local(e);
    const hit = hitTest(s, x, y);
    // นิ้วหรือปากกา: Radix เปิดเมนูเองเมื่อกดค้าง (ไม่มี event contextmenu ให้ onContextMenuCapture) จึงจดเป้าหมายไว้ตั้งแต่ตอนกด
    if (e.pointerType === "touch" || e.pointerType === "pen") aim(menuTargetFor(hit));
    if (e.button !== 0) return;
    let drag: Drag;
    if (hit.part === "bar") {
      if (hit.zone === "pointer" || hit.zone === "track") {
        setTimeAt(hit.time);
        drag = { kind: "time", map: "bar" };
      } else {
        drag = { kind: hit.zone, start: [s.view[0], s.view[1]], grabT: hit.time };
      }
    } else if (hit.part === "display" || hit.part === "scale") {
      setTimeAt(hit.time);
      drag = { kind: "time", map: "display" };
    } else {
      return;
    }
    focusTarget.current?.focus({ preventScroll: true });
    startDrag(drag);
  };

  const onPointerMove = (e: ReactPointerEvent): void => {
    if (dragEnd.current !== null) return;
    const { x, y } = local(e);
    const hit = hitTest(scene(), x, y);
    if (canvas.current !== null) canvas.current.style.cursor = cursorFor(hit);
    let next: Hover | null = null;
    if (hit.part === "display" && hit.row !== null) {
      const row = latest.current.rows[hit.row];
      if (hit.interval !== null) next = { x, y, row: hit.row, interval: hit.interval, text: intervalText(row, hit.interval, latest.current.fmt, latest.current.ltz) };
      else if (row.note !== undefined) next = { x, y, row: hit.row, interval: null, text: row.note };
    }
    setHover((prev) => (prev?.row === next?.row && prev?.interval === next?.interval ? prev : next));
  };

  const onContextMenuCapture = (e: ReactMouseEvent): void => {
    const { x, y } = local(e);
    const target = menuTargetFor(hitTest(scene(), x, y));
    aim(target);
    if (target === null) e.preventDefault(); // คอลัมน์ชื่อแถวและขอบ: ไม่มีเมนู (Radix ไม่เปิดเมื่อ event ถูก preventDefault แล้ว)
  };

  // ล้อเมาส์: ต้องเป็น listener แบบ non-passive (React ผูก wheel เป็น passive) จึงจะ preventDefault กันหน้าเลื่อนได้
  useEffect(() => {
    const el = stage.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      const hit = hitTest(scene(), local(e).x, local(e).y);
      if (hit.part !== "display" && hit.part !== "scale") return;
      e.preventDefault();
      if (e.shiftKey) {
        if (scroller.current !== null) scroller.current.scrollTop += e.deltaY;
        return;
      }
      const l = latest.current;
      l.setView(zoomViewPort(l.view[0], l.view[1], hit.time, wheelZoomFactor(e.deltaY, e.deltaMode), l.bounds));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---------- คีย์บอร์ด ----------
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // คีย์ลัดของแอป
    const l = latest.current;
    const middle = (l.view[0] + l.view[1]) / 2;
    switch (e.key) {
      case "ArrowLeft":
        useTime.getState().stepBackward();
        break;
      case "ArrowRight":
        useTime.getState().stepForward();
        break;
      case "+":
      case "=":
        l.setView(zoomViewPort(l.view[0], l.view[1], middle, 0.5, l.bounds));
        break;
      case "-":
      case "_":
        l.setView(zoomViewPort(l.view[0], l.view[1], middle, 2, l.bounds));
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ---------- เมนูคลิกขวา ----------
  const removeFromTimeline = (name: string): void => {
    const hidden = useLayout.getState().timelineHidden;
    if (!hidden.includes(name)) useLayout.getState().setTimelineHidden([...hidden, name]);
  };
  const center = (start: number, stop: number): void => {
    const l = latest.current;
    l.setView(centerViewPort(l.view, (start + stop) / 2, l.bounds));
  };

  const plot = plotOf(size, needsScrollbar(size, rows.length));
  const label = msg("timeline.canvas", { time: format(current), from: format(toDate(view[0])), to: format(toDate(view[1])), rows: rows.length });
  const scrollbar = needsScrollbar(size, rows.length);

  return (
    <div className="tl" ref={host}>
      <ContextMenu.Root
        open={menuOpen}
        onOpenChange={(next) => {
          if (next && menuTarget.current === null) return; // ไม่มีเมนูตรงนี้ (กดค้างด้วยนิ้วบนชื่อแถว)
          setMenuOpen(next);
          if (!next) aim(null);
        }}
      >
        <ContextMenu.Trigger asChild>
          <div
            ref={stage}
            className="tl-stage"
            style={{ width: size.width, height: size.height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            onContextMenuCapture={onContextMenuCapture}
          >
            <canvas ref={canvas} className="tl-canvas" role="img" aria-label={label} style={{ width: size.width, height: size.height }} />
            <div
              ref={focusTarget}
              className="tl-display"
              role="group"
              aria-label={t("timeline.timeDisplay")}
              tabIndex={0}
              style={{ left: plot.left, top: DISPLAY_TOP, width: plot.width, height: Math.max(0, size.height - DISPLAY_TOP) }}
              onKeyDown={onKeyDown}
            />
            {scrollbar && (
              <div
                ref={scroller}
                className="tl-vscroll"
                style={{ top: DISPLAY_TOP, width: SCROLL_W }}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              >
                <div style={{ height: rows.length * ROW_H }} />
              </div>
            )}
            {rows.length === 0 && (
              <p className="tl-empty" style={{ left: plot.left, top: DISPLAY_TOP }}>
                {doc === null ? msg("tooltip.noScenario") : msg("timeline.empty")}
              </p>
            )}
            {hover !== null && (
              <div className="tl-note" role="tooltip" style={{ left: Math.min(hover.x + 12, Math.max(0, size.width - 280)), top: hover.y + 16 }}>
                {hover.text}
              </div>
            )}
            <ul className="sr-only" aria-label={t("window.timelineView")}>
              {rows.map((row, i) => (
                <li key={i} data-row={row.name}>
                  {row.note === undefined ? row.name : `${row.name}: ${row.note}`}
                </li>
              ))}
            </ul>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="menu-content">
            {menu !== null && (
              <>
                <ContextMenu.Item className="menu-item" onSelect={() => setTimeAt(menu.time)}>
                  <span className="menu-label">{t("timeline.setAnimationTimeToHere")}</span>
                </ContextMenu.Item>
                {menu.interval !== undefined && (
                  <>
                    <ContextMenu.Item className="menu-item" onSelect={() => setTimeAt(menu.interval!.start)}>
                      <span className="menu-label">{t("timeline.setAnimationTimeToIntervalStart")}</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onSelect={() => setTimeAt(menu.interval!.stop)}>
                      <span className="menu-label">{t("timeline.setAnimationTimeToIntervalStop")}</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onSelect={() => center(menu.interval!.start, menu.interval!.stop)}>
                      <span className="menu-label">{t("timeline.center")}</span>
                    </ContextMenu.Item>
                    <ContextMenu.Item className="menu-item" onSelect={() => removeFromTimeline(menu.interval!.row)}>
                      <span className="menu-label">{t("timeline.removeFromTimeline")}</span>
                    </ContextMenu.Item>
                  </>
                )}
              </>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}

function intervalText(row: TimelineRow, index: number, fmt: DateFormat, ltz: string): string {
  const iv = row.intervals[index];
  const f = (sec: number): string => formatTime(toDate(sec), fmt, ltz);
  const seconds = Math.round(iv.stop - iv.start);
  const duration = `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")} m ${String(seconds % 60).padStart(2, "0")} s`;
  return iv.maxElDeg === undefined
    ? msg("timeline.intervalNoElevation", { name: row.name, start: f(iv.start), stop: f(iv.stop), duration })
    : msg("timeline.interval", { name: row.name, start: f(iv.start), stop: f(iv.stop), duration, maxEl: iv.maxElDeg.toFixed(1) });
}

/** ลงทะเบียน Timeline View เป็นหน้าต่างชนิด timelineView (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด และ persist/scenarioBound คงตามที่ลงไว้ใน layout/panels.ts ลงซ้ำได้ */
export function registerTimelineViewPanel(): void {
  const base = getPanelDef("timelineView");
  if (base === undefined) throw new Error('panel kind "timelineView" is not registered');
  registerPanel("timelineView", { ...base, component: TimelineView });
}
