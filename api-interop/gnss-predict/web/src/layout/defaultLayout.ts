// การจัดวางตั้งต้น (spec §4.2): (Object Browser | 3D | 2D) แล้ว (Timeline View | Message Viewer)
//   Object Browser          Dockable    ขอบซ้าย
//   3D Graphics 1 - Earth   Integrated  กลาง ซ้าย  } วางข้างกัน (Tile Vertically)
//   2D Graphics 1 - Earth   Integrated  กลาง ขวา   }
//   Timeline View + Message Viewer  Dockable  ขอบล่าง เป็นแท็บร่วมกัน (Timeline View เห็นก่อน)

import type { DockviewApi } from "dockview-react";
import { DEFAULT_FLOAT_SIZE, getPanelDef, type PanelKind } from "./panels";
import { addPanelAs } from "./placement";

/** id ของหน้าต่างแรกของแต่ละชนิดคือชื่อชนิดนั้น (หน้าต่างที่สอง: `graphics3d-2` ฯลฯ) */
export function addNewPanel(api: DockviewApi, kind: PanelKind, id: string, params: Record<string, unknown>) {
  const def = getPanelDef(kind);
  if (def === undefined) throw new Error(`panel kind "${kind}" is not registered`);
  return addPanelAs(api, {
    id, kind, params,
    title: def.title(params),
    type: def.type,
    edge: def.edge ?? "bottom",
    size: def.size ?? DEFAULT_FLOAT_SIZE,
  });
}

export function applyDefaultLayout(api: DockviewApi): void {
  api.clear();
  addNewPanel(api, "graphics3d", "graphics3d", { n: 1 });
  addNewPanel(api, "graphics2d", "graphics2d", { n: 1 });
  addNewPanel(api, "objectBrowser", "objectBrowser", {});
  addNewPanel(api, "timelineView", "timelineView", {});
  addNewPanel(api, "messageViewer", "messageViewer", {});
  api.getPanel("timelineView")?.api.setActive(); // แท็บที่เพิ่มทีหลังขึ้นมาเป็น active เอง คืนให้ Timeline View
}
