// การจัดหน้าต่างของพื้นที่ทำงาน (spec §4): dockview + ทะเบียนหน้าต่าง + workbook.json
//
// - api = DockviewApi ของ <Workspace/> ที่ mount อยู่ (ยังไม่ mount = null; คำสั่งที่เปิด/ย้ายหน้าต่างโยน ส่วน closePanel/listWindows/restoreFor เงียบ)
// - ชนิดหน้าต่าง (Dockable / Integrated / Floating) อ่านจากตำแหน่งจริงใน dockview ไม่เก็บซ้ำ (ดู layout/placement.ts)
// - คำสั่งเมนู Window (Windows..., Cascade, Tile) เรียกผ่านที่นี่; เมนูบาร์มาในงานถัดไป
// - workbook (W6): toWorkbook / fromWorkbook / applyDefault / restoreFor(name) (เรียกหลัง useScenario.load สำเร็จ) / saveWorkbook (File → Save)
//   workbook เก็บเฉพาะหน้าต่างของพื้นที่ทำงาน (PanelDef.persist): หน้าต่างลอยและชั่วคราวไม่ถูกบันทึกพร้อม windowProps ของมัน และถูกข้ามตอนจัดกลับ
//   globe (ชั้นภาพและ asset ของ Cesium ion ของ Globe Manager) ใช้ร่วมกันทุกหน้าต่าง 3D และ Sensor View: workbook ที่ไม่มีช่องนี้และ layout ตั้งต้น = DEFAULT_GLOBE
//   เปิด scenario (fromWorkbook) = OpenStreetMap ซ่อนเสมอ และ asset ของ ion ที่ไม่มี/null = Google Maps Satellite (globeAtOpen) ไม่แตะ settings.json
//   restoreFor ที่ค้างอยู่ถูกทิ้งเมื่อ scenario ปิดหรือเปลี่ยนระหว่างรอ workbook (ไม่งั้นคำตอบเก่าแทนที่ทุกหน้าต่าง รวม Welcome ที่เพิ่งเปิด)
// - หน้าต่างที่มี Cesium ต้องแจ้ง viewer.resize() เมื่อ panel เปลี่ยนขนาด: ใช้ onPanelResize(id, cb) หรือ hook usePanelResize(panelId, cb)

import type { DockviewApi, DockviewIDisposable, IDockviewPanel } from "dockview-react";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { ApiError, apiGet, apiSend, errorText } from "../api/client";
import { msg } from "../labels/messages.th";
import { addNewPanel, applyDefaultLayout } from "../layout/defaultLayout";
import {
  DEFAULT_FLOAT_SIZE, getPanelDef, isPanelKind, nextGraphicsNumber, subscribePanels, UNKNOWN_PANEL,
  type GraphicsKind, type PanelKind, type PanelSize, type WindowType,
} from "../layout/panels";
import { cascadeIntegrated, centrePanel, moveToType, revealPanel, tileIntegrated, windowTypeOf, type MoveHints } from "../layout/placement";
import {
  DEFAULT_GLOBE, DEFAULT_TOOLBARS, WORKBOOK_MAX_BYTES, globeAtOpen, isIonAssetId, validateWorkbook, withoutPanels, workbookBytes,
  type GlobeLayerSetting, type GlobeSettings, type ToolbarName, type Toolbars, type Workbook, type WindowProps,
} from "../layout/workbook";
import { report } from "./messages";
import { useScenario } from "./scenario";

export type { ToolbarName, WindowType };

export interface WindowInfo {
  id: string;
  title: string;
  type: WindowType;
}

