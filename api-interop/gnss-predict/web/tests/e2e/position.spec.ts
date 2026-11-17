// เกณฑ์ข้อ 3: ตำแหน่งดาวในหน้าต่าง 3D ณ เวลาใดๆ ต่างจาก predicted.sp3 ไม่เกิน 1 ม.
// predicted.sp3 เขียนเวลาเป็น GPST = UTC + 18 วินาที ตำแหน่งในไฟล์เป็น km ECEF; entityPositionEcef คืนเมตร ECEF

import { ephemHash, expect, openScenario, test, waitForScene } from "./fixtures";

const GPS_UTC_OFFSET_S = 18;
const TOLERANCE_M = 1;

/** ตำแหน่ง (เมตร) ของ `sat` ใน sp3 ณ เวลา UTC นั้น (หาแถว epoch เป็น GPST) */
function sp3Position(sp3: string, utc: Date, sat: string): [number, number, number] {
  const gpst = new Date(utc.getTime() + GPS_UTC_OFFSET_S * 1000);
  const p = (n: number, w = 2): string => String(n).padStart(w, " ");
  const epoch = `*  ${gpst.getUTCFullYear()} ${p(gpst.getUTCMonth() + 1)} ${p(gpst.getUTCDate())} ${p(gpst.getUTCHours())} ${p(gpst.getUTCMinutes())} ${p(gpst.getUTCSeconds())}.00000000`;
  const lines = sp3.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === epoch);
  expect(start, `epoch line "${epoch}" in predicted.sp3`).toBeGreaterThanOrEqual(0);
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("*"); i++) {
    if (lines[i].startsWith(`P${sat}`)) {
      const [x, y, z] = lines[i].slice(4).trim().split(/\s+/).slice(0, 3).map((km) => Number(km) * 1000);
      return [x, y, z];
    }
  }
  throw new Error(`P${sat} not found in the epoch ${epoch}`);
}

const distance = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("3D positions agree with predicted.sp3 to one metre", async ({ page, request }) => {
  const hash = await ephemHash(request, "E2E");
  const reply = await request.get(`/api/scenarios/E2E/ephem/${hash}/predicted.sp3`);
  expect(reply.ok()).toBe(true);
  const sp3 = await reply.text();

  await openScenario(page, "E2E");
  await waitForScene(page);

  // 01:02:30 ตรงหัวข้อเกณฑ์ (ไม่ใช่จุดตัวอย่างของ CZML ซึ่งเก็บทุก 5 นาที จึงทดสอบการสอดแทรกจริง) 02:20:00 เป็นจุดตัวอย่าง 06:00:00 เป็นปลายช่วง
  for (const iso of ["2026-11-10T01:02:30Z", "2026-11-10T02:20:00Z", "2026-11-10T03:47:30Z", "2026-11-10T06:00:00Z"]) {
    await page.evaluate((t) => window.__gnssStudioTest!.setTime(t), iso);
    const expected = sp3Position(sp3, new Date(iso), "G01");
    await expect
      .poll(async () => {
        const got = await page.evaluate(() => window.__gnssStudioTest!.entityPositionEcef("G01"));
        return got === null ? Number.POSITIVE_INFINITY : distance(got, expected);
      }, { message: `G01 at ${iso}` })
      .toBeLessThanOrEqual(TOLERANCE_M);
  }
});
