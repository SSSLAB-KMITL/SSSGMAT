// ตัวช่วยร่วมของ test ส่วน Welcome, New Scenario Wizard, Save As และคำสั่ง File: เปลี่ยนการเปิด/ปิดหน้าต่างและการโหลด scenario เป็นตัวปลอมที่บันทึกลำดับการเรียก
// (ไม่ต้องมี dockview จริง); test ที่ต้องการ dockview จริงใช้ Workspace เอง

import { vi } from "vitest";
import { useLayout } from "../../../src/stores/layout";
import { useScenario } from "../../../src/stores/scenario";

export interface FakeFlow {
  /** ลำดับการเรียก: "load:NAME" "restore:NAME" "open:KIND" "close:ID" "closeScenario" */
  calls: string[];
  openPanel: ReturnType<typeof vi.fn>;
  closePanel: ReturnType<typeof vi.fn>;
  restoreFor: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
}

/** load ตอบ loadResult; restoreFor/openPanel/closePanel แค่บันทึก; ตั้ง api เป็นตัวปลอมเพื่อให้คำสั่งที่ต้องมีพื้นที่ทำงานใช้ได้ */
export function fakeFlow(loadResult: boolean | ((name: string) => boolean) = true): FakeFlow {
  const calls: string[] = [];
  const load = vi.fn(async (name: string) => {
    calls.push(`load:${name}`);
    return typeof loadResult === "function" ? loadResult(name) : loadResult;
  });
  const restoreFor = vi.fn(async (name: string) => {
    calls.push(`restore:${name}`);
  });
  const openPanel = vi.fn((kind: string) => {
    calls.push(`open:${kind}`);
    return kind;
  });
  const closePanel = vi.fn((id: string) => {
    calls.push(`close:${id}`);
  });
  useScenario.setState({ load } as never);
  useLayout.setState({ restoreFor, openPanel, closePanel, api: {} as never } as never);
  return { calls, openPanel, closePanel, restoreFor, load };
}

/** ตั้ง URL ของหน้า (jsdom) โดยไม่โหลดใหม่ */
export function setUrl(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}
