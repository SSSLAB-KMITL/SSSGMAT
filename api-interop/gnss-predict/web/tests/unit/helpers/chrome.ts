// ตัวช่วยร่วมของ test ส่วนเมนู แถบเครื่องมือ แถบสถานะ และกล่องโต้ตอบ: ล้าง store ทั้งหมด ลงทะเบียนคำสั่งชุดของงานนี้ และเปิด scenario ปลอม

import type { components } from "../../../src/api/types.gen";
import { resetCommands } from "../../../src/commands";
import { registerCoreCommands } from "../../../src/chrome/coreCommands";
import { useJobs } from "../../../src/stores/jobs";
import { useLayout } from "../../../src/stores/layout";
import { useMessages } from "../../../src/stores/messages";
import { useResults } from "../../../src/stores/results";
import { useScenario } from "../../../src/stores/scenario";
import { useSelection } from "../../../src/stores/selection";
import { useSettings } from "../../../src/stores/settings";
import { useTime } from "../../../src/stores/time";
import { useObjectBrowser } from "../../../src/windows/ObjectBrowser/state";

export type ScenarioDoc = components["schemas"]["ScenarioDoc"];

export function makeDoc(over: Partial<ScenarioDoc> = {}): ScenarioDoc {
  return {
    format: "gnss-studio-scenario/1",
    name: "T",
    orbit_snapshot: "snap",
    analysis_period: { start: "2026-11-12T00:00:00Z", stop: "2026-11-13T00:00:00Z" },
    objects: [],
    animation: { time_step_s: 60, update_mode: "time_step", cycle: "loop", x_real_time_multiplier: 60 },
    units: { date_format: "UTCG", ltz_offset: "+07:00" },
    ...over,
  } as ScenarioDoc;
}

/** ทุก store กลับค่าเริ่มต้น และไม่มีคำสั่งลงทะเบียนอยู่ */
export function resetAll(): void {
  resetCommands();
  useLayout.setState(useLayout.getInitialState(), true);
  useScenario.setState(useScenario.getInitialState(), true);
  useTime.setState(useTime.getInitialState(), true);
  useSelection.setState(useSelection.getInitialState(), true);
  useJobs.setState(useJobs.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  useResults.setState(useResults.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
  useObjectBrowser.setState(useObjectBrowser.getInitialState(), true);
}

/** reset + คำสั่ง view.* window.* anim.* ของงานนี้ คืนฟังก์ชันถอนออก */
export function resetWithCoreCommands(): () => void {
  resetAll();
  return registerCoreCommands();
}

/** เปิด scenario ปลอม (ไม่ผ่านเครือข่าย) และตั้งเวลาจาก doc */
export function openScenario(doc: ScenarioDoc = makeDoc()): ScenarioDoc {
  useScenario.setState({ name: doc.name, doc, etag: '"e1"' });
  useTime.getState().init(doc);
  return doc;
}
