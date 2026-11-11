// หน้าต่างของงานที่ 7 แทนตัวแทนชั่วคราวใน layout/panels.ts: Welcome, New Scenario Wizard, About, STK UI Reference (ทั้งสี่เป็นหน้าต่างลอย)
// ชื่อและชนิดตั้งต้นคงตามตัวแทนที่ลงทะเบียนไว้แล้ว (ที่เดียวคือ BASE ใน panels.ts) เปลี่ยนเฉพาะ component และขนาดที่พอดีกับเนื้อหาจริง

import type { FC } from "react";
import { getPanelDef, registerPanel, type PanelKind, type PanelProps, type PanelSize } from "../layout/panels";
import { About } from "./About/About";
import { NewScenarioWizard } from "./NewScenarioWizard/NewScenarioWizard";
import { StkReference } from "./StkReference/StkReference";
import { Welcome } from "./Welcome/Welcome";

interface FileWindow {
  component: FC<PanelProps>;
  /** ไม่ระบุ = ขนาดของตัวแทน */
  size?: PanelSize;
}

const WINDOWS = {
  // ตารางมีเวลาสองคอลัมน์ (UTCG เต็ม) ต้องกว้างพอที่คอลัมน์ Daily Forecast ไม่ถูกตัด
  welcome: { component: Welcome, size: { width: 720, height: 440 } },
  newScenarioWizard: { component: NewScenarioWizard, size: { width: 560, height: 360 } },
  // รายการชื่อที่เพิ่มเองแบ่งสามคอลัมน์
  about: { component: About, size: { width: 640, height: 440 } },
  stkReference: { component: StkReference },
} as const satisfies Partial<Record<PanelKind, FileWindow>>;

/** ลงทะเบียนซ้ำได้ (StrictMode, HMR): ได้ผลเหมือนเดิม */
export function registerFilePanels(): void {
  for (const kind of Object.keys(WINDOWS) as (keyof typeof WINDOWS)[]) {
    const base = getPanelDef(kind);
    if (base === undefined) throw new Error(`panel kind "${kind}" is not registered`);
    registerPanel(kind, { ...base, ...WINDOWS[kind] });
  }
}
