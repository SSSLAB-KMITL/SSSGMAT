// Object Browser (spec §7, STK ref §B): ต้นไม้ของ object ใน scenario ที่เปิดอยู่
// - แต่ละแถว: ลูกศรพับ, ช่องติ๊ก Show, กล่องสี, ไอคอนชนิด (Lucide), ชื่อ, ⚠ เมื่อดาวมีธง (W9); tooltip ของดาวบอก PRN SVN NORAD Block ชื่อ CelesTrak อายุข้อมูล และธงเป็นภาษาไทย
//   โฟลเดอร์กลุ่มไม่มีช่องติ๊กและกล่องสี เลือกได้ (ไว้วางดาวที่ตัด) แต่เปิด Properties ไม่ได้
// - วาดแบบ virtual list (TanStack Virtual) ต้นไม้ 130+ แถวมีใน DOM เฉพาะที่อยู่ใกล้พื้นที่เห็น
// - คำสั่งทั้งหมดลงทะเบียนตอนหน้าต่างเปิด (W3) และถอนตอนปิด: edit.cut/copy/paste/delete/find, object.properties/rename/delete, ob.*
//   enabled() อ่านสถานะล่าสุดผ่าน ref ที่เขียนทุกครั้งที่วาด และเรียก invalidateCommands() เมื่อการเลือก คลิปบอร์ด หรือต้นไม้เปลี่ยน
//   object.zoomTo เป็นของหน้าต่าง 3D; object.access / object.reportGraphManager ยังไม่ทำ (รายการเมนูจึงปิดใช้อยู่)
// - การเลือก: sync กับ useSelection.activePath (คลิกแถว = เลือก, เลือกจากที่อื่น = แถวนี้ถูกไฮไลต์และเปิดโฟลเดอร์ที่พับครอบอยู่) โฟลเดอร์ไม่ใช่ object จึงเลือกแล้ว activePath = null
// - การเขียนทุกอย่างผ่านเมธอดของ useScenario ข้อผิดพลาดลง Message Viewer (writes.ts) ยกเว้น 412 ที่มีกล่องของตัวเอง
// - ขนาดแถวและเยื้องเป็นค่าคงที่ที่ virtual list ต้องรู้ จึงอยู่ที่นี่และใส่เป็น inline style ส่วนสีและฟอนต์อยู่ใน theme.css

import { useVirtualizer, type Rect, type Virtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ClipboardPaste, Copy, Folder, FolderOpen, FolderPlus, Globe, MapPin, Orbit, Palette, Satellite,
  Scissors, Search, SlidersHorizontal, SquareCheck, Trash2, TriangleAlert, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CommandContextMenu } from "../../chrome/ContextMenu";
import { confirm } from "../../chrome/Dialogs";
import { OBJECT_MENU } from "../../chrome/menus";
import { Tip, TipProvider } from "../../chrome/Tip";
import { ToolButton } from "../../chrome/ToolButton";
import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../../commands";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { OBJECT_BROWSER_SCOPE } from "../../shortcuts";
import { useLayout } from "../../stores/layout";
import { useScenario, type ObjectPages } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { copyName, useClipboard } from "./clipboard";
import { FindDialog } from "./FindDialog";
import { NewGroupDialog } from "./NewGroupDialog";
import { RenameDialog, type RenameTarget } from "./RenameDialog";
import { expandableKeys, findMatches, flattenTree, type Row, type RowClass } from "./tree";
import { attempt } from "./writes";

const ROW_HEIGHT = 22;
const INDENT = 14;
/** ขนาดพื้นที่เห็นที่ใช้เมื่อยังวัดไม่ได้ (วัดได้ 0: ยังไม่มี layout เช่นหน้าต่างเพิ่งสร้าง หรือ jsdom) = ขนาดตั้งต้นของหน้าต่าง */
const FALLBACK_RECT: Rect = { width: 320, height: 520 };

/**
 * วัดพื้นที่เห็นของ virtual list เหมือนตัววัดมาตรฐานของ TanStack Virtual (clientWidth/clientHeight และตามเมื่อขนาดเปลี่ยน) ต่างตรงที่ขนาด 0 ใช้ FALLBACK_RECT
 * ไม่งั้นรายการว่างทั้งที่มีแถว: แถวที่เกินพื้นที่จริงถูกตัดโดย overflow อยู่แล้ว และเมื่อวัดได้จริงค่านั้นแทนที่ทันที
 */
