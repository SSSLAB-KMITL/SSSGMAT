// พื้นที่ทำงานของแอป (spec §4): dockview + ทะเบียนหน้าต่าง
//   [ header  ]  ช่องเมนูบาร์และแถบเครื่องมือ (App ใส่ HealthBanner + MenuBar + Toolbars)
//   [ dockview ] หน้าต่างทั้งหมด
//   [ footer  ]  ช่องแถบสถานะ (App ใส่ StatusBar)
// หน้าต่างแต่ละบานวาดจากทะเบียน (layout/panels.ts) ตอน render จึงแทนที่ด้วยของจริงได้โดยลงทะเบียนซ้ำ

import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type GetTabContextMenuItemsParams,
  type IDockviewPanelProps,
  type ReactContextMenuItemConfig,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useCallback, useEffect, useRef, useSyncExternalStore, type FC, type ReactNode } from "react";
import { WindowsDialog } from "./chrome/WindowsDialog";
import { t } from "./labels/labels";
import { getPanelDef, isPanelKind, PANEL_KINDS, panelRegistryVersion, subscribePanels, UNKNOWN_PANEL, type WindowType } from "./layout/panels";
import { windowTypeOf } from "./layout/placement";
import { useLayout } from "./stores/layout";

/** สีและขนาดของธีมอยู่ใน theme.css (.dockview-theme-gnss) */
const THEME: DockviewTheme = { name: "gnss", className: "dockview-theme-gnss", colorScheme: "light" };

/** dockview เรียก component ตามชื่อชนิด: ทุกชนิดใช้ตัวเดียวที่หา component จริงจากทะเบียนตอน render */
function PanelHost(props: IDockviewPanelProps) {
  useSyncExternalStore(subscribePanels, panelRegistryVersion);
  const kind = props.api.component;
  const def = isPanelKind(kind) ? getPanelDef(kind) : undefined;
  if (def === undefined) return null; // UNKNOWN_PANEL: ชนิดที่ไม่รู้จักจาก workbook ถูกลบทันทีหลังสร้าง
  const Component = def.component;
  return <Component params={props.params} panelId={props.api.id} />;
}

const COMPONENTS: Record<string, FC<IDockviewPanelProps>> = Object.fromEntries([...PANEL_KINDS, UNKNOWN_PANEL].map((k) => [k, PanelHost]));

const TYPE_ORDER: readonly WindowType[] = ["dockable", "floating", "integrated"];

/** คลิกขวาที่แถบชื่อหน้าต่าง: Dockable / Floating / Integrated (ชนิดปัจจุบันกดไม่ได้) */
function tabContextMenu({ panel }: GetTabContextMenuItemsParams): ReactContextMenuItemConfig[] {
  const current = windowTypeOf(panel);
  return TYPE_ORDER.map((type) => ({
    label: t(`window.mode.${type}`),
    disabled: type === current,
    action: () => useLayout.getState().setType(panel.id, type),
  }));
}

export interface WorkspaceProps {
  /** เหนือหน้าต่าง: แถบเตือนดิสก์ + เมนูบาร์ + แถบเครื่องมือ */
  header?: ReactNode;
  /** ใต้หน้าต่าง: แถบสถานะ */
  footer?: ReactNode;
}

export function Workspace({ header, footer }: WorkspaceProps) {
  const ready = useRef<DockviewReadyEvent["api"] | null>(null);
  const host = useRef<HTMLDivElement>(null);

  const onReady = useCallback((e: DockviewReadyEvent) => {
    ready.current = e.api;
    const layout = useLayout.getState();
    layout.attach(e.api);
    layout.applyDefault(); // เปิด scenario แล้ว restoreFor(name) จะแทนด้วย workbook ของ scenario นั้น
  }, []);

  // dockview ไม่ทำลายตัวเองเมื่อ effect ถูกล้างเฉยๆ (StrictMode, Activity ที่ซ่อน) มันรอจน container หายไปจาก DOM จริง
  // (unmount จริง React เอา container ออกก่อนล้าง effect) store ต้องปล่อย api ตามจังหวะเดียวกัน ไม่งั้น StrictMode ทำให้ api หลุดแล้วไม่กลับมา
  useEffect(() => {
    const element = host.current;
    return () => {
      if (element === null || !element.isConnected) useLayout.getState().detach(ready.current ?? undefined);
    };
  }, []);

  return (
    <div className="workspace">
      <div className="workspace-header" data-slot="header">{header}</div>
      <div className="workspace-body" ref={host}>
        <DockviewReact
          theme={THEME}
          components={COMPONENTS}
          floatingGroupDragHandle="tabbar" // หน้าต่างลอยลากที่แถบแท็บ ไม่มีแถบลากว่างเพิ่มอีกแถว
          getTabContextMenuItems={tabContextMenu}
          onReady={onReady}
        />
      </div>
      <div className="workspace-footer" data-slot="footer">{footer}</div>
      <WindowsDialog />
    </div>
  );
}
