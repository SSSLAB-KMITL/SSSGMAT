// การเปิด ปิด และบันทึก scenario ทั้งหมดของแอป (spec §5.1 เมนู File, §11 Welcome / New Scenario Wizard / Save As) และการเริ่มหน้าเว็บ
//
// - URL คือที่จำ scenario ที่เปิดอยู่ (`?sc=<ชื่อ>`: reload แล้วเปิดเดิม) เปลี่ยนด้วย history.replaceState เท่านั้น (ไม่เพิ่มประวัติ) พารามิเตอร์อื่นอยู่เหมือนเดิม
//   (โดยเฉพาะ `?test` ของ W19) เปิดสำเร็จ = URL + restoreFor + recent.push; ปิด = ถอด sc ออกจาก URL
// - เปิด scenario ขณะที่อีกอันเปิดอยู่ = สลับเลย ไม่ถาม (การแก้ถูกบันทึกทันทีตอน Apply แล้ว)
// - คำสั่งที่ลงทะเบียนอยู่ใน chrome/fileCommands.ts; ไฟล์นี้ไม่รู้จักทะเบียนคำสั่งและไม่มี UI

import { apiSend } from "./api/client";
import { msg } from "./labels/messages.th";
import { getPanelDef } from "./layout/panels";
import { push as pushRecent, remove as removeRecent } from "./recent";
import { useLayout } from "./stores/layout";
import { report } from "./stores/messages";
import { useScenario } from "./stores/scenario";

const SC_PARAM = "sc";
const enc = encodeURIComponent;

/** กติกาชื่อ scenario ของ server (schema.NAME_PATTERN): A-Z a-z 0-9 _ - ยาว 1-32 ตัว ใช้ตรวจก่อนส่งในหน้าต่างสร้างและ Save As */
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const isScenarioName = (name: string): boolean => NAME_RE.test(name);

/**
 * query string ที่มี `sc=<name>` (name = null ถอดออก) พารามิเตอร์อื่นอยู่ตามเดิมทีละไบต์ (`?test` ไม่กลายเป็น `?test=`)
 * `sc` ใหม่อยู่ท้ายสุด; ไม่เหลืออะไร = สตริงว่าง (ไม่มี `?` เปล่า)
 */
