// ข้อความไทยของหน้าเว็บ (spec §13) ข้อความจาก server ใช้ช่อง `text` ที่ server ส่งมา ไม่ผ่านที่นี่
// ชื่อเมนู ปุ่ม หน้าต่าง ตัวเลือก (ภาษาอังกฤษแบบ STK) อยู่ใน labels.ts
// {var} คือช่องแทนค่าของ msg(key, { var })

import { fillPlaceholders } from "./labels";

/**
 * แหล่งที่การดึงข้อมูลวงโคจรติดต่อจริง (gnss_predict/config.py: CELESTRAK_GP_URL, IGS_META_URL, CDDIS_BRDC_URL ซึ่ง fetch_snapshot, งานประจำวัน
 * และ Fetch Now ใช้ชุดเดียวกัน; การตรวจย้อนหลังของงานประจำวันอ่าน SP3 ของ MGEX จาก CDDIS host เดิม)
 * ข้อความที่ขอความยินยอมให้ดาวน์โหลดต้องไล่ครบทุก host (labels.test.ts ตรวจกับ config.py)
 */
const CDDIS = "CDDIS (gdc.cddis.eosdis.nasa.gov)";
const SOURCES = `CelesTrak (celestrak.org), IGS (files.igs.org) และ ${CDDIS}`;

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
  // ปุ่ม Apply บนแถบ (POST /propagate: คำนวณด้วย GMAT ในเครื่อง ไม่ดาวน์โหลดอะไร)
  "banner.running": "กำลังคำนวณผลลัพธ์อยู่ ดูความคืบหน้าที่แถบสถานะ",
  "banner.applyFailed": "สั่งคำนวณผลลัพธ์ใหม่ไม่สำเร็จ: {message}",
  // {window} = "3D" หรือ "2D" (หน้าต่างที่แจ้ง)
  "scene.loadFailed": "โหลดผลลัพธ์เข้าหน้าต่าง {window} ไม่สำเร็จ ({message}) จึงแสดงเฉพาะ Facility",
  "banner.sceneFailed": "โหลดผลลัพธ์เข้าหน้าต่าง {window} ไม่สำเร็จ จึงแสดงเฉพาะ Facility จะลองโหลดใหม่เมื่อดึงสถานะผลลัพธ์ครั้งถัดไป (เช่น หลังเชื่อมต่อ server ได้อีกครั้ง)",
  // ส่วนแสดงผล 3D/2D (Cesium) แยกไฟล์และโหลดเมื่อเปิดหน้าต่าง: ไฟล์นั้นโหลดไม่ได้ (เช่น server ถูกอัปเดตระหว่างที่หน้าเปิดอยู่)
  "scene.chunkFailed": "โหลดส่วนแสดงผล {window} ไม่สำเร็จ ลองโหลดหน้าใหม่",
  "scene.chunkFailedLog": "โหลดส่วนแสดงผล {window} ไม่สำเร็จ ({message}) ลองโหลดหน้าใหม่",
  // ภาพหยุดระหว่างใช้: ข้อผิดพลาดตอนวาด หรือ browser ทิ้ง WebGL context (Chrome ทิ้งตัวที่เก่าที่สุดเมื่อมี context มากเกินไป)
  "scene.renderStopped": "การแสดงผลกราฟิกหยุดทำงาน ปิดแล้วเปิดหน้าต่างนี้ใหม่ (ถ้าเปิดหน้าต่าง 3D และ 2D ไว้หลายบาน ให้ปิดบานที่ไม่ใช้ก่อน) หน้าต่างอื่นยังใช้ได้",
  "scene.renderStoppedLog": "การแสดงผลกราฟิกของหน้าต่าง {window} หยุดทำงาน ({message}) ปิดแล้วเปิดหน้าต่างนี้ใหม่",

  // หน้าต่าง 3D: 3D Graphics Window Properties และ View From/To (spec §9.2)
  "g3d.lightingNote": "Ambient Level และ Sun Level มีผลเมื่อเปิด Enable Lighting",
  "g3d.nightLightsNote": "ภาพแสงไฟเมืองตอนกลางคืนต้องโหลดจากอินเทอร์เน็ต (Cesium ion) จึงไม่มีในโปรแกรมที่ทำงานออฟไลน์นี้ ค่า Night Lights Level ถูกเก็บไว้แต่ยังไม่มีผลต่อภาพ",
  // โมเดล 3 มิติของดาวในหน้าต่าง 3D ({model} = id ของโมเดลใน models/catalog.json) แจ้งครั้งเดียวต่อโมเดลต่อการเปิดหน้าเว็บ
  "model.loadFailed": "โหลดโมเดล 3 มิติ {model} ไม่สำเร็จ ({message}) ดาวที่ใช้โมเดลนี้แสดงเป็นจุดแทน",
  // {value} = ค่า cell_normal ใน catalog ที่ไม่ใช่ +X, -X, +Z, -Z
  "model.cellNormalInvalid": "ด้านเซลล์ของแผงโซลาร์ของโมเดล 3 มิติ {model} ใน catalog อ่านไม่ได้ (cell_normal = {value} ต้องเป็น +X, -X, +Z หรือ -Z) จึงใช้ค่าสำรองในโปรแกรมแทน",
  "model.catalogFailed": "โหลดรายการโมเดล 3 มิติของดาวไม่สำเร็จ ({message}) ดาวทุกดวงในหน้าต่าง 3D แสดงเป็นจุดแทน",
  "g3d.noWindow": "หน้าต่าง 3D ที่จะตั้งค่าถูกปิดไปแล้ว เปิดหน้าต่างนี้ใหม่จากหน้าต่าง 3D ที่ต้องการ",
  // หน้าต่าง 2D: 2D Graphics Window Properties (spec §9.3)
  "g2d.noWindow": "หน้าต่าง 2D ที่จะตั้งค่าถูกปิดไปแล้ว เปิดหน้าต่างนี้ใหม่จากหน้าต่าง 2D ที่ต้องการ",
  "g2d.coordFrameNote": "v1 แสดงแผนที่ในกรอบ ECF (หมุนไปกับโลก) เท่านั้น การแสดงในกรอบ ECI จะมีในรุ่นหลัง",
  "g2d.ippNote": "IPP คือจุดที่สัญญาณจากดาวผ่านชั้นไอโอโนสเฟียร์ แสดงจุดตอนนี้และเส้นทาง ±10 นาทีของดาวที่ Facility แรกที่มีผลลัพธ์ตรงกับ scenario เห็นสูงกว่ามุมเงยต่ำสุด (จาก aer.csv) ไม่แสดงเมื่อผลลัพธ์ไม่ตรงกับ scenario",
  "g2d.lightingNote": "Shading ทำให้ด้านกลางคืนของแผนที่มืดลงตามแสงอาทิตย์ของโลกใน Cesium ขอบมืดค่อย ๆ จางลงจึงอาจไม่ทับเส้นของ Show Outline พอดี",
  "ipp.loadFailed": "โหลด aer.csv ของ {facility} เพื่อแสดง IPP ไม่สำเร็จ: {message}",
  "viewFromTo.same": "From Position กับ To Position ต้องเป็นคนละ object",
  "viewFromTo.notFound": "หา object ที่เลือกในหน้าต่าง 3D ไม่เจอ (ยังไม่มีผลลัพธ์ของดาวดวงนั้น หรือ object ถูกซ่อนอยู่)",
  "viewFromTo.noObjects": "scenario นี้ยังไม่มี Facility หรือ Satellite ให้เลือก",

  // คำสั่งที่รอ งานย่อยที่ 4 (W4)
  "tooltip.subtask4": "อยู่ในงานย่อยที่ 4",
  "tooltip.noScenario": "ยังไม่ได้เปิด scenario",

  // แถบเครื่องมือ Animation: ปุ่ม Start/Reverse ที่กดแล้วไม่ขยับเพราะ Animation Cycle เป็น Stop at Time และเวลาอยู่ที่ปลายช่วงแล้ว (W1)
  "anim.reachedEnd": "เวลาอยู่ที่ปลายช่วงวิเคราะห์แล้ว และ Animation Cycle เป็น Stop at Time จึงเล่นต่อไม่ได้ กด Reset หรือพิมพ์เวลาใหม่ในช่อง Current Scenario Time",
  "anim.reachedStart": "เวลาอยู่ที่ต้นช่วงวิเคราะห์แล้ว และ Animation Cycle เป็น Stop at Time จึงเล่นถอยหลังต่อไม่ได้ กด Reset หรือพิมพ์เวลาใหม่ในช่อง Current Scenario Time",

  // แถบสถานะ: งานประจำวัน (server §8 `daily.state`)
  "daily.state.idle": "ว่าง",
  "daily.state.running": "กำลังรัน",
  "daily.state.ok": "สำเร็จ",
  "daily.state.failed": "ล้มเหลว",

  // View → Full Screen ที่ browser ไม่อนุญาต
  "fullscreen.failed": "เปิดโหมดเต็มจอไม่ได้: {message}",

  // กล่องโต้ตอบ (spec §7, §15)
  "confirm.delete": "ลบ \"{name}\" หรือไม่? การลบนี้ย้อนกลับไม่ได้",
  // ดาวที่มี Sensor: server ลบ Sensor ของดาวตามไปด้วย จึงบอกจำนวนก่อนยืนยัน (ดาวที่ไม่มี Sensor และ object อื่นใช้ confirm.delete)
  "confirm.deleteWithSensors": "ลบ \"{name}\" หรือไม่? Sensor ของดาวนี้ {count} ตัวจะถูกลบไปด้วย การลบนี้ย้อนกลับไม่ได้",
  "conflict.title": "scenario ถูกแก้จากที่อื่น",
  "conflict.body": "scenario นี้ถูกแก้จากแท็บหรือหน้าต่างอื่นหลังจากที่คุณเปิดมา กด Reload เพื่อโหลดค่าล่าสุดจาก server (ค่าที่ยังไม่ได้ Apply ในหน้านี้จะหายไป) หรือ Cancel เพื่อปิดกล่องนี้โดยไม่เปลี่ยนอะไร ค่าของอีกแท็บจะไม่ถูกทับ",
  "job.failed": "งานล้มเหลว: {message}",
  "time.invalid": "รูปแบบเวลาไม่ถูกต้อง ตัวอย่าง: {example}",

  // Object Browser (spec §7): ชื่อ object ใช้กติกาเดียวกับ server (NAME_PATTERN); ชื่อกลุ่มเป็นข้อความอิสระ แต่ไม่ว่างและไม่ซ้ำ (ไม่สนตัวพิมพ์)
  "ob.nameInvalid": "ชื่อ object ใช้ได้เฉพาะตัวอักษร A-Z a-z ตัวเลข _ และ - ยาว 1 ถึง 32 ตัว",
  "ob.groupNameEmpty": "ชื่อกลุ่มต้องไม่ว่าง",
  "ob.groupNameTaken": "มีกลุ่มชื่อ \"{name}\" อยู่แล้ว (ชื่อกลุ่มไม่แยกตัวพิมพ์เล็กใหญ่)",
  "ob.findNoMatch": "ไม่พบรายการที่ตรงกับ \"{query}\"",
  "ob.noFlagged": "ไม่มีดาวที่ติดธงเตือน",
  "ob.satelliteOnly": "v1 ตัด คัดลอก และวางได้เฉพาะดาว (Satellite)",
  "ob.groupUnsupported": "v1 ยังไม่รองรับการเปลี่ยนชื่อหรือลบกลุ่ม",
  "ob.rootUnsupported": "ทำกับ Scenario ไม่ได้ ใช้ได้กับ Facility, Constellation และ Satellite",
  "ob.pasteNeedsFolder": "เลือกโฟลเดอร์กลุ่มที่จะวางดาวที่ตัดไว้",
  "ob.nothingToPaste": "ยังไม่ได้คัดลอกหรือตัดดาว",
  "ob.selectObject": "เลือก object ก่อน",

  // การเชื่อมต่อ server และดิสก์ (spec §12, §15)
  "server.disconnected": "ขาดการติดต่อกับ server ข้อมูลบนหน้านี้อาจไม่เป็นปัจจุบัน",
  "server.reconnecting": "กำลังเชื่อมต่อใหม่ในอีก {seconds} วินาที",
  "server.reconnected": "เชื่อมต่อ server ได้แล้ว",
  "messages.backfillFailed": "ดึงข้อความที่พลาดไประหว่างที่ขาดการติดต่อไม่สำเร็จ โปรแกรมจะลองใหม่เรื่อย ๆ จนกว่าจะได้ ข้อความบางส่วนอาจยังไม่แสดงในหน้านี้",
  "disk.low": "พื้นที่ดิสก์ของ server เหลือน้อย (ประมาณ {free_mb} MB) การบันทึกหรือการดึงข้อมูลอาจล้มเหลว",
  "disk.notWritable": "server เขียนไฟล์ลงดิสก์ไม่ได้ การบันทึกทั้งหมดจะล้มเหลวจนกว่าจะแก้สิทธิ์การเขียนหรือพื้นที่ว่างของดิสก์",

  // การเปิดและโหลดข้อมูล scenario จาก server ({message} คือข้อความของ server ตามที่ส่งมา)
  "scenario.openFailed": "เปิด scenario \"{name}\" ไม่ได้: {message}",
  "scenario.reloadFailed": "โหลด scenario \"{name}\" จาก server ใหม่ไม่สำเร็จ ข้อมูลบนหน้านี้อาจไม่เป็นปัจจุบัน: {message}",
  "scenario.docStale": "บันทึกครั้งก่อนสำเร็จแล้ว แต่โหลด scenario ล่าสุดจาก server ใหม่ไม่ได้ จึงยังไม่บันทึกซ้ำเพื่อไม่ให้ทับค่าที่เพิ่งแก้ ลองอีกครั้งเมื่อเชื่อมต่อ server ได้",
  "scenario.deleted": "scenario \"{name}\" ถูกลบจากที่อื่น จึงปิดให้แล้ว",
  "catalog.failed": "โหลดรายชื่อดาวของ snapshot ไม่สำเร็จ ({message}) จึงไม่มีป้ายธงและการซ่อนดาวตามตัวกรอง แต่ scenario ยังเปิดใช้ได้",
  "results.failed": "โหลดสถานะผลลัพธ์ไม่สำเร็จ: {message}",
  "results.fileFailed": "อ่านไฟล์ผลลัพธ์ {file} ไม่สำเร็จ: {message}",

  // กติกาของช่องกรอกตัวเลข (Insert STK Objects, Daily Forecast Settings)
  "form.notInteger": "ต้องเป็นจำนวนเต็ม",

  // Insert STK Objects (spec §11)
  "insert.noradInvalid": "NORAD ต้องเป็นจำนวนเต็มบวก",

  // Search Satellite Catalog (spec §11)
  "catalog.loading": "กำลังอ่านรายชื่อดาวจาก server...",
  "catalog.windowFailed": "โหลดรายชื่อดาวของ snapshot ไม่สำเร็จ: {message}",
  "catalog.inScenario": "มีแล้ว",
  "catalog.noMatch": "ไม่พบดาวที่ตรงกับตัวกรอง",
  "catalog.selected": "เลือกแล้ว {n} ดวง",
  "catalog.nameTaken": "มี object ชื่อ \"{name}\" อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)",
  "catalog.onlineHint": "Online CelesTrak เปิดหน้า Fetch Orbit Data ให้ หน้านี้ไม่ดาวน์โหลดเอง",

  // Fetch Orbit Data (spec §11)
  "fetch.loading": "กำลังอ่านข้อมูลวงโคจรจาก server...",
  "fetch.loadFailed": "อ่านรายการ snapshot ข้อมูลวงโคจรไม่สำเร็จ: {message}",
  "fetch.statusFailed": "อ่านเวลาที่ดึงจาก CelesTrak ได้ครั้งถัดไปไม่สำเร็จ: {message}",
  "fetch.noSnapshot": `ยังไม่มี snapshot ข้อมูลวงโคจร กด Fetch Now เพื่อดึงจาก ${SOURCES}`,
  "fetch.limitNote": "CelesTrak จำกัดความถี่ในการดึงข้อมูล (ต่อกลุ่มไม่เกินทุก 2 ชั่วโมง) และ IGS ดึงไม่เกินวันละครั้ง server เป็นผู้บังคับข้อจำกัดนี้ ถ้ากด Fetch Now ก่อนถึงเวลาถัดไป server จะใช้ไฟล์เดิมของส่วนนั้นแทนการดาวน์โหลดใหม่ แต่ broadcast จาก CDDIS ยังอาจถูกดาวน์โหลดถ้าไม่มีไฟล์ของวันนั้นในเครื่อง",
  "fetch.availableNow": "ดึงได้ตอนนี้",
  "fetch.running": "กำลังดึงข้อมูลวงโคจรอยู่ ดูความคืบหน้าที่แถบสถานะ",
  "fetch.queued": `สั่งดึงข้อมูลวงโคจรแล้ว (งาน {job}) server อาจดาวน์โหลดจาก ${SOURCES} ดูความคืบหน้าที่แถบสถานะ`,
  "fetch.failed": "สั่งดึงข้อมูลวงโคจรไม่สำเร็จ: {message}",
  "fetch.yes": "มี",
  "fetch.no": "ไม่มี",

  // Daily Forecast Settings (spec §11, server §9)
  "daily.timeInvalid": "ต้องเป็นเวลา UTC รูปแบบ HH:MM เช่น 21:00 (00:00 ถึง 23:59)",
  "daily.warnEnabled": `เปิดงานประจำวันอยู่: server จะเชื่อมต่ออินเทอร์เน็ตดาวน์โหลดจาก ${SOURCES} ทุกวันตอน {time} UTC และอ่าน SP3 ของ MGEX จาก CDDIS เพื่อตรวจย้อนหลัง ถ้าเวลาปัจจุบันเลย {time} UTC (ก่อน 24:00 UTC) แล้วและยังไม่มีผลของวันถัดไป งานจะเริ่มดาวน์โหลดทันที ภายในประมาณ 60 วินาทีหลังกด Apply หรือหลังเริ่ม server`,
  // ขอความยินยอมก่อนบันทึกค่าตั้งที่อาจให้ server เริ่มดาวน์โหลดเองภายในประมาณ 60 วินาที (ตัวตั้งเวลาตรวจทุก 60 วินาที): ประกอบเป็นกล่องเดียวตามที่เข้าเงื่อนไข
  // ส่วนพยากรณ์ = เลย run_at_utc ของวันนี้แล้ว (server §9.3) ส่วนตรวจย้อนหลัง = เปิดงานประจำวัน ไม่ว่ากี่โมง (server §9.4: อ่าน SP3 ของ MGEX จาก CDDIS)
  "daily.confirmForecast": `ตอนนี้เลยเวลา {time} UTC ของงานประจำวันแล้ว (ก่อน 24:00 UTC) หลังบันทึก server อาจเริ่มพยากรณ์ของวันถัดไปภายในประมาณ 60 วินาที โดยเชื่อมต่ออินเทอร์เน็ตดาวน์โหลดจาก ${SOURCES}`,
  "daily.confirmValidation": `การเปิดงานประจำวันทำให้ server อาจเริ่มตรวจย้อนหลังของวันที่ผ่านมาภายในประมาณ 60 วินาทีหลังบันทึก โดยเชื่อมต่ออินเทอร์เน็ตดาวน์โหลด SP3 ของ MGEX จาก ${CDDIS}`,
  "daily.confirmSave": "บันทึกค่าตั้งนี้หรือไม่?",
  "daily.runningNow": "งานประจำวันกำลังรันหรือรออยู่ รอให้เสร็จก่อนแล้วสั่งใหม่",
  "daily.loadFailed": "อ่านค่าตั้งงานประจำวันจาก server ไม่สำเร็จ: {message}",
  "daily.saved": "บันทึกค่าตั้งงานประจำวันแล้ว",
  "daily.applyFailed": "บันทึกค่าตั้งงานประจำวันไม่สำเร็จ: {message}",
  "daily.queued": "สั่งรันงานประจำวันแล้ว (งาน {job}) ดูความคืบหน้าที่แถบสถานะ",
  "daily.runConflict": "มีงานประจำวันของวันนั้นรออยู่หรือกำลังรันอยู่แล้ว รอให้เสร็จก่อนแล้วสั่งใหม่",
  "daily.runFailed": "สั่งรันงานประจำวันไม่สำเร็จ: {message}",
  "daily.runNowHint": "Run Now ใช้ค่าตั้งที่บันทึกไว้แล้ว ถ้าเพิ่งแก้ค่าให้กด Apply ก่อน",

  // ภาพพื้นโลกออนไลน์ (spec imagery §5, spec ภาพละเอียด §4): สวิตช์ต่อแหล่งและรายการชั้นภาพจาก server ในเครื่อง {source} = ชื่อแหล่ง (stores/imagery.ts SOURCE_NAMES)
  "imagery.loadFailed": "อ่านรายการภาพพื้นโลกออนไลน์ (NASA GIBS) จาก server ไม่สำเร็จ ({message}) จึงแสดงเฉพาะภาพ Natural Earth II ที่มากับโปรแกรม",
  "imagery.saveFailed": "เปลี่ยนสวิตช์ภาพพื้นโลกออนไลน์ ({source}) ไม่สำเร็จ ({message}) สวิตช์ยังเป็นค่าเดิม",
  // Cesium ion (spec ภาพละเอียด §4.1): ข้อความห้ามมี token (ไม่ใส่ข้อความ error ดิบของ Cesium ด้วย)
  "imagery.ionSettingsFailed": "อ่านค่าตั้งที่มี Cesium ion token จาก server ไม่สำเร็จ ({message}) จึงยังไม่แสดงชั้นภาพ Cesium ion",
  "imagery.ionNoToken": "เปิด Cesium ion อยู่แต่ยังไม่ได้ใส่ Cesium ion token จึงไม่แสดงชั้นภาพ Cesium ion (ชั้นภาพอื่นแสดงตามเดิม) ใส่ token ได้ที่กลุ่ม Cesium ion ในหน้าต่าง Globe Manager หรือที่หน้าต่าง Daily Forecast Settings",
  "imagery.ionFailed": "เปิดชั้นภาพ Cesium ion (Asset ID {assetId}) ไม่สำเร็จ: {reason} จึงถอดชั้นนี้ออกและแสดงชั้นภาพอื่นตามเดิม",
  "imagery.ionReasonToken": "Cesium ion ไม่รับ token นี้ (HTTP {status}) ตรวจว่า token ถูกต้องและยังไม่หมดอายุ",
  "imagery.ionReasonAsset": "ไม่พบ asset นี้ในบัญชี Cesium ion (HTTP 404) เพิ่ม asset เข้าบัญชีที่ ion.cesium.com หรือเลือก asset อื่น",
  "imagery.ionReasonOther": "Cesium ion ตอบกลับด้วยรหัส HTTP {status}",
  "imagery.ionReasonNotImagery": "asset นี้ไม่ใช่ชั้นภาพ หรือเป็นชนิดภาพที่โปรแกรมไม่รู้จัก",
  "imagery.ionReasonNetwork": "เชื่อมต่อ api.cesium.com ไม่ได้ (ตรวจการเชื่อมต่ออินเทอร์เน็ต)",
  "imagery.ionReasonTiles": "ชิ้นภาพของ asset นี้โหลดไม่ได้ {failed} จาก {settled} ชิ้น (อินเทอร์เน็ตหลุด หรือ Cesium ion/ผู้ให้ภาพไม่ส่งภาพให้) เลือก asset ใหม่ หรือปิดแล้วเปิดสวิตช์ Cesium ion เพื่อลองใหม่",
  "imagery.osmFailed": "ชิ้นภาพ OpenStreetMap ส่วนใหญ่โหลดไม่ได้ (tile.openstreetmap.org อาจบล็อกการใช้งานนี้ หรืออินเทอร์เน็ตหลุด) ส่วนที่โหลดไม่ได้จึงว่างอยู่ ปิดสวิตช์ OpenStreetMap ได้ที่หน้าต่าง Globe Manager",

  // หน้าต่าง Globe Manager (spec imagery §5.1, spec ภาพละเอียด §4.3): สี่กลุ่มตามแหล่ง แต่ละกลุ่มมีสวิตช์และกล่องยืนยันของตัวเอง
  // กล่องยืนยันต้องบอก host ที่ติดต่อจริงและบอกว่าใครเป็นผู้ติดต่อ: GIBS และ EOX ผ่าน server ในเครื่องนี้ (host ตรงกับ GIBS_URL / EOX_URL ใน server/imagery.py ซึ่ง test ตรวจ)
  // ส่วน OpenStreetMap (OSM_URL ใน stores/imagery.ts) และ Cesium ion (api.cesium.com) browser ดึงเอง (ข้อความต้องไม่บอกว่าเก็บที่ data/imagery หรือใช้ User-Agent ของ server)
  "globe.consent": "เปิดภาพพื้นโลกออนไลน์จาก NASA GIBS หรือไม่? โปรแกรมจะเชื่อมต่ออินเทอร์เน็ตไปที่ gibs.earthdata.nasa.gov ผ่าน server ในเครื่องนี้ คำขอที่ส่งออกไปมีชื่อชั้นภาพ เวลา และพิกัดชิ้นภาพ (tile) ไม่มี scenario หรือตำแหน่งของคุณ แต่ NASA จะเห็นหมายเลข IP ของเครื่องนี้ (หรือของเครือข่ายที่ใช้ออกอินเทอร์เน็ต) และ User-Agent gnss-studio/0.1 เหมือนการเปิดเว็บทั่วไป ภาพที่ได้เก็บไว้ในเครื่องที่ data/imagery (ไม่เกิน 2 GB) และปิดได้ทุกเมื่อจากช่องนี้ในหน้าต่าง Globe Manager",
  "globe.consentEox": "เปิดภาพ Sentinel-2 cloudless (EOX) หรือไม่? โปรแกรมจะเชื่อมต่ออินเทอร์เน็ตไปที่ tiles.maps.eox.at ผ่าน server ในเครื่องนี้ คำขอที่ส่งออกไปมีชื่อชั้นภาพและพิกัดชิ้นภาพ (tile) ไม่มี scenario หรือตำแหน่งของคุณ แต่ EOX จะเห็นหมายเลข IP ของเครื่องนี้ (หรือของเครือข่ายที่ใช้ออกอินเทอร์เน็ต) และ User-Agent gnss-studio/0.1 เหมือนการเปิดเว็บทั่วไป ภาพที่ได้เก็บไว้ในเครื่องที่ data/imagery (รวมทุกแหล่งไม่เกิน 2 GB) ภาพนี้ใช้ได้เฉพาะงานไม่เชิงพาณิชย์และต้องแสดงเครดิต EOX (แสดงบนจอให้แล้ว) และปิดได้ทุกเมื่อจากช่องนี้ในหน้าต่าง Globe Manager",
  "globe.consentOsm": "เปิดแผนที่ OpenStreetMap หรือไม่? browser ของคุณจะเชื่อมต่ออินเทอร์เน็ตไปที่ tile.openstreetmap.org โดยตรง ไม่ผ่าน server ในเครื่องนี้ คำขอที่ส่งออกไปมีพิกัดชิ้นภาพ (tile) ไม่มี scenario หรือตำแหน่งของคุณ แต่ OpenStreetMap จะเห็นหมายเลข IP ของเครื่องนี้ (หรือของเครือข่ายที่ใช้ออกอินเทอร์เน็ต) User-Agent ของ browser และ Referer (ที่อยู่ของหน้านี้ http://127.0.0.1:<port>/) เหมือนการเปิดเว็บทั่วไป ชิ้นภาพถูกเก็บโดยแคชของ browser เอง ไม่ใช่โดยโปรแกรมนี้ ตามกติกาการใช้งานของ OpenStreetMap โปรแกรมขอเฉพาะชิ้นภาพที่กำลังแสดงอยู่ ห้ามนำไปดึงภาพจำนวนมากหรือเก็บไว้ใช้ออฟไลน์ และต้องแสดงเครดิต © OpenStreetMap contributors (แสดงบนจอให้แล้ว) ปิดได้ทุกเมื่อจากช่องนี้ในหน้าต่าง Globe Manager",
  "globe.consentIon": "เปิดภาพจาก Cesium ion หรือไม่? browser ของคุณจะเชื่อมต่ออินเทอร์เน็ตไปที่ api.cesium.com โดยตรง ไม่ผ่าน server ในเครื่องนี้ เพื่อขอข้อมูลของ asset แล้วดึงชิ้นภาพจากโฮสต์ภาพที่ Cesium ion ส่งต่อไป (เช่น Bing Maps หรือ Google Maps ตาม asset ที่เลือก) คำขอที่ส่งออกไปมี Cesium ion token ที่คุณตั้งไว้ รหัส asset และพิกัดชิ้นภาพ ไม่มี scenario หรือตำแหน่งของคุณ แต่ผู้ให้บริการเหล่านั้นจะเห็นหมายเลข IP ของเครื่องนี้ (หรือของเครือข่ายที่ใช้ออกอินเทอร์เน็ต) User-Agent ของ browser และ Referer (ที่อยู่ของหน้านี้ http://127.0.0.1:<port>/) ภาพของ Bing และ Google ห้ามนำมาซ้อนกับภาพแหล่งอื่น จึงขณะที่แสดงภาพ Cesium ion ชั้นภาพอื่นทั้งหมด (รวม Natural Earth II) จะถูกซ่อนไว้จนกว่าจะปิดสวิตช์นี้ บัญชี Community (ฟรี) ของ Cesium ion ใช้ได้เฉพาะงานไม่เชิงพาณิชย์ตามเงื่อนไขของ Cesium ปิดได้ทุกเมื่อจากช่องนี้ในหน้าต่าง Globe Manager",
  "globe.offHint": "สวิตช์ภาพออนไลน์ปิดอยู่ จึงใช้ชั้นภาพ NASA GIBS ด้านล่างไม่ได้ ตอนนี้แสดงเฉพาะภาพ Natural Earth II ที่มากับโปรแกรม (เปิดสวิตช์ด้านบนเพื่อใช้ชั้นภาพเหล่านี้)",
  "globe.offHintEox": "สวิตช์ Sentinel-2 cloudless ปิดอยู่ จึงใช้ชั้นภาพ Sentinel-2 cloudless ด้านล่างไม่ได้ (เปิดสวิตช์ด้านบนเพื่อใช้ชั้นภาพนี้)",
  "globe.offHintOsm": "สวิตช์ OpenStreetMap ปิดอยู่ จึงใช้ชั้นแผนที่ OpenStreetMap ด้านล่างไม่ได้ (เปิดสวิตช์ด้านบนเพื่อใช้ชั้นนี้)",
  "globe.offHintIon": "สวิตช์ Cesium ion ปิดอยู่ จึงยังไม่ใช้ภาพจาก Cesium ion (เปิดสวิตช์ด้านบน เลือก asset และใส่ token แล้วภาพ Cesium ion จะแสดงแทนชั้นภาพอื่นทั้งหมด)",
  "globe.unavailable": "อ่านสวิตช์และรายการชั้นภาพออนไลน์จาก server ไม่ได้ จึงใช้ภาพออนไลน์ทุกแหล่งไม่ได้ในตอนนี้ แสดงเฉพาะภาพ Natural Earth II ที่มากับโปรแกรม (ลองโหลดหน้าใหม่เมื่อ server พร้อม)",
  "globe.hiddenByIon": "ถูกซ่อนเพราะเปิด Cesium ion อยู่",
  // Cesium ion: token (ไม่แสดงค่าบนจอ บอกแค่ว่ามีหรือไม่) และ asset
  "globe.ionTokenSet": "มี Cesium ion token แล้ว (ไม่แสดงค่าบนจอ) พิมพ์ token ใหม่แล้วกด Apply เพื่อเปลี่ยน",
  "globe.ionTokenUnset": "ยังไม่ได้ใส่ Cesium ion token ใส่ token ของบัญชี ion.cesium.com ในช่องด้านบนแล้วกด Apply",
  "globe.ionTokenUnknown": "ยังอ่านค่าตั้งจาก server ไม่ได้ จึงยังไม่ทราบว่ามี token หรือไม่ (บันทึก token ใหม่ได้ตามปกติ)",
  "globe.ionTokenSaveFailed": "บันทึก Cesium ion token ไม่สำเร็จ: {message} (token ที่บันทึกไว้ยังเป็นค่าเดิม)",
  "globe.ionAssetInvalid": "Asset ID ต้องเป็นจำนวนเต็มบวก เช่น 3830182",
  "globe.ionNoAsset": "ยังไม่ได้เลือก asset จึงยังไม่แสดงภาพ Cesium ion (เลือก asset ด้านล่าง)",
  "globe.ionNoToken": "ยังไม่มี Cesium ion token จึงยังไม่แสดงภาพ Cesium ion (ชั้นภาพอื่นแสดงตามเดิม) ใส่ token ในช่องด้านบนแล้วกด Apply",
  "globe.ionRejected": "Cesium ion ไม่รับ asset หรือ token นี้ จึงถอดภาพ Cesium ion ออกและแสดงชั้นภาพอื่นตามเดิม (ดูเหตุผลที่ Message Viewer) เลือก asset อื่นหรือเปลี่ยน token เพื่อลองใหม่",

  // งานที่ต่ออินเทอร์เน็ต ต้องขอยืนยันก่อนทุกครั้ง
  "fetch.confirm": `ดึงข้อมูลวงโคจรตอนนี้หรือไม่? โปรแกรมอาจเชื่อมต่ออินเทอร์เน็ตเพื่อดาวน์โหลดจาก ${SOURCES} (ข้อมูลวงโคจรจาก CelesTrak, ข้อมูลดาวเทียมจาก IGS, broadcast ephemeris จาก CDDIS) CelesTrak จำกัดความถี่ในการดึงและ IGS ดึงไม่เกินวันละครั้ง ส่วนที่ยังไม่ถึงเวลา server จะใช้ไฟล์เดิมแทน แต่แหล่งอื่นในรายการนี้ยังอาจถูกดาวน์โหลด`,
  "fetch.nextAvailable": "ดึงจาก CelesTrak ได้อีกครั้งเวลา {time} (Fetch Now ก่อนหน้านั้นจะใช้ข้อมูล CelesTrak เดิม แต่ยังอาจเชื่อมต่อ IGS และ CDDIS)",
  "daily.runNowConfirm": `รันงานประจำวันตอนนี้หรือไม่? งานนี้จะเชื่อมต่ออินเทอร์เน็ตเพื่อดาวน์โหลดข้อมูลวงโคจรจาก ${SOURCES} (CelesTrak และ IGS ใช้ไฟล์เดิมถ้ายังไม่ถึงเวลาดึงใหม่) แล้วคำนวณ forecast ใหม่ ใช้เวลาสักครู่`,

  // Workbook (W6) ไม่เกิน 1,048,576 ไบต์
  "workbook.tooLarge": "การจัดวางหน้าต่างมีขนาดเกิน 1 MB จึงบันทึกลง workbook ไม่ได้ ปิดหน้าต่างหรือแถบที่ไม่ใช้แล้วลองบันทึกอีกครั้ง",
  "workbook.saveFailed": "บันทึก workbook (การจัดวางหน้าต่าง) ไม่สำเร็จ: {message}",
  "workbook.loadFailed": "อ่าน workbook (การจัดวางหน้าต่างที่บันทึกไว้) ของ scenario \"{name}\" ไม่สำเร็จ ({message}) จึงใช้การจัดวางตั้งต้นแทน",
  "workbook.invalid": "workbook (การจัดวางหน้าต่างที่บันทึกไว้) ใช้ไม่ได้ เพราะรูปแบบไม่ถูกต้องหรือเป็นรุ่นที่โปรแกรมนี้ไม่รู้จัก จึงใช้การจัดวางตั้งต้นแทน",
  "workbook.restoreFailed": "จัดหน้าต่างตาม workbook ไม่สำเร็จ ({message}) จึงใช้การจัดวางตั้งต้นแทน",
  "workbook.noScenario": "ยังไม่ได้เปิด scenario จึงไม่มีที่ให้บันทึกการจัดวางหน้าต่าง",
  "workbook.noWorkspace": "พื้นที่ทำงานยังไม่พร้อม จึงบันทึกการจัดวางหน้าต่างไม่ได้",
  "workbook.unknownKind": "ข้ามหน้าต่างชนิด \"{kind}\" ใน workbook เพราะโปรแกรมรุ่นนี้ไม่รู้จักหน้าต่างชนิดนี้",

  // File → Save (บันทึกสำเร็จ; ที่ล้มเหลว saveWorkbook แจ้งเองแล้ว) และ File → Save As
  "workbook.saved": "บันทึก workbook แล้ว",
  "saveAs.noScenario": "ยังไม่ได้เปิด scenario จึง Save As ไม่ได้",
  "saveAs.workbookFailed": "บันทึก workbook ไม่สำเร็จ จึงยังไม่ได้ Save As (ดูรายละเอียดใน Message Viewer) แก้ปัญหาแล้วกด OK ใหม่ หรือกด Cancel",

  // ชื่อ scenario และเวลาในหน้าต่างสร้างและ Save As (กติกาเดียวกับ server: ตัวอักษร A-Z a-z ตัวเลข _ - ยาว 1-32 ตัว)
  "scenario.nameInvalid": "ชื่อ scenario ใช้ได้เฉพาะตัวอักษร A-Z a-z ตัวเลข _ และ - ยาว 1 ถึง 32 ตัว",

  // New Scenario Wizard
  "wizard.stopBeforeStart": "เวลา Stop ต้องอยู่หลังเวลา Start",
  "wizard.noSnapshot": "ยังไม่มี snapshot ข้อมูลวงโคจร ใช้ Utilities → Fetch Orbit Data เพื่อดึงข้อมูลก่อนสร้าง scenario",
  "wizard.orbitsFailed": "อ่านรายการ snapshot ข้อมูลวงโคจรไม่สำเร็จ: {message}",

  // Welcome
  "welcome.loading": "กำลังอ่านรายชื่อ scenario...",
  "welcome.empty": "ยังไม่มี scenario ในโฟลเดอร์ data/scenarios/ กด Create a Scenario เพื่อสร้างอันแรก",
  "welcome.listFailed": "อ่านรายชื่อ scenario ไม่สำเร็จ: {message}",

  // Help → STK UI Reference
  "stkRef.count": "แสดง {shown} จาก {total} รายการ",
  "stkRef.noMatch": "ไม่พบรายการที่ตรงกับคำค้น",

  // Timeline View (spec §10): แถวช่วงเวลาของ access ที่เปิด Timeline
  "timeline.notCurrent": "ยังไม่มีช่วงเวลาของ access นี้ เพราะผลลัพธ์ของ Facility ต้นทางไม่ตรงกับ scenario ปัจจุบันหรือยังไม่มี กด Apply ในหน้าต่าง 3D หรือ 2D เพื่อคำนวณใหม่",
  "timeline.failed": "ดึงช่วงเวลา access ของ {name} ไม่สำเร็จ: {message}",
  "timeline.badReply": "server ตอบรูปแบบช่วงเวลาที่อ่านไม่ได้",
  "timeline.empty": "ยังไม่มีแถวให้แสดง (ไม่มี access ที่เปิด Timeline หรือแถวถูก Remove from Timeline ไว้หมด)",
  // {time} = เวลา animation, {from} {to} = ช่วงที่เห็นอยู่ (View Port), {rows} = จำนวนแถว
  "timeline.canvas": "Timeline: เวลา animation {time} ช่วงที่เห็น {from} ถึง {to} มี {rows} แถว",
  // {name} = ชื่อแถว, {start} {stop} = ต้นและปลายช่วง, {duration} = ความยาว, {maxEl} = มุมเงยสูงสุด
  "timeline.interval": "{name}: {start} ถึง {stop} ({duration}, มุมเงยสูงสุด {maxEl}°)",
  "timeline.intervalNoElevation": "{name}: {start} ถึง {stop} ({duration})",

  // Message Viewer (spec §11)
  "mv.empty": "ไม่มีข้อความในแท็บนี้",
  "mv.noDetail": "ข้อความนี้ไม่มีรายละเอียดเพิ่มเติม",
  "mv.selectFirst": "เลือกข้อความก่อนจึงจะดูรายละเอียดได้",

  // หน้าต่างที่ยังไม่ได้ทำ (ตัวแทนชั่วคราวใน src/layout/panels.ts จนกว่างานของหน้าต่างนั้นจะลงทะเบียนของจริง)
  "panel.placeholder": "ยังไม่ทำ (งานถัดไป)",

  // error boundary (src/chrome/ErrorBoundary.tsx): ส่วนที่โยน exception ตอนวาด แสดงข้อความนี้แทน ส่วนอื่นยังทำงาน
  "panel.crashed": "หน้าต่างนี้เกิดข้อผิดพลาดจึงแสดงต่อไม่ได้ ค่าที่ยังไม่ได้ Apply ในหน้าต่างนี้อาจหายไป หน้าต่างอื่นยังใช้ได้ตามปกติ กด Retry เพื่อลองแสดงใหม่ หรือ Close เพื่อปิดหน้าต่างนี้ (รายละเอียดอยู่ใน Message Viewer)",
  "panel.crashedLog": "หน้าต่าง {window} เกิดข้อผิดพลาดและหยุดแสดง: {message}",
  // {part} = ชื่อส่วนจาก chrome.part.*
  "chrome.crashed": "{part}เกิดข้อผิดพลาดจึงแสดงไม่ได้ หน้าต่างต่าง ๆ ยังใช้ได้ กด Retry เพื่อลองแสดงใหม่ หรือโหลดหน้าใหม่ (รายละเอียดอยู่ใน Message Viewer)",
  "chrome.crashedLog": "{part}เกิดข้อผิดพลาดและหยุดแสดง: {message}",
  "chrome.part.header": "แถบเมนูและแถบเครื่องมือ",
  "chrome.part.footer": "แถบสถานะ",
  "chrome.part.dialogs": "กล่องโต้ตอบ",

  // Properties Browser (spec §8): โหลด/อ่านค่า ตรวจก่อน Apply และสถานะขัดแย้ง
  "props.loading": "กำลังอ่านค่าตั้งจาก server...",
  "props.loadFailed": "อ่านค่าตั้งของ \"{name}\" จาก server ไม่สำเร็จ: {message}",
  "props.unknownObject": "ไม่รู้จัก object \"{path}\" จึงเปิดหน้า Properties ไม่ได้",
  "props.conflicted": "ค่าของ object นี้ถูกแก้จากที่อื่นระหว่างที่คุณแก้ไขอยู่ กด Apply เพื่อเลือก Reload (ทิ้งค่าที่แก้ แล้วใช้ค่าของ server) หรือ Cancel (เก็บค่าที่แก้ไว้) จะไม่ส่งค่าไปทับของอีกที่",
  "props.notNumber": "ต้องเป็นตัวเลข",
  "props.notFinite": "ตัวเลขนี้ใหญ่เกินไป",
  "props.rangeBetween": "ต้องอยู่ระหว่าง {min} ถึง {max}",
  "props.rangeGreater": "ต้องมากกว่า {min}",
  "props.rangeAtLeast": "ต้องไม่น้อยกว่า {min}",
  "props.rangeOverUpTo": "ต้องมากกว่า {min} และไม่เกิน {max}",
  "props.rangeUnder": "ต้องไม่น้อยกว่า {min} และน้อยกว่า {max}",
  "props.maxBelowMin": "Max ต้องไม่น้อยกว่า Min",
  "props.notOption": "ค่านี้ไม่อยู่ในตัวเลือกที่กำหนด",
  "props.offsetInvalid": "offset ต้องอยู่ในรูป ±hh:mm เช่น +07:00 (ชั่วโมง 00 ถึง 23 นาที 00 ถึง 59)",
  "props.noConstraints": "ยังไม่มี constraint ที่ใช้งานอยู่ กด Add... เพื่อเพิ่ม",
  "props.noAvailable": "ไม่มีดาวที่ยังไม่ได้อยู่ใน Constellation นี้",
  "props.noFlags": "ไม่มีธงเตือน",
  "props.noCatalog": "ไม่พบดาวดวงนี้ใน catalog ของ snapshot ที่ scenario ใช้ จึงไม่มีข้อมูล PRN, SVN และธง",
  "props.generalError": "Apply ไม่สำเร็จ: {message}",

  // หมายเหตุในหน้า (spec §8, §11, W20)
  "note.readOnly": "หน้านี้อ่านอย่างเดียวใน v1",
  "note.visibleSidesBoth": "v1 วาดเส้นทางแบบ Both เสมอ ค่า Visible Sides ที่ตั้งจะถูกเก็บไว้แต่ยังไม่มีผลต่อภาพ",
  "note.passLabelsStored": "v1 ยังไม่วาดป้ายของ Show Pass Labels และ Show Path Labels ค่าที่ตั้งจะถูกเก็บไว้แต่ยังไม่มีผลต่อภาพ",
  "about.disclaimer": "ชื่อเมนู หน้าต่าง และหน้าตั้งค่าอ้างอิงคู่มือ STK 13.1.0 รายการที่ติดป้าย Added by GNSS Studio เป็นส่วนที่เพิ่มเอง GNSS Studio ไม่ใช่ผลิตภัณฑ์ของผู้พัฒนา STK",

  // Sensor และหน้าต่าง Sensor View ({satellite} = ชื่อดาว, {sensor} = ชื่อ sensor, {angle} = Cone Half Angle เป็นองศา)
  "sensorView.noPosition": "ดาว {satellite} ยังไม่มีตำแหน่ง ณ เวลานี้ (ยังไม่มีผลการคำนวณวงโคจร หรือเวลาอยู่นอกช่วงวิเคราะห์)",
  "sensorView.limit": "เปิด Sensor View พร้อมกันได้ไม่เกิน 4 หน้าต่าง ปิดบานใดบานหนึ่งก่อน",
  "sensorView.closedMissing": "ปิด Sensor View ของ {sensor} เพราะไม่มี sensor นี้ใน scenario แล้ว",
  "sensorView.created": "สร้าง {sensor} บน {satellite} (Cone Half Angle {angle}°)",
  "insert.noSatellite": "ต้องมีดาวใน scenario ก่อนจึงเพิ่ม Sensor ได้",
  "ob.sensorCopyUnsupported": "ยังคัดลอก Sensor ไม่ได้ในรุ่นนี้",
  // ข้อความบนแผ่นข้อมูล (HUD) ของ Sensor View: {lat}, {lon} = ละติจูด/ลองจิจูดจุดใต้ดาว, {alt} = ความสูงของดาว (km)
  "sensorView.hudSubPoint": "จุดใต้ดาว {lat}, {lon}",
  "sensorView.hudAltitude": "ความสูง {alt} km",
  "sensorView.hudCone": "Cone Half Angle {angle}°",
  // HUD ของโหมดกล้อง (imagery spec §5.3): {fov} = มุมกว้างด้านสั้น (องศา), {zoom} = ขั้นซูม, {image} = ชื่อชั้นภาพ NASA GIBS บนสุดและเวลาของภาพ
  "sensorView.hudFov": "มุมกว้าง FOV {fov}° ×{zoom}",
  "sensorView.hudImagery": "ภาพพื้นโลก: {image}",
  "sensorView.hudImageryMissing": "ภาพพื้นโลก: {image} — ไม่มีภาพเวลานี้",
  "sensorView.hudImageryFailed": "ภาพพื้นโลก: {image} — ชิ้นภาพส่วนใหญ่โหลดไม่ได้",
  "sensorView.hudImageryOffline": "ภาพพื้นโลก: Natural Earth II (ออฟไลน์)",
  "sensorView.hintGlobeManager": "เปิดภาพจริงได้ที่ View → Globe Manager",
  // ความกว้างพื้นที่ที่จุดใต้ดาวตามด้านสั้นของภาพ ({width} = ตัวเลข) และ "ภาพละเอียดสุดของแหล่งนี้แล้ว" ({level} = ระดับซูมสูงสุดของชั้นบนสุด) (imagery spec §4.4)
  "sensorView.hudGroundWidthKm": "ความกว้างพื้นที่ที่จุดใต้ดาวโดยประมาณ {width} km",
  "sensorView.hudGroundWidthM": "ความกว้างพื้นที่ที่จุดใต้ดาวโดยประมาณ {width} m",
  "sensorView.hudFinestLevel": "ภาพละเอียดสุดของแหล่งนี้แล้ว (ระดับ {level}) ภาพจะขยายจนเบลอ",
  // คำแนะนำของช่อง Width บนแถบ Sensor View (ความกว้างพื้นที่ที่จุดใต้ดาว → ระดับซูม)
  "sensorView.widthInvalid": "ใส่ความกว้างเป็นตัวเลขที่มากกว่า 0 ตามด้วย m หรือ km เช่น 500 m หรือ 1.5 km (ไม่ใส่หน่วย = m)",
  "sensorView.widthNoPosition": "ตั้งความกว้างไม่ได้ ดาวยังไม่มีตำแหน่ง ณ เวลานี้",
  // ความกว้างที่พิมพ์เกินช่วงที่ซูมถึง ({min} {max} = ความกว้างแคบสุด/กว้างสุดที่ความสูงตอนนี้ พร้อมหน่วย) ตั้งเป็นปลายช่วงที่ใกล้ที่สุดให้แล้ว
  "sensorView.widthClamped": "ความกว้างที่ความสูงนี้ตั้งได้ตั้งแต่ {min} ถึง {max} จึงตั้งเป็นค่าที่ใกล้ที่สุดให้",
  // style ใน My Styles (ไฟล์ data/styles ที่แก้มือ) หรือ Scenario Styles (scenario.json) ที่โครงไม่ครบ: ไม่แสดงในรายการ
  // {tier} = My Styles / Scenario Styles / Installed Styles, {field} = ช่องแรกที่ผิด เช่น content[0].elements
  "styles.malformed": "style \"{name}\" ใน {tier} มีโครงไม่ถูกต้องที่ช่อง {field} จึงไม่แสดงในรายการ แก้หรือลบ style นี้",
  "styles.malformedUnnamed": "style รายการที่ {n} ใน {tier} ไม่มีชื่อหรือไม่ใช่ object จึงไม่แสดงในรายการ แก้หรือลบ style นี้",
} as const satisfies Record<string, string>;

export type MsgKey = keyof typeof MESSAGES;
/** ทุกคีย์ (ให้ test ไล่ตรวจว่าทุกข้อความเป็นภาษาไทย) */
export const MSG_KEYS = Object.keys(MESSAGES) as MsgKey[];

export function msg(key: MsgKey, vars?: Record<string, string | number>): string {
  return fillPlaceholders(MESSAGES[key], vars);
}
