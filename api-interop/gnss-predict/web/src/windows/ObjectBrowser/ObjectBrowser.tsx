// Object Browser (spec §7, STK ref §B): หน้าต่างต้นไม้ของ object ใน scenario ที่เปิดอยู่
// - แต่ละแถว: ลูกศรพับ, ช่องติ๊ก Show, กล่องสี, ไอคอนชนิด (Lucide), ชื่อ, ⚠ เมื่อดาวมีธง (W9); tooltip ของดาวบอก PRN SVN NORAD Block ชื่อ CelesTrak อายุข้อมูล และธงเป็นภาษาไทย
//   โฟลเดอร์กลุ่มไม่มีช่องติ๊กและกล่องสี เลือกได้ (ไว้วางดาวที่ตัด) แต่เปิด Properties ไม่ได้
// - วาดแบบ virtual list (TanStack Virtual) ต้นไม้ 130+ แถวมีใน DOM เฉพาะที่อยู่ใกล้พื้นที่เห็น + แถวที่เป็นตัวหยุดแท็บ (rangeExtractor) เพื่อให้โฟกัสและ Tab ไม่หายไปกับการเลื่อน
// - ไฟล์นี้เป็นหน้าจอล้วน: สถานะ (พับ ตัวกรอง ตัวค้น กล่อง ฯลฯ) อยู่ใน state.ts, สิ่งที่ทำอยู่ใน actions.ts, คำสั่งทั้งหมดลงทะเบียนระดับแอปใน objectCommands.ts
//   จึงปิดหน้าต่างนี้แล้วเมนู Edit ปุ่ม Delete และปุ่ม ⚠ ของแถบสถานะยังใช้ได้
// - การเลือก: sync กับ useSelection.activePath (คลิกแถว = เลือก, เลือกจากที่อื่น = แถวนี้ถูกไฮไลต์และเปิดโฟลเดอร์ที่พับครอบอยู่) โฟลเดอร์ไม่ใช่ object จึงเลือกแล้ว activePath = null
// - ขนาดแถวและเยื้องเป็นค่าคงที่ที่ virtual list ต้องรู้ จึงอยู่ที่นี่และใส่เป็น inline style ส่วนสีและฟอนต์อยู่ใน theme.css