export function scenarioSearch(search: string, name: string | null): string {
  const parts = search
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part !== "" && part.split("=")[0] !== SC_PARAM);
  if (name !== null) parts.push(`${SC_PARAM}=${enc(name)}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

function setScenarioParam(name: string | null): void {
  const { pathname, search, hash } = window.location;
  const next = scenarioSearch(search, name);
  if (next === search) return;
  try {
    window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
  } catch {
    // บางสภาพแวดล้อม (iframe ที่ถูกจำกัด) ห้ามแก้ URL: scenario ยังเปิดได้ แค่ reload แล้วไม่เปิดเดิม
  }
}

/** เปิด Welcome (เปิดอยู่แล้ว = โฟกัสตัวเดิม); พื้นที่ทำงานยังไม่พร้อม = ไม่ทำอะไร */
export function showWelcome(): void {
  const layout = useLayout.getState();
  if (layout.api !== null) layout.openPanel("welcome");
}

/**
 * เปิด scenario: โหลด → URL → จำในรายการล่าสุด → จัดหน้าต่างตาม workbook (restoreFor แทนที่ทุกหน้าต่างที่เปิดอยู่)
 * คืน false เมื่อเปิดไม่ได้ (ข้อความอยู่ใน Message Viewer แล้ว และไม่มีอะไรเปลี่ยน)
 * ยกเว้นรายการล่าสุด: server ตอบ 404 NOT_FOUND (scenario ถูกลบไปแล้ว) = ถอดชื่อนั้นออกจากรายการ ไม่ให้เหลือรายการที่เปิดไม่ได้ตลอดไป
 * (ล้มเหลวเพราะเหตุอื่น เช่น ต่อ server ไม่ได้ ไม่ถอด: scenario ยังอยู่)
 */
export async function openScenario(name: string): Promise<boolean> {
  if (!(await useScenario.getState().load(name))) {
    const failure = useScenario.getState().loadFailure;
    if (failure !== null && failure.name === name && failure.status === 404 && failure.code === "NOT_FOUND") removeRecent(name);
    return false;
  }
  setScenarioParam(name);
  pushRecent(name);
  await useLayout.getState().restoreFor(name);
  return true;
}

/** หลัง scenario ถูกปิด (ไม่ว่าใครสั่ง): ถอด sc ออกจาก URL ปิดหน้าต่างที่ผูกกับ scenario (PanelDef.scenarioBound) แล้วเปิด Welcome ทำซ้ำได้ */
function afterScenarioClosed(): void {
  setScenarioParam(null);
  const layout = useLayout.getState();
  const api = layout.api;
  if (api === null) return;
  for (const panel of [...api.panels]) {
    if (getPanelDef(panel.api.component)?.scenarioBound === true) layout.closePanel(panel.id);
  }
  showWelcome();
}

/** File → Close และ File → Exit (browser ปิดแท็บเองไม่ได้ Exit จึงเหมือน Close: กลับหน้า Welcome) */
export function closeScenario(): void {
  useScenario.getState().close();
  afterScenarioClosed();
}

/**
 * File → Save: PUT workbook สำเร็จ = ข้อความ info หนึ่งข้อความใน Message Viewer
 * ล้มเหลว = ไม่ต้องทำอะไรเพิ่ม (saveWorkbook แจ้งข้อผิดพลาดของตัวเองแล้ว ห้ามแจ้งซ้ำ)
 */
export async function saveScenario(): Promise<void> {
  try {
    await useLayout.getState().saveWorkbook();
  } catch {
    return;
  }
  report("info", "WORKBOOK_SAVED", msg("workbook.saved"));
}

/** Save As หยุดเพราะ PUT workbook ไม่สำเร็จ (saveWorkbook แจ้งใน Message Viewer แล้ว) */
export class WorkbookNotSaved extends Error {
  constructor() {
    super(msg("saveAs.workbookFailed"));
    this.name = "WorkbookNotSaved";
  }
}

/**
 * File → Save As: PUT workbook → POST /copy → เปิดชื่อใหม่ (คืนค่าเหมือน openScenario)
 * โยน WorkbookNotSaved เมื่อบันทึก workbook ไม่ได้ (ยังไม่คัดลอก) และ ApiError ของ server เมื่อคัดลอกไม่ได้ (ชื่อซ้ำ = 409 field new_name)
 */
export async function saveScenarioAs(newName: string): Promise<boolean> {
  const source = useScenario.getState().name;
  if (source === null) throw new Error(msg("saveAs.noScenario"));
  try {
    await useLayout.getState().saveWorkbook();
  } catch {
    throw new WorkbookNotSaved();
  }
  await apiSend("POST", `/scenarios/${enc(source)}/copy`, { new_name: newName });
  return openScenario(newName);
}

/**
 * เริ่มหน้าเว็บเมื่อพื้นที่ทำงาน (dockview) พร้อม: URL มี `?sc=<ชื่อ>` = เปิดชื่อนั้น เปิดไม่ได้หรือไม่มี = Welcome (และถอด sc ที่ใช้ไม่ได้ออกจาก URL)
 * และเมื่อ scenario ที่เปิดอยู่ถูกปิดโดยไม่ใช่คำสั่งของเรา (ถูกลบจากแท็บอื่น) ก็กลับ Welcome เช่นกัน
 * เริ่มครั้งเดียวต่อการเรียก คืนฟังก์ชันหยุด
 */
export function startWorkspaceFlow(): () => void {
  let stopped = false;
  let started = false;
  let offLayout = (): void => undefined;

  const begin = async (): Promise<void> => {
    // Workspace เรียก attach แล้ว applyDefault ต่อกันแบบซิงก์ (applyDefault ล้างหน้าต่างทั้งหมด): รอจบก่อนจึงเปิด Welcome ได้
    await Promise.resolve();
    if (stopped) return;
    const name = new URLSearchParams(window.location.search).get(SC_PARAM);
    if (name !== null && name !== "") {
      if (await openScenario(name)) return;
      if (stopped) return;
      setScenarioParam(null);
    }
    showWelcome();
  };

  const run = (): void => {
    if (started || stopped) return;
    started = true;
    offLayout();
    void begin();
  };

  offLayout = useLayout.subscribe((state) => {
    if (state.api !== null) run();
  });
  if (useLayout.getState().api !== null) run();

  const offScenario = useScenario.subscribe((state, prev) => {
    if (prev.name !== null && state.name === null) afterScenarioClosed();
  });

  return () => {
    stopped = true;
    offLayout();
    offScenario();
  };
}