function observeViewport(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: Rect) => void): (() => void) | void {
  const element = instance.scrollElement;
  const view = instance.targetWindow;
  if (element === null || view === null) return;
  const measure = (): void => cb(element.clientHeight > 0 ? { width: element.clientWidth, height: element.clientHeight } : FALLBACK_RECT);
  measure();
  if (!view.ResizeObserver) return;
  const observer = new view.ResizeObserver(measure);
  observer.observe(element, { box: "content-box" });
  return () => observer.unobserve(element);
}

const CLASS_ICONS: Record<RowClass, LucideIcon> = { Scenario: Globe, Facility: MapPin, Constellation: Orbit, Satellite };

const hasToggle = (row: Row): boolean => row.kind === "object" && row.cls !== undefined && row.cls !== "Scenario";
/** Facility, Constellation, Satellite: เปลี่ยนชื่อ ลบ และเลือกสีได้ */
const isEditable = (row: Row | undefined): row is Row & { cls: Exclude<RowClass, "Scenario">; path: string } => row !== undefined && hasToggle(row);
const isSatellite = (row: Row | undefined): row is Row & { path: string } => row?.kind === "object" && row.cls === "Satellite";

const showPages = (show: boolean): ObjectPages => ({ graphics2d: { show }, graphics3d: { show } });
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
}