import { defaultRangeExtractor, useVirtualizer, type Range, type Rect } from "@tanstack/react-virtual";
import {
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ClipboardPaste, Copy, Folder, FolderOpen, FolderPlus, Globe, MapPin, Orbit, Palette, Satellite,
  Scissors, Search, SlidersHorizontal, SquareCheck, Trash2, TriangleAlert, X, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { CommandContextMenu } from "../../chrome/ContextMenu";
import { OBJECT_MENU } from "../../chrome/menus";
import { Tip, TipProvider } from "../../chrome/Tip";
import { ToolButton } from "../../chrome/ToolButton";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { OBJECT_BROWSER_SCOPE } from "../../shortcuts";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { observeViewportWithFallback } from "../virtualList";
import { find, objectRows, openProperties, requestScroll, reveal, selectKey, setColor, setOpen, setShow } from "./actions";
import { FindDialog } from "./FindDialog";
import { NewGroupDialog } from "./NewGroupDialog";
import { RenameDialog } from "./RenameDialog";
import { useObjectBrowser } from "./state";
import { flattenTree, hasToggle, type Row, type RowClass } from "./tree";

const ROW_HEIGHT = 22;
const INDENT = 14;

/** ขนาดพื้นที่เห็นที่ใช้เมื่อยังวัดไม่ได้ (วัดได้ 0: ยังไม่มี layout เช่นหน้าต่างเพิ่งสร้าง หรือ jsdom) = ขนาดตั้งต้นของหน้าต่าง */
const FALLBACK_RECT: Rect = { width: 320, height: 520 };

const observeViewport = observeViewportWithFallback(FALLBACK_RECT);

const CLASS_ICONS: Record<RowClass, LucideIcon> = { Scenario: Globe, Facility: MapPin, Constellation: Orbit, Satellite };

const stop = (e: MouseEvent): void => e.stopPropagation();

// ---------- แถว ----------

interface RowHandlers {
  onSelect(row: Row): void;
  onOpen(row: Row): void;
  onToggleOpen(row: Row): void;
  onShow(row: Row, show: boolean): void;
  onColor(row: Row, color: string): void;
}

/** กล่องสี: ดับเบิลคลิกเปิดตัวเลือกสีของ browser (input color ที่ซ่อนอยู่) เมื่อเลือกสีใหม่ (change ไม่ใช่ input ที่ยิงทุกครั้งที่ลาก) ส่งสีนั้น */
function ColorBox({ row, onColor }: { row: Row; onColor(row: Row, color: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ row, onColor });
  latest.current = { row, onColor };

  useEffect(() => {
    const el = input.current;
    if (el === null) return;
    const changed = (): void => {
      const { row: current, onColor: send } = latest.current;
      if (el.value.toLowerCase() !== (current.color ?? "").toLowerCase()) send(current, el.value);
    };
    el.addEventListener("change", changed);
    return () => el.removeEventListener("change", changed);
  }, []);

  return (
    <span
      className="ob-color"
      onDoubleClick={(e) => {
        e.stopPropagation(); // ดับเบิลคลิกที่กล่องสีไม่ใช่การเปิด Properties
        const el = input.current;
        if (el === null) return;
        el.value = row.color ?? "#000000";
        el.click();
      }}
    >
      <span className="ob-swatch" role="img" aria-label={`${t("field.color")}: ${row.color}`} style={{ background: row.color }} />
      <input ref={input} type="color" className="ob-color-input" tabIndex={-1} aria-hidden="true" defaultValue={row.color} />
    </span>
  );
}

interface TreeRowProps extends RowHandlers {
  row: Row;
  top: number;
  selected: boolean;
  tabbable: boolean;
  showToggles: boolean;
  showColors: boolean;
  /** กำลังเขียนแถวนี้อยู่: ช่องติ๊กปิดไว้จนเสร็จ (กันสั่งซ้ำด้วยค่าเก่า) */
  busy: boolean;
}

function TreeRow({ row, top, selected, tabbable, showToggles, showColors, busy, onSelect, onOpen, onToggleOpen, onShow, onColor }: TreeRowProps) {
  const Icon = row.kind === "group" ? (row.expanded ? FolderOpen : Folder) : CLASS_ICONS[row.cls ?? "Scenario"];
  const toggle = hasToggle(row);
  return (
    <Tip content={row.tooltip} side="right">
      <div
        role="treeitem"
        data-row-key={row.key}
        className={`ob-row${row.hidden ? " ob-hidden" : ""}`}
        aria-level={row.depth + 1}
        aria-selected={selected}
        aria-expanded={row.expandable ? row.expanded : undefined}
        tabIndex={tabbable ? 0 : -1}
        style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)`, paddingLeft: row.depth * INDENT }}
        onClick={(e) => {
          onSelect(row);
          e.currentTarget.focus();
        }}
        onDoubleClick={() => onOpen(row)}
      >
        <span
          className="ob-arrow"
          onClick={(e) => {
            e.stopPropagation();
            if (row.expandable) onToggleOpen(row);
          }}
          onDoubleClick={stop}
        >
          {row.expandable && (row.expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />)}
        </span>
        {toggle && showToggles && (
          <input
            type="checkbox"
            className="ob-check"
            tabIndex={-1}
            aria-label={`${t("ob.show")} ${row.name}`}
            checked={row.show ?? true}
            disabled={row.hidden || busy}
            onChange={() => onShow(row, !(row.show ?? true))}
            onDoubleClick={stop}
          />
        )}
        {toggle && showColors && row.color !== undefined && <ColorBox row={row} onColor={onColor} />}
        <Icon className="ob-icon" size={14} aria-hidden="true" />
        <span className="ob-name">{row.name}</span>
        {row.warn && <TriangleAlert className="ob-warn" size={12} role="img" aria-label={t("status.flaggedSatellites")} />}
      </div>
    </Tip>
  );
}

// ---------- หน้าต่าง ----------

export function ObjectBrowser(_props: Partial<PanelProps>) {
  const tree = useScenario((s) => s.tree);
  // flattenTree ตอบจากสามอย่างนี้: doc (NORAD, สมาชิก, ตัวกรอง), catalog (ธง) และ tree
  const doc = useScenario((s) => s.doc);
  const catalog = useScenario((s) => s.catalog);
  const activePath = useSelection((s) => s.activePath);
  const { collapsed, groupSelected, flaggedOnly, showColors, showToggles, findOpen, findToken, newGroupOpen, renaming, scrollTarget, busy } = useObjectBrowser();

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<string | null>(null);

  // ---------- แถว ----------
  const { allKeys, allRows, rowByKey } = objectRows();
  const expanded = useMemo(() => new Set([...allKeys].filter((key) => !collapsed.has(key))), [allKeys, collapsed]);
  const rows = useMemo(() => (tree === null ? [] : flattenTree(tree, expanded, { flaggedOnly })), [tree, doc, catalog, expanded, flaggedOnly]);

  const selectedKey = groupSelected ?? activePath;
  const tabKey = rows.some((row) => row.key === selectedKey) ? selectedKey : rows[0]?.key;
  const tabIndex = rows.findIndex((row) => row.key === tabKey);

  // แถวที่เป็นตัวหยุดแท็บ (ที่เลือกอยู่) ต้องอยู่ใน DOM เสมอ แม้เลื่อนออกนอกพื้นที่เห็น: ไม่งั้นโฟกัสหลุดและ Tab เข้าต้นไม้ไม่ได้
  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      const wanted = defaultRangeExtractor(range);
      return tabIndex < 0 || wanted.includes(tabIndex) ? wanted : [...wanted, tabIndex].sort((a, b) => a - b);
    },
    [tabIndex],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeViewport,
    rangeExtractor,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  // เลือกจากที่อื่น (หรือกลับมาที่ Object Browser ที่มีการเลือกอยู่แล้ว) = เปิดโฟลเดอร์ที่พับครอบแถวนั้น แล้วเลื่อนมาให้เห็น
  useEffect(() => {
    if (selectedKey === null || !rowByKey.has(selectedKey)) return;
    reveal(selectedKey);
    requestScroll(selectedKey);
  }, [selectedKey]);

  // เลื่อนไปที่แถวเมื่อแถวนั้นอยู่ในรายการที่เห็น (เพิ่งเปิดโฟลเดอร์ หรือเพิ่งสร้าง/เปลี่ยนชื่อและต้นไม้ยังไม่มา = รอรอบถัดไป)
  useEffect(() => {
    if (scrollTarget === null) return;
    const index = rows.findIndex((row) => row.key === scrollTarget);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
    requestScroll(null);
  }, [scrollTarget, rows]);

  // โฟกัสแถวที่ผู้ใช้เพิ่งเลื่อนไปด้วยคีย์บอร์ด เมื่อแถวนั้นถูกวาดแล้ว (virtual list อาจเพิ่งสร้างแถวหลังเลื่อน จึงลองทุกครั้งที่วาด)
  useEffect(() => {
    const key = focusRequest.current;
    if (key === null) return;
    const el = Array.from(listRef.current?.children ?? []).find((child) => child.getAttribute("data-row-key") === key);
    if (el instanceof HTMLElement) {
      focusRequest.current = null;
      el.focus({ preventScroll: true });
    }
  });

  const closeFind = (): void => {
    useObjectBrowser.setState({ findOpen: false });
    focusRequest.current = tabKey ?? null;
  };

  // ---------- คีย์บอร์ด ----------
  const move = (row: Row | undefined): void => {
    if (row === undefined) return;
    selectKey(row.key);
    focusRequest.current = row.key;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // ช่องติ๊กและกล่องสีในแถวมีคีย์ของตัวเอง; คีย์ที่ถือ Ctrl/Alt/Meta เป็นคีย์ลัดของแอป (shortcuts.ts)
    if (e.target !== e.currentTarget && (e.target as HTMLElement).getAttribute("role") !== "treeitem") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = rows.findIndex((row) => row.key === selectedKey);
    const row = at < 0 ? undefined : rows[at];
    switch (e.key) {
      case "ArrowDown":
        move(rows[Math.min(at + 1, rows.length - 1)]);
        break;
      case "ArrowUp":
        move(rows[Math.max(at - 1, 0)]);
        break;
      case "PageDown":
      case "PageUp": {
        // เลื่อนการเลือกไปหนึ่งหน้า (จำนวนแถวที่เห็นพร้อมกัน)
        const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight || FALLBACK_RECT.height) / ROW_HEIGHT));
        const target = Math.max(0, Math.min(rows.length - 1, Math.max(at, 0) + (e.key === "PageDown" ? page : -page)));
        move(rows[target]);
        break;
      }
      case "Home":
        move(rows[0]);
        break;
      case "End":
        move(rows[rows.length - 1]);
        break;
      case "ArrowRight":
        if (row?.expandable !== true) break;
        if (!row.expanded) setOpen(row.key, true);
        else move(rows[at + 1]);
        break;
      case "ArrowLeft":
        if (row === undefined) break;
        if (row.expandable && row.expanded) setOpen(row.key, false);
        else if (row.parentKey !== null) move(rowByKey.get(row.parentKey));
        break;
      case "Enter":
        if (row !== undefined) openProperties(row);
        break;
      case " ":
        // กดค้างไม่ซ้ำ: การสั่งซ้ำรัว ๆ ด้วยค่าเก่าจะเขียนซ้อนกัน
        if (!e.repeat && row !== undefined && showToggles && hasToggle(row) && !row.hidden) void setShow(row, !(row.show ?? true));
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const handlers: RowHandlers = {
    onSelect: (row) => selectKey(row.key),
    onOpen: (row) => (row.kind === "group" ? setOpen(row.key, !row.expanded) : openProperties(row)),
    onToggleOpen: (row) => setOpen(row.key, !row.expanded),
    onShow: (row, show) => void setShow(row, show),
    onColor: (row, color) => void setColor(row, color),
  };

  const groups = useMemo(() => allRows.filter((row) => row.kind === "group").map((row) => row.name), [allRows]);
  const nothingFlagged = flaggedOnly && rows.length <= 1;

  return (
    <TipProvider>
      <div className="ob" data-focus-scope={OBJECT_BROWSER_SCOPE}>
        <div className="toolbar ob-toolbar" role="toolbar" aria-label={t("window.objectBrowser")}>
          <ToolButton command="object.properties" label="ob.properties" icon={SlidersHorizontal} />
          <span className="toolbar-sep" aria-hidden="true" />
          <ToolButton command="ob.colorSelectors" label="ob.graphicsColorSelectors" icon={Palette} pressed={showColors} />
          <ToolButton command="ob.onOffToggles" label="ob.graphicsOnOffToggles" icon={SquareCheck} pressed={showToggles} />
          <span className="toolbar-sep" aria-hidden="true" />
          <ToolButton command="ob.newGroup" label="ob.newGroup" icon={FolderPlus} />
          <ToolButton command="edit.cut" label="ob.cut" icon={Scissors} />
          <ToolButton command="edit.copy" label="ob.copy" icon={Copy} />
          <ToolButton command="edit.paste" label="ob.paste" icon={ClipboardPaste} />
          <ToolButton command="object.delete" label="ob.delete" icon={Trash2} />
          <ToolButton command="edit.find" label="ob.find" icon={Search} />
          <span className="toolbar-sep" aria-hidden="true" />
          <ToolButton command="ob.expandAll" label="ob.expandAll" icon={ChevronsUpDown} />
          <ToolButton command="ob.collapseAll" label="ob.collapseAll" icon={ChevronsDownUp} />
        </div>
        {flaggedOnly && (
          <div className="ob-filter" role="status">
            <TriangleAlert size={12} aria-hidden="true" />
            <span className="ob-filter-text">{t("status.flaggedSatellites")}</span>
            {nothingFlagged && <span>{msg("ob.noFlagged")}</span>}
            <button
              type="button"
              className="tool-btn"
              aria-label={t("dialog.windows.close")}
              title={t("dialog.windows.close")}
              onClick={() => useObjectBrowser.setState({ flaggedOnly: false })}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="ob-body">
          <CommandContextMenu entries={OBJECT_MENU}>
            <div
              ref={scrollRef}
              className="ob-scroll"
              // คลิกขวาที่แถวไหน คำสั่งในเมนูทำกับแถวนั้น (ทำก่อนที่เมนูเปิด)
              onContextMenuCapture={(e) => {
                const key = (e.target as Element).closest("[data-row-key]")?.getAttribute("data-row-key");
                if (key != null) selectKey(key);
              }}
            >
              {tree === null ? (
                <p className="ob-empty">{msg("tooltip.noScenario")}</p>
              ) : (
                <div ref={listRef} className="ob-tree" role="tree" aria-label={t("window.objectBrowser")} style={{ height: virtualizer.getTotalSize() }} onKeyDown={onKeyDown}>
                  {virtualizer.getVirtualItems().map((item) => {
                    const row = rows[item.index];
                    if (row === undefined) return null;
                    return (
                      <TreeRow
                        key={row.key}
                        row={row}
                        top={item.start}
                        selected={row.key === selectedKey}
                        tabbable={row.key === tabKey}
                        showToggles={showToggles}
                        showColors={showColors}
                        busy={busy.has(row.key)}
                        {...handlers}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </CommandContextMenu>
          {findOpen && <FindDialog onFind={find} onClose={closeFind} focusToken={findToken} />}
        </div>
        <NewGroupDialog open={newGroupOpen} onClose={() => useObjectBrowser.setState({ newGroupOpen: false })} groups={groups} />
        <RenameDialog
          target={renaming}
          onClose={() => useObjectBrowser.setState({ renaming: null })}
          onRenamed={(target, newName) => {
            const oldPath = `*/${target.cls}/${target.name}`;
            if (useSelection.getState().activePath !== oldPath) return;
            const newPath = `*/${target.cls}/${newName}`;
            useSelection.getState().select(newPath);
            requestScroll(newPath);
          }}
        />
      </div>
    </TipProvider>
  );
}

/** ลงทะเบียน Object Browser เป็นหน้าต่างชนิด objectBrowser (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด และ persist/scenarioBound คงตามที่ลงไว้ใน layout/panels.ts ลงซ้ำได้ */
export function registerObjectBrowserPanel(): void {
  const base = getPanelDef("objectBrowser");
  if (base === undefined) throw new Error('panel kind "objectBrowser" is not registered');
  registerPanel("objectBrowser", { ...base, component: ObjectBrowser });
}
