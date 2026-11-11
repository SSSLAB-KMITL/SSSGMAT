// ข้อความไทยของหน้าเว็บ (spec §13) ข้อความจาก server ใช้ช่อง `text` ที่ server ส่งมา ไม่ผ่านที่นี่
// ชื่อเมนู ปุ่ม หน้าต่าง ตัวเลือก (ภาษาอังกฤษแบบ STK) อยู่ใน labels.ts
// {var} คือช่องแทนค่าของ msg(key, { var })

import { fillPlaceholders } from "./labels";

const MESSAGES = {
  // คำอธิบายธงดาวจาก engine (W9) ธงทั้งหกต้องมีครบ ธงที่บอกว่าไม่ถูกนำไปคำนวณ DOP ต้องตรงกับ DOP_EXCLUDED_FLAGS ใน gnss_predict/catalog.py (test ตรวจ)
  "flag.stale": "ข้อมูลวงโคจรเก่ากว่า 2 วัน แต่ไม่เกิน 7 วัน ตำแหน่งที่คำนวณอาจคลาดเคลื่อนมากขึ้น",
  "flag.too_old": "ข้อมูลวงโคจรเก่ากว่า 7 วัน ตัวกรองดาวของ scenario (satellite_filter ใน scenario.json) ซ่อนดาวดวงนี้ไว้ตามค่าตั้งต้น และดาวดวงนี้ไม่ถูกนำไปคำนวณ DOP",
  "flag.no_broadcast": "ไม่พบ broadcast ephemeris ของดาวดวงนี้ จึงไม่ทราบสถานะว่าปกติหรือไม่ ตัวกรองดาวของ scenario (satellite_filter ใน scenario.json) ซ่อนดาวดวงนี้ไว้ตามค่าตั้งต้น และดาวดวงนี้ไม่ถูกนำไปคำนวณ DOP",
  "flag.unhealthy": "broadcast แจ้งว่าดาวดวงนี้ไม่ปกติ (unhealthy) ดาวดวงนี้ไม่ถูกนำไปคำนวณ DOP",
  "flag.prn_changed": "หมายเลข PRN ของดาวดวงนี้เปลี่ยนในช่วงเวลาที่วิเคราะห์ ตามข้อมูล metadata ของ IGS",
  "flag.name_mismatch": "PRN ในชื่อของ CelesTrak ไม่ตรงกับ PRN ของ IGS (ข้อมูลประกอบเท่านั้น)",

  // แถบเหนือหน้าต่าง 3D/2D (spec §9.1) ข้อความสองบรรทัดนี้ตกลงไว้ตายตัว
  "banner.stale": "ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน — กด Apply เพื่อคำนวณใหม่",
  "banner.missing": "ยังไม่มีผลลัพธ์ — กด Apply เพื่อคำนวณ",
  "webgl.unsupported": "เครื่องหรือ browser นี้ไม่รองรับ WebGL จึงแสดงภาพ 3D และ 2D ไม่ได้ ลองเปิดการเร่งด้วยฮาร์ดแวร์ใน browser หรือใช้ browser รุ่นใหม่ ส่วน Object Browser และ Properties ยังใช้ได้",

  // คำสั่งที่รอ งานย่อยที่ 4 (W4)
  "tooltip.subtask4": "อยู่ในงานย่อยที่ 4",

  // กล่องโต้ตอบ (spec §7, §15)
  "confirm.delete": "ลบ \"{name}\" หรือไม่? การลบนี้ย้อนกลับไม่ได้",
  "conflict.title": "scenario ถูกแก้จากที่อื่น",
  "conflict.body": "scenario นี้ถูกแก้จากแท็บหรือหน้าต่างอื่นหลังจากที่คุณเปิดมา กด Reload เพื่อโหลดค่าล่าสุดจาก server (ค่าที่ยังไม่ได้ Apply ในหน้านี้จะหายไป) หรือ Cancel เพื่อปิดกล่องนี้โดยไม่เปลี่ยนอะไร ค่าของอีกแท็บจะไม่ถูกทับ",
  "job.failed": "งานล้มเหลว: {message}",
  "time.invalid": "รูปแบบเวลาไม่ถูกต้อง ตัวอย่าง: {example}",

  // การเชื่อมต่อ server และดิสก์ (spec §12, §15)
  "server.disconnected": "ขาดการติดต่อกับ server ข้อมูลบนหน้านี้อาจไม่เป็นปัจจุบัน",
  "server.reconnecting": "กำลังเชื่อมต่อใหม่ในอีก {seconds} วินาที",
  "server.reconnected": "เชื่อมต่อ server ได้แล้ว",
  "disk.low": "พื้นที่ดิสก์ของ server เหลือน้อย (ประมาณ {free_mb} MB) การบันทึกหรือการดึงข้อมูลอาจล้มเหลว",
  "disk.notWritable": "server เขียนไฟล์ลงดิสก์ไม่ได้ การบันทึกทั้งหมดจะล้มเหลวจนกว่าจะแก้สิทธิ์การเขียนหรือพื้นที่ว่างของดิสก์",

  // การเปิดและโหลดข้อมูล scenario จาก server ({message} คือข้อความของ server ตามที่ส่งมา)
  "scenario.openFailed": "เปิด scenario \"{name}\" ไม่ได้: {message}",
  "scenario.reloadFailed": "โหลด scenario \"{name}\" จาก server ใหม่ไม่สำเร็จ ข้อมูลบนหน้านี้อาจไม่เป็นปัจจุบัน: {message}",
  "scenario.deleted": "scenario \"{name}\" ถูกลบจากที่อื่น จึงปิดให้แล้ว",
  "catalog.failed": "โหลดรายชื่อดาวของ snapshot ไม่สำเร็จ ({message}) จึงไม่มีป้ายธงและการซ่อนดาวตามตัวกรอง แต่ scenario ยังเปิดใช้ได้",
  "results.failed": "โหลดสถานะผลลัพธ์ไม่สำเร็จ: {message}",
  "results.fileFailed": "อ่านไฟล์ผลลัพธ์ {file} ไม่สำเร็จ: {message}",

  // งานที่ต่ออินเทอร์เน็ต ต้องขอยืนยันก่อนทุกครั้ง
  "fetch.confirm": "ดึงข้อมูลวงโคจรจาก CelesTrak ตอนนี้หรือไม่? โปรแกรมจะเชื่อมต่ออินเทอร์เน็ตไปที่ celestrak.org และ CelesTrak จำกัดความถี่ในการดึง จึงดึงซ้ำก่อนถึงเวลาถัดไปไม่ได้",
  "fetch.nextAvailable": "ดึงจาก CelesTrak ได้อีกครั้งเวลา {time}",
  "daily.runNowConfirm": "รันงานประจำวันตอนนี้หรือไม่? งานนี้จะดึงข้อมูลวงโคจรผ่านอินเทอร์เน็ตแล้วคำนวณ forecast ใหม่ ใช้เวลาสักครู่",

  // Workbook (W6) ไม่เกิน 1,048,576 ไบต์
  "workbook.tooLarge": "การจัดวางหน้าต่างมีขนาดเกิน 1 MB จึงบันทึกลง workbook ไม่ได้ ปิดหน้าต่างหรือแถบที่ไม่ใช้แล้วลองบันทึกอีกครั้ง",

  // หมายเหตุในหน้า (spec §8, §11, W20)
  "note.readOnly": "หน้านี้อ่านอย่างเดียวใน v1",
  "note.visibleSidesBoth": "v1 วาดเส้นทางแบบ Both เสมอ ค่า Visible Sides ที่ตั้งจะถูกเก็บไว้แต่ยังไม่มีผลต่อภาพ",
  "about.disclaimer": "ชื่อเมนู หน้าต่าง และหน้าตั้งค่าอ้างอิงคู่มือ STK 13.1.0 รายการที่ติดป้าย Added by GNSS Studio เป็นส่วนที่เพิ่มเอง GNSS Studio ไม่ใช่ผลิตภัณฑ์ของผู้พัฒนา STK",
} as const satisfies Record<string, string>;

export type MsgKey = keyof typeof MESSAGES;
/** ทุกคีย์ (ให้ test ไล่ตรวจว่าทุกข้อความเป็นภาษาไทย) */
export const MSG_KEYS = Object.keys(MESSAGES) as MsgKey[];

export function msg(key: MsgKey, vars?: Record<string, string | number>): string {
  return fillPlaceholders(MESSAGES[key], vars);
}