function TreeRow({ row, top, selected, tabbable, showToggles, showColors, onSelect, onOpen, onToggleOpen, onShow, onColor }: TreeRowProps) {
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
            disabled={row.hidden}
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

/** สถานะล่าสุดที่คำสั่ง (ลงทะเบียนครั้งเดียว) ต้องอ่าน: เขียนทุกครั้งที่วาด */
interface Latest {
  hasTree: boolean;
  selectedRow: Row | undefined;
  openProperties(row: Row): void;
  rename(target: RenameTarget): void;
  deleteRow(row: Row): Promise<void>;
  copyRow(mode: "cut" | "copy", row: Row): void;
  paste(): Promise<void>;
  openFind(): void;
  openNewGroup(): void;
  expandAll(): void;
  collapseAll(): void;
  toggleColors(): void;
  toggleToggles(): void;
  toggleFlagged(): void;
}

export function ObjectBrowser(_props: Partial<PanelProps>) {
  const tree = useScenario((s) => s.tree);
  // flattenTree ตอบจากสามอย่างนี้: doc (NORAD, สมาชิก, ตัวกรอง), catalog (ธง) และ tree
  const doc = useScenario((s) => s.doc);
  const catalog = useScenario((s) => s.catalog);
  const activePath = useSelection((s) => s.activePath);
  const clipboard = useClipboard((s) => s.content);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [groupKeySelected, setGroupKeySelected] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [showColors, setShowColors] = useState(true);
  const [showToggles, setShowToggles] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [findToken, setFindToken] = useState(0);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<string | null>(null);
  const findAnchor = useRef<{ query: string; key: string } | null>(null);

  // ---------- แถว ----------
  const allKeys = useMemo(() => new Set(tree === null ? [] : expandableKeys(tree)), [tree]);
  const expanded = useMemo(() => new Set([...allKeys].filter((key) => !collapsed.has(key))), [allKeys, collapsed]);
  /** ทุกโหนดเปิดหมด: ไว้หาแถวที่เลือกอยู่แม้โฟลเดอร์พับ และให้คำสั่งวางใช้สมาชิกครบของโฟลเดอร์ */
  const allRows = useMemo(() => (tree === null ? [] : flattenTree(tree, allKeys)), [tree, doc, catalog, allKeys]);
  const rowByKey = useMemo(() => new Map(allRows.map((row) => [row.key, row])), [allRows]);
  const rows = useMemo(() => (tree === null ? [] : flattenTree(tree, expanded, { flaggedOnly })), [tree, doc, catalog, expanded, flaggedOnly]);

  const selectedKey = groupKeySelected ?? activePath;
  const selectedRow = selectedKey === null ? undefined : rowByKey.get(selectedKey);
  const tabKey = rows.some((row) => row.key === selectedKey) ? selectedKey : rows[0]?.key;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeViewport,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  // ---------- การเลือกและการพับ ----------
  const selectKey = (key: string): void => {
    const row = rowByKey.get(key);
    if (row === undefined) return;
    if (row.kind === "group") {
      setGroupKeySelected(row.key);
      useSelection.getState().select(null);
    } else {
      setGroupKeySelected(null);
      useSelection.getState().select(row.path ?? null);
    }
  };

  const setOpen = (key: string, open: boolean): void =>
    setCollapsed((prev) => {
      if (prev.has(key) === !open) return prev;
      const next = new Set(prev);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });

  /** เปิดโฟลเดอร์ที่พับครอบแถวนี้อยู่ */
  const reveal = (key: string): void => {
    const ancestors: string[] = [];
    for (let parent = rowByKey.get(key)?.parentKey ?? null; parent !== null; parent = rowByKey.get(parent)?.parentKey ?? null) ancestors.push(parent);
    setCollapsed((prev) => (ancestors.some((k) => prev.has(k)) ? new Set([...prev].filter((k) => !ancestors.includes(k))) : prev));
  };

  // scenario อื่น = ต้นไม้คนละต้น: เริ่มขยายทั้งหมด ไม่กรอง และไม่ค้างการเลือกโฟลเดอร์ (ที่ตั้งค่าคอลัมน์เป็นของผู้ใช้ จึงไม่รีเซ็ต)
  const scenarioName = useScenario((s) => s.name);
  useEffect(() => {
    setCollapsed((prev) => (prev.size === 0 ? prev : new Set()));
    setGroupKeySelected(null);
    setFlaggedOnly(false);
    setScrollTarget(null);
    findAnchor.current = null;
  }, [scenarioName]);

  // เลือกจากที่อื่น (หรือกลับมาที่ Object Browser ที่มีการเลือกอยู่แล้ว) = ไม่ใช่โฟลเดอร์แล้ว, เปิดโฟลเดอร์ที่ครอบ, เลื่อนมาให้เห็น
  useEffect(() => {
    if (activePath !== null) setGroupKeySelected(null);
  }, [activePath]);
  useEffect(() => {
    if (selectedKey === null || !rowByKey.has(selectedKey)) return;
    reveal(selectedKey);
    setScrollTarget(selectedKey);
  }, [selectedKey]);

  // เลื่อนไปที่แถวเมื่อแถวนั้นอยู่ในรายการที่เห็น (เพิ่งเปิดโฟลเดอร์ หรือเพิ่งสร้าง/เปลี่ยนชื่อและต้นไม้ยังไม่มา = รอรอบถัดไป)
  useEffect(() => {
    if (scrollTarget === null) return;
    const index = rows.findIndex((row) => row.key === scrollTarget);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
    setScrollTarget(null);
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

  // ---------- การกระทำ ----------
  const openProperties = (row: Row): void => {
    if (row.kind === "object") useLayout.getState().openPanel("propertiesBrowser", { path: row.path, name: row.name });
  };

  const setShow = async (row: Row, show: boolean): Promise<void> => {
    if (!isEditable(row)) return;
    if (row.cls === "Constellation") {
      // Constellation ไม่มีหน้ากราฟิก: ตั้ง show ของดาวสมาชิกทีละดวง (ดวงที่ซ่อนติ๊กไม่ได้ และดวงที่เป็นค่านั้นอยู่แล้วไม่ต้องเขียน) หยุดที่ดวงแรกที่ล้มเหลว
      for (const path of row.members ?? []) {
        const member = rowByKey.get(path);
        if (member === undefined || member.hidden || member.show === show) continue;
        const done = await attempt(() => useScenario.getState().patchObject("Satellite", member.name, showPages(show)), path);
        if (!done.ok) return;
      }
      return;
    }
    await attempt(() => useScenario.getState().patchObject(row.cls, row.name, showPages(show)), row.path);
  };

  const setColor = async (row: Row, color: string): Promise<void> => {
    if (!isEditable(row)) return;
    // Constellation มีสีของตัวเอง (สมาชิกที่ inherit ตาม) ส่วน Facility และ Satellite ตั้งสีที่หน้า 2D Graphics และเลิก inherit
    const pages: ObjectPages = row.cls === "Constellation" ? { basic: { color } } : { graphics2d: { color, inherit: false } };
    await attempt(() => useScenario.getState().patchObject(row.cls, row.name, pages), row.path);
  };

  const deleteRow = async (row: Row): Promise<void> => {
    if (!isEditable(row)) return;
    if (!(await confirm(msg("confirm.delete", { name: row.name })))) return;
    const done = await attempt(() => useScenario.getState().remove(row.cls, row.name), row.path);
    if (done.ok && useSelection.getState().activePath === row.path) useSelection.getState().select(null);
  };

  const paste = async (): Promise<void> => {
    const content = useClipboard.getState().content;
    const store = useScenario.getState();
    if (content === null || content.paths.length === 0) return;
    if (content.mode === "copy") {
      const objects = store.doc?.objects ?? [];
      const taken = new Set(objects.map((o) => o.name));
      let created: string | undefined;
      for (const path of content.paths) {
        const source = objects.find((o) => o.class === "Satellite" && `*/Satellite/${o.name}` === path);
        if (source === undefined || source.class !== "Satellite") continue; // ดาวที่คัดลอกไว้ถูกลบไปแล้ว
        const name = copyName(source.name, taken);
        taken.add(name);
        const done = await attempt(() => store.insert({ class: "Satellite", method: "Define Properties", name, norad: source.norad }), `*/Satellite/${name}`);
        if (!done.ok) return;
        created = done.value[0] ?? created;
      }
      if (created !== undefined) {
        setGroupKeySelected(null);
        useSelection.getState().select(created);
        setScrollTarget(created);
      }
      return;
    }
    const target = selectedRow;
    if (target?.kind !== "group") return;
    const present = new Set(allRows.filter((row) => row.cls === "Satellite").map((row) => row.path));
    const moving = content.paths.filter((path) => present.has(path)); // ดาวที่ตัดไว้แล้วถูกลบหรือเปลี่ยนชื่อไปแล้วไม่ย้าย
    if (moving.length === 0) {
      useClipboard.getState().clear();
      return;
    }
    // ย้ายดาวเข้ากลุ่ม = ตั้งสมาชิกของกลุ่มใหม่ทั้งหมด (server ตั้งสมาชิกตรงตัว และดึงดาวออกจากกลุ่มอื่นเอง)
    const members = [...new Set([...(target.members ?? []), ...moving])];
    const done = await attempt(() => store.setGroup(target.name, members));
    if (done.ok) useClipboard.getState().clear();
  };

  const find = (query: string, direction: 1 | -1): boolean => {
    if (tree === null) return false;
    const matches = findMatches(flattenTree(tree, allKeys, { flaggedOnly }), query);
    if (matches.length === 0) return false;
    const anchor = findAnchor.current;
    const at = anchor !== null && anchor.query === query ? matches.findIndex((row) => row.key === anchor.key) : -1;
    const next = at < 0 ? (direction === 1 ? matches[0] : matches[matches.length - 1]) : matches[(at + direction + matches.length) % matches.length];
    findAnchor.current = { query, key: next.key };
    selectKey(next.key);
    reveal(next.key);
    setScrollTarget(next.key);
    return true;
  };

  const closeFind = (): void => {
    setFindOpen(false);
    focusRequest.current = tabKey ?? null;
  };

  // ---------- คำสั่ง ----------
  const latest = useRef<Latest>(null as never);
  latest.current = {
    hasTree: tree !== null,
    selectedRow,
    openProperties,
    rename: setRenaming,
    deleteRow,
    copyRow: (mode, row) => {
      if (isSatellite(row)) useClipboard.getState().set(mode, [row.path]);
    },
    paste,
    openFind: () => {
      setFindOpen(true);
      setFindToken((n) => n + 1);
    },
    openNewGroup: () => setNewGroupOpen(true),
    expandAll: () => setCollapsed(new Set()),
    collapseAll: () => setCollapsed(new Set(allKeys)),
    toggleColors: () => setShowColors((v) => !v),
    toggleToggles: () => setShowToggles((v) => !v),
    toggleFlagged: () => setFlaggedOnly((v) => !v),
  };

  useEffect(() => {
    const disposers: (() => void)[] = [];
    const add = (id: CommandId, def: Omit<CommandDef, "label">): void => {
      disposers.push(registerCommand(id, { label: COMMAND_LABELS[id], ...def }));
    };
    const L = (): Latest => latest.current;
    const sel = (): Row | undefined => L().selectedRow;
    const withTree = (): boolean => L().hasTree;
    const noTree = (): string | undefined => (L().hasTree ? undefined : msg("tooltip.noScenario"));

    /** เหตุที่ใช้กับแถวที่เลือกไม่ได้ (undefined = ใช้ได้) */
    const needsEditable = (): string | undefined => {
      const row = sel();
      if (row === undefined) return msg("ob.selectObject");
      if (row.kind === "group") return msg("ob.groupUnsupported");
      return isEditable(row) ? undefined : msg("ob.rootUnsupported");
    };
    const needsSatellite = (): string | undefined => (sel() === undefined ? msg("ob.selectObject") : isSatellite(sel()) ? undefined : msg("ob.satelliteOnly"));
    const pasteBlock = (): string | undefined => {
      if (!L().hasTree) return msg("tooltip.noScenario");
      const content = useClipboard.getState().content;
      if (content === null) return msg("ob.nothingToPaste");
      return content.mode === "cut" && sel()?.kind !== "group" ? msg("ob.pasteNeedsFolder") : undefined;
    };
    const deleteIt = (): void => {
      const row = sel();
      if (row !== undefined) void L().deleteRow(row);
    };

    add("object.properties", {
      run: () => {
        const row = sel();
        if (row !== undefined) L().openProperties(row);
      },
      enabled: () => sel()?.kind === "object",
      tooltip: () => (sel()?.kind === "object" ? undefined : msg("ob.selectObject")),
    });
    add("object.rename", {
      run: () => {
        const row = sel();
        if (isEditable(row)) L().rename({ cls: row.cls, name: row.name });
      },
      enabled: () => isEditable(sel()),
      tooltip: needsEditable,
    });
    add("object.delete", { run: deleteIt, enabled: () => isEditable(sel()), tooltip: needsEditable });
    add("edit.delete", { run: deleteIt, enabled: () => isEditable(sel()), tooltip: needsEditable });
    add("edit.cut", {
      run: () => {
        const row = sel();
        if (row !== undefined) L().copyRow("cut", row);
      },
      enabled: () => isSatellite(sel()),
      tooltip: needsSatellite,
    });
    add("edit.copy", {
      run: () => {
        const row = sel();
        if (row !== undefined) L().copyRow("copy", row);
      },
      enabled: () => isSatellite(sel()),
      tooltip: needsSatellite,
    });
    add("edit.paste", { run: () => void L().paste(), enabled: () => pasteBlock() === undefined, tooltip: pasteBlock });
    add("edit.find", { run: () => L().openFind(), enabled: withTree, tooltip: noTree });
    add("ob.newGroup", { run: () => L().openNewGroup(), enabled: withTree, tooltip: noTree });
    add("ob.expandAll", { run: () => L().expandAll(), enabled: withTree, tooltip: noTree });
    add("ob.collapseAll", { run: () => L().collapseAll(), enabled: withTree, tooltip: noTree });
    add("ob.colorSelectors", { run: () => L().toggleColors() });
    add("ob.onOffToggles", { run: () => L().toggleToggles() });
    add("ob.showFlagged", { run: () => L().toggleFlagged(), enabled: withTree, tooltip: noTree });
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, []);

  // enabled() ขึ้นกับการเลือก คลิปบอร์ด และต้นไม้ ซึ่งทะเบียนไม่รู้ว่าเปลี่ยน: ให้เมนูและแถบเครื่องมือวาดสถานะใหม่
  useEffect(() => {
    invalidateCommands();
  }, [selectedKey, selectedRow, clipboard, tree !== null]);

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
        if (row !== undefined && showToggles && hasToggle(row) && !row.hidden) void setShow(row, !(row.show ?? true));
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
            <button type="button" className="tool-btn" aria-label={t("dialog.windows.close")} title={t("dialog.windows.close")} onClick={() => setFlaggedOnly(false)}>
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
        <NewGroupDialog open={newGroupOpen} onClose={() => setNewGroupOpen(false)} groups={groups} />
        <RenameDialog
          target={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(target, newName) => {
            const oldPath = `*/${target.cls}/${target.name}`;
            if (useSelection.getState().activePath !== oldPath) return;
            const newPath = `*/${target.cls}/${newName}`;
            useSelection.getState().select(newPath);
            setScrollTarget(newPath);
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