const enc = encodeURIComponent;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface LayoutState {
  /** DockviewApi ของ Workspace ที่ mount อยู่ */
  api: DockviewApi | null;
  /** เพิ่มทุกครั้งที่ชุดหน้าต่าง ตำแหน่ง หรือชื่ออาจเปลี่ยน: ให้ view (กล่อง Windows...) อ่าน listWindows() ใหม่ */
  revision: number;
  windowsDialogOpen: boolean;
  toolbars: Toolbars;
  /** ชื่อแถวที่ซ่อนใน Timeline View (งาน Timeline View เป็นเจ้าของ; ที่นี่เก็บและเขียนลง workbook) */
  timelineHidden: string[];
  /** ตั้งค่าเฉพาะหน้าต่างตาม panelId (งานหน้าต่าง 3D/2D เป็นเจ้าของ; ที่นี่เก็บและเขียนลง workbook) */
  windowProps: WindowProps;
  /** ชั้นภาพบนลูกโลกและ asset ของ Cesium ion (Globe Manager เป็นเจ้าของ; ที่นี่เก็บและเขียนลง workbook) ไม่แก้ตัวเดิม: เปลี่ยน = object ใหม่ */
  globe: GlobeSettings;
  /**
   * เวลา (performance.now) ที่ restoreFor ครั้งล่าสุดจัดหน้าต่างเสร็จ (workbook, layout ตั้งต้น หรือ layout ตั้งต้นเพราะ workbook ใช้ไม่ได้) null = กำลังรอ workbook
   * หรือยังไม่เคย หน้าต่าง 3D ที่ workbook สร้างใหม่โหลดเสร็จหลังเวลานี้เสมอ: test hook workbookRestoredAt ให้ e2e (waitForScene) ไม่อ่านหน้าต่างที่กำลังถูกแทน
   */
  restoredAt: number | null;

  attach(api: DockviewApi): void;
  /** ปล่อย api (ระบุ api = ปล่อยเฉพาะเมื่อยังเป็นตัวนี้ กัน Workspace รอบเก่าปล่อยตัวของรอบใหม่) */
  detach(api?: DockviewApi): void;

  /** เปิดหน้าต่างชนิดนั้นตามชนิดตั้งต้น คืน id; singleton ที่เปิดอยู่แล้วโฟกัสตัวเดิม */
  openPanel(kind: PanelKind, params?: Record<string, unknown>): string;
  closePanel(id: string): void;
  /** เปิดหน้าต่าง 3D หรือ 2D ใหม่ ("3D Graphics 2 - Earth") คืน id */
  newGraphicsWindow(kind: GraphicsKind): string;
  activatePanel(id: string): void;
  listWindows(): WindowInfo[];
  setType(id: string, type: WindowType): void;
  /** Center ในกล่อง Windows...: ย้ายหน้าต่างลอยมากลางพื้นที่ทำงาน */
  centerPanel(id: string): void;
  tile(direction: "horizontal" | "vertical"): void;
  cascade(): void;
  openWindowsDialog(): void;
  closeWindowsDialog(): void;
  onPanelResize(id: string, cb: (size: PanelSize) => void): () => void;

  setToolbar(name: ToolbarName, visible: boolean): void;
  setTimelineHidden(rows: string[]): void;
  setWindowProps(panelId: string, props: Record<string, unknown>): void;
  /** แก้ Show หรือ Translucency ของชั้นหนึ่ง (ชั้นที่ยังไม่มีในรายการเริ่มจากซ่อน โปร่งแสง 0) */
  setGlobeLayer(id: string, patch: Partial<GlobeLayerSetting>): void;
  /** asset ของ Cesium ion ที่แสดง (null = ไม่แสดง) ค่าที่ไม่ใช่จำนวนเต็ม > 0 ไม่เปลี่ยนอะไร */
  setGlobeIon(assetId: number | null): void;

  toWorkbook(): Workbook;
  /** สร้างหน้าต่างตาม workbook (ใช้ไม่ได้ = layout ตั้งต้นพร้อมข้อความเตือน) */
  fromWorkbook(w: unknown): void;
  /** layout ตั้งต้น + แถบเครื่องมือ/ตั้งค่าหน้าต่างตั้งต้น */
  applyDefault(): void;
  /** เปิด scenario: อ่าน workbook ของมันแล้ว fromWorkbook, ไม่มีหรืออ่านไม่ได้ = applyDefault */
  restoreFor(name: string): Promise<void>;
  /**
   * File → Save: PUT workbook (ไม่เกิน 1,048,576 ไบต์) ไปที่ scenario ที่เปิดอยู่
   * ล้มเหลวทุกแบบ (ไม่มี scenario ที่เปิด, พื้นที่ทำงานยังไม่ mount, ใหญ่เกิน, server ปฏิเสธ หรือต่อไม่ได้) = เพิ่มข้อความไทยใน Message Viewer แล้ว reject
   * ผู้เรียกจึงไม่ต้องแสดงข้อความซ้ำ
   */
  saveWorkbook(): Promise<void>;
}

/** id ที่ยังว่าง: ชื่อชนิดเองก่อน แล้ว `<ชนิด>-2`, `-3` ... */
function freeId(api: DockviewApi, kind: string): string {
  if (api.getPanel(kind) === undefined) return kind;
  for (let i = 2; ; i++) if (api.getPanel(`${kind}-${i}`) === undefined) return `${kind}-${i}`;
}

const isGraphics = (kind: string): kind is GraphicsKind => kind === "graphics3d" || kind === "graphics2d";

/** หน้าต่างชนิดนี้ไม่เก็บใน workbook (PanelDef.persist เป็น false); ชนิดที่ไม่รู้จักไม่ใช่ชั่วคราว (มีทางจัดการของมันเอง: ข้ามพร้อมคำเตือน) */
const isTransient = (kind: unknown): boolean => typeof kind === "string" && getPanelDef(kind)?.persist === false;

export const useLayout = create<LayoutState>()((set, get) => {
  let subscriptions: DockviewIDisposable[] = [];
  /** ผู้ฟัง params ของแต่ละหน้าต่าง (ชื่อหน้าต่างบางชนิดขึ้นกับ params) และผู้ฟังการลงทะเบียนซ้ำ */
  const watched = new Map<IDockviewPanel, DockviewIDisposable>();
  let unsubscribeRegistry: (() => void) | null = null;
  /** นับทุก restoreFor: คำตอบของครั้งที่ถูกครั้งใหม่กว่าแซง ทิ้ง */
  let restoreSeq = 0;
  // scenario ปิด (Close/Exit หรือถูกลบจากแท็บอื่น) หรือเปลี่ยนชื่อระหว่างรอ workbook: คำตอบที่ค้างอยู่เป็นของ scenario เดิม ทิ้งเช่นกัน
  // (store นี้มีอายุเท่าหน้าเว็บ จึงไม่ต้องเลิกฟัง)
  useScenario.subscribe((state, prev) => {
    if (state.name !== prev.name) restoreSeq++;
  });

  const need = (): DockviewApi => {
    const api = get().api;
    if (api === null) throw new Error("the workspace is not mounted");
    return api;
  };
  const bump = (): void => set((s) => ({ revision: s.revision + 1 }));
  /** File → Save ที่ทำไม่ได้: ข้อความไทยใน Message Viewer แล้ว reject ด้วยข้อความเดียวกัน (ผู้เรียกไม่ต้องแสดงซ้ำ) */
  const failSave = (code: string, text: string, ErrorType: new (message: string) => Error = Error): Promise<never> => {
    report("error", code, text);
    return Promise.reject(new ErrorType(text));
  };
  const forgetProps = (id: string): void => {
    if (Object.hasOwn(get().windowProps, id)) {
      const { [id]: _gone, ...rest } = get().windowProps;
      set({ windowProps: rest });
    }
  };
  /** ชื่อของหน้าต่างมาจากทะเบียนเสมอ (def.title(params)); ตั้งใหม่เฉพาะเมื่อต่างจากเดิม */
  const syncTitle = (panel: IDockviewPanel): void => {
    const title = getPanelDef(panel.api.component)?.title(panel.params);
    if (title !== undefined && panel.title !== title) panel.api.setTitle(title);
  };
  const syncAllTitles = (api: DockviewApi): void => {
    for (const panel of api.panels) syncTitle(panel);
  };
  /**
   * params ของหน้าต่างเปลี่ยนไม่ว่าใครสั่ง (openPanel หรือ panel.api.updateParameters ตรง ๆ) ให้ชื่อตามทัน
   * และชื่อเปลี่ยนอย่างเดียว (ตำแหน่งไม่เปลี่ยน ไม่มี onDidLayoutChange ให้ทันที) ต้อง bump revision เอง
   * ไม่งั้นรายชื่อหน้าต่าง (เมนู Window, กล่อง Windows...) แสดงชื่อเก่าค้าง
   */
  const watch = (panel: IDockviewPanel): void => {
    if (watched.has(panel)) return;
    const params = panel.api.onDidParametersChange(() => syncTitle(panel));
    const title = panel.api.onDidTitleChange(bump);
    watched.set(panel, { dispose: () => { params.dispose(); title.dispose(); } });
  };
  /** ย้ายหน้าต่างทำให้ dockview ส่ง add/remove ซ้ำ ๆ: เลิกฟังเมื่อหน้าต่างหายจาก api จริงเท่านั้น */
  const unwatch = (api: DockviewApi, panel: IDockviewPanel): void => {
    if (api.getPanel(panel.id) === panel) return;
    watched.get(panel)?.dispose();
    watched.delete(panel);
  };
  const moveHints = (kind: string): MoveHints => {
    const def = getPanelDef(kind);
    return { edge: def?.edge ?? "bottom", size: def?.size ?? DEFAULT_FLOAT_SIZE };
  };

  return {
    api: null,
    revision: 0,
    windowsDialogOpen: false,
    toolbars: { ...DEFAULT_TOOLBARS },
    timelineHidden: [],
    windowProps: {},
    globe: DEFAULT_GLOBE,
    restoredAt: null,

    attach: (api) => {
      get().detach();
      subscriptions = [
        api.onDidLayoutChange(bump),
        api.onDidAddPanel((panel) => {
          watch(panel);
          bump();
        }),
        api.onDidRemovePanel((panel) => {
          unwatch(api, panel);
          bump();
        }),
      ];
      api.panels.forEach(watch);
      unsubscribeRegistry = subscribePanels(() => syncAllTitles(api)); // registerPanel ซ้ำ = ชื่อของหน้าต่างที่เปิดอยู่เปลี่ยนตาม
      set({ api });
      bump();
    },

    detach: (api) => {
      if (api !== undefined && get().api !== api) return;
      for (const s of subscriptions) s.dispose();
      subscriptions = [];
      for (const w of watched.values()) w.dispose();
      watched.clear();
      unsubscribeRegistry?.();
      unsubscribeRegistry = null;
      set({ api: null });
    },

    openPanel: (kind, params = {}) => {
      const api = need();
      const def = getPanelDef(kind);
      if (def === undefined) throw new Error(`unknown panel kind "${kind}"`);
      if (def.singleton) {
        // บานเดียวต่อชนิด หรือบานเดียวต่อกุญแจถ้าชนิดนั้นมี instanceKey (Properties Browser: หนึ่งบานต่อ object)
        const key = def.instanceKey?.(params);
        const existing = api.panels.find((p) => p.api.component === kind && (key === undefined || def.instanceKey?.(p.params) === key));
        if (existing !== undefined) {
          if (Object.keys(params).length > 0) {
            existing.api.updateParameters(params); // params ใหม่ไปถึงหน้าต่างเดิม (รวมกับของเดิม) แล้วชื่อตามถ้าขึ้นกับ params
            syncTitle(existing);
          }
          revealPanel(api, existing);
          return existing.id;
        }
      }
      // หน้าต่าง 3D/2D ใหม่ได้เลขที่ว่างน้อยสุดเสมอ (ผู้เรียกไม่ต้องคำนวณ)
      const full = isGraphics(kind) && typeof params.n !== "number"
        ? { ...params, n: nextGraphicsNumber(api.panels.map((p) => p.title ?? ""), kind) }
        : params;
      const id = freeId(api, kind);
      forgetProps(id); // id ที่เคยเป็นของหน้าต่างที่ปิดไปแล้ว (ปิดจากปุ่ม X ของแท็บ) ไม่สืบทอดค่าตั้งของมัน
      const panel = addNewPanel(api, kind, id, full);
      panel.api.setActive();
      bump();
      return id;
    },

    closePanel: (id) => {
      const api = get().api;
      const panel = api?.getPanel(id);
      if (api === null || panel === undefined) return;
      api.removePanel(panel);
      forgetProps(id);
      bump();
    },

    newGraphicsWindow: (kind) => get().openPanel(kind),

    activatePanel: (id) => {
      const api = get().api;
      const panel = api?.getPanel(id);
      if (api !== null && panel !== undefined) revealPanel(api, panel);
    },

    listWindows: () => get().api?.panels.map((p) => ({ id: p.id, title: p.title ?? p.id, type: windowTypeOf(p) })) ?? [],

    setType: (id, type) => {
      const api = get().api;
      const panel = api?.getPanel(id);
      if (api === null || panel === undefined) return;
      moveToType(api, panel, type, moveHints(panel.api.component));
      bump();
    },

    centerPanel: (id) => {
      const api = get().api;
      const panel = api?.getPanel(id);
      if (api === null || panel === undefined) return;
      centrePanel(api, panel, moveHints(panel.api.component));
      bump();
    },

    tile: (direction) => {
      tileIntegrated(need(), direction);
      bump();
    },

    cascade: () => {
      cascadeIntegrated(need());
      bump();
    },

    openWindowsDialog: () => set({ windowsDialogOpen: true }),
    closeWindowsDialog: () => set({ windowsDialogOpen: false }),

    onPanelResize: (id, cb) => {
      const panel = get().api?.getPanel(id);
      if (panel === undefined) return () => undefined;
      const resized = panel.api.onDidDimensionsChange((e) => cb({ width: e.width, height: e.height }));
      // แท็บที่ถูกซ่อนไม่ได้รับขนาดใหม่ เมื่อกลับมาแสดงต้องวัดใหม่
      const shown = panel.api.onDidVisibilityChange((e) => {
        if (e.isVisible) cb({ width: panel.api.width, height: panel.api.height });
      });
      return () => {
        resized.dispose();
        shown.dispose();
      };
    },

    setToolbar: (name, visible) => set((s) => ({ toolbars: { ...s.toolbars, [name]: visible } })),
    setTimelineHidden: (rows) => set({ timelineHidden: [...rows] }),
    setWindowProps: (panelId, props) => set((s) => ({ windowProps: { ...s.windowProps, [panelId]: props } })),
    setGlobeLayer: (id, patch) =>
      set((s) => {
        const before = s.globe.layers[id] ?? { show: false, translucency: 0 };
        return { globe: { ...s.globe, layers: { ...s.globe.layers, [id]: { ...before, ...patch } } } };
      }),
    setGlobeIon: (assetId) => {
      if (assetId !== null && !isIonAssetId(assetId)) return;
      set((s) => ({ globe: { ...s.globe, ion: { assetId } } }));
    },

    toWorkbook: () => {
      const api = need();
      const s = get();
      // เฉพาะหน้าต่างของพื้นที่ทำงาน: หน้าต่างชั่วคราวที่เปิดอยู่ตอนนี้ไม่เข้าไฟล์ (ทั้งใน dockview, panels และ windowProps)
      const drop = new Set(api.panels.filter((p) => isTransient(p.api.component)).map((p) => p.id));
      return {
        version: 1,
        dockview: withoutPanels(api.toJSON() as unknown as Record<string, unknown>, drop),
        panels: Object.fromEntries(
          api.panels.filter((p) => !drop.has(p.id)).map((p) => [p.id, { kind: p.api.component, params: clone(p.params ?? {}) }]),
        ),
        toolbars: { ...s.toolbars },
        timelineHidden: [...s.timelineHidden],
        windowProps: Object.fromEntries(Object.entries(clone(s.windowProps)).filter(([id]) => !drop.has(id))),
        globe: clone(s.globe),
      };
    },

    applyDefault: () => {
      applyDefaultLayout(need());
      set({ toolbars: { ...DEFAULT_TOOLBARS }, timelineHidden: [], windowProps: {}, globe: DEFAULT_GLOBE });
      bump();
    },

    fromWorkbook: (raw) => {
      const api = need();
      const w = validateWorkbook(raw);
      if (w === null) {
        report("warning", "WORKBOOK_INVALID", msg("workbook.invalid"));
        get().applyDefault();
        return;
      }
      // หน้าต่างชนิดที่ไม่รู้จัก (ทั้งที่ dockview หรือรายการ panels ของ workbook ระบุ): ให้ dockview สร้างเป็นตัวว่างก่อน แล้วลบทิ้ง
      // dockview จึงจัดกลุ่มและขนาดที่เหลือให้เอง (ตัดจาก JSON เองต้องคำนวณสัดส่วนใหม่)
      const layout = clone(w.dockview);
      const entries = isRecord(layout.panels) ? layout.panels : {};
      const unknownIds: string[] = [];
      const unknownKinds = new Set<string>();
      // หน้าต่างชั่วคราว (workbook เก่าที่เก็บ Welcome ฯลฯ ไว้): ข้ามเงียบ ๆ ด้วยวิธีเดียวกัน (ไม่มีคำเตือน เพราะไม่ใช่ความผิดของไฟล์)
      const skipIds: string[] = [];
      for (const [id, entry] of Object.entries(entries)) {
        if (!isRecord(entry)) continue;
        const kinds = [entry.contentComponent, w.panels[id]?.kind];
        const bad = kinds.find((k) => k !== undefined && !isPanelKind(k));
        if (bad !== undefined) {
          unknownIds.push(id);
          unknownKinds.add(String(bad));
          entry.contentComponent = UNKNOWN_PANEL;
        } else if (kinds.some(isTransient)) {
          skipIds.push(id);
          entry.contentComponent = UNKNOWN_PANEL;
        }
      }
      const droppedIds = new Set([...skipIds, ...Object.entries(w.panels).filter(([, p]) => isTransient(p.kind)).map(([id]) => id)]);
      try {
        api.fromJSON(layout as unknown as Parameters<DockviewApi["fromJSON"]>[0]);
      } catch (e) {
        report("warning", "WORKBOOK_RESTORE_FAILED", msg("workbook.restoreFailed", { message: errorText(e) }));
        get().applyDefault();
        return;
      }
      for (const id of [...unknownIds, ...skipIds]) {
        const panel = api.getPanel(id);
        if (panel !== undefined) api.removePanel(panel);
      }
      // กลุ่มในกริดกลางที่ว่าง (workbook ที่บันทึกตอนหน้าต่างชั่วคราวอยู่ในกลุ่มของมันเอง): ลบให้ dockview ขยายกลุ่มข้างเคียงแทน
      for (const group of [...api.groups]) {
        if (group.panels.length === 0 && group.api.location.type === "grid") api.removeGroup(group);
      }
      for (const kind of unknownKinds) report("warning", "WORKBOOK_UNKNOWN_KIND", msg("workbook.unknownKind", { kind }));
      // ชื่อหน้าต่างมาจากตารางชื่อเสมอ (ไม่ใช้ชื่อที่เก็บไว้ในไฟล์ ซึ่งอาจเป็นชื่อของรุ่นเก่า)
      syncAllTitles(api);
      set({
        toolbars: w.toolbars,
        timelineHidden: w.timelineHidden,
        windowProps: Object.fromEntries(Object.entries(w.windowProps).filter(([id]) => !droppedIds.has(id))),
        globe: globeAtOpen(w.globe ?? DEFAULT_GLOBE),
      });
      bump();
    },

    restoreFor: async (name) => {
      if (get().api === null) return;
      const seq = ++restoreSeq;
      set({ restoredAt: null });
      const settled = (): void => set({ restoredAt: performance.now() });
      let data: unknown;
      try {
        ({ data } = await apiGet<unknown>(`/scenarios/${enc(name)}/workbook`));
      } catch (e) {
        if (seq !== restoreSeq || get().api === null) return;
        report("warning", e instanceof ApiError ? e.code : "WORKBOOK_LOAD", msg("workbook.loadFailed", { name, message: errorText(e) }));
        get().applyDefault();
        settled();
        return;
      }
      if (seq !== restoreSeq || get().api === null) return; // เปิด scenario อื่นต่อหรือปิดหน้าไปแล้ว (ครั้งใหม่กว่าตั้ง restoredAt เอง)
      if (data === null || data === undefined) get().applyDefault();
      else get().fromWorkbook(data);
      settled();
    },

    saveWorkbook: async () => {
      const name = useScenario.getState().name;
      if (name === null) return failSave("WORKBOOK_NO_SCENARIO", msg("workbook.noScenario"));
      if (get().api === null) return failSave("WORKBOOK_NO_WORKSPACE", msg("workbook.noWorkspace"));
      const workbook = get().toWorkbook();
      if (workbookBytes(workbook) > WORKBOOK_MAX_BYTES) {
        return failSave("WORKBOOK_TOO_LARGE", msg("workbook.tooLarge"), RangeError);
      }
      try {
        await apiSend("PUT", `/scenarios/${enc(name)}/workbook`, workbook); // ไม่ต้องใช้ If-Match (ไม่ใช่ตัว scenario)
      } catch (e) {
        report("error", e instanceof ApiError ? e.code : "WORKBOOK_SAVE", msg("workbook.saveFailed", { message: errorText(e) }));
        throw e;
      }
    },
  };
});

/** ใช้ในหน้าต่างที่มี viewer (Cesium): cb ถูกเรียกเมื่อ panel เปลี่ยนขนาดหรือกลับมาแสดง ให้เรียก viewer.resize() */
export function usePanelResize(panelId: string, cb: (size: PanelSize) => void): void {
  const latest = useRef(cb);
  latest.current = cb;
  useEffect(() => useLayout.getState().onPanelResize(panelId, (size) => latest.current(size)), [panelId]);
}
