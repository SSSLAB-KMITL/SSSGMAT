// ตัวสะสมล้อเมาส์ของการซูม Sensor View (src/windows/SensorView/wheelZoom.ts) นาฬิกาฉีดจาก test
// trackpad ของ macOS ส่งเหตุการณ์ล้อถี่ ๆ ที่ deltaY เล็ก: ห้ามนับทีละเหตุการณ์ (เดิมปัดนิ้วครั้งเดียว ×1 → ×128)
// - สะสม deltaY เป็นพิกเซล (deltaMode 1 = บรรทัด ×33, 2 = หน้า ×ความสูงหน้าต่าง) ครบ 100 px = หนึ่งขั้น
// - ไม่เกินหนึ่งขั้นต่อ 150 ms; เงียบเกิน 200 ms เริ่มสะสมใหม่

import { describe, expect, test } from "vitest";
import { createWheelZoom, LINE_PX, STEP_PX, STEP_INTERVAL_MS, IDLE_RESET_MS } from "../../src/windows/SensorView/wheelZoom";

function setup() {
  let t = 1000;
  const wheel = createWheelZoom({ now: () => t, pageHeight: () => 800 });
  const steps: number[] = [];
  const feed = (deltaY: number, deltaMode = 0): void => {
    const s = wheel.step({ deltaY, deltaMode });
    if (s !== 0) steps.push(s);
  };
  return { feed, steps, advance: (ms: number) => void (t += ms) };
}

describe("createWheelZoom", () => {
  test("constants match the brief", () => {
    expect([LINE_PX, STEP_PX, STEP_INTERVAL_MS, IDLE_RESET_MS]).toEqual([33, 100, 150, 200]);
  });

  test("20 small trackpad events of −4 within 100 ms: no step", () => {
    const { feed, steps, advance } = setup();
    for (let i = 0; i < 20; i++) {
      feed(-4);
      advance(5);
    }
    expect(steps).toEqual([]);
  });

  test("a trackpad swipe of 30 events of −40 at 10 ms spacing: at most 2 steps, all zoom in", () => {
    const { feed, steps, advance } = setup();
    for (let i = 0; i < 30; i++) {
      feed(-40);
      advance(10);
    }
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.length).toBeLessThanOrEqual(2);
    expect(steps.every((s) => s === 1)).toBe(true);
  });

  test("one mouse notch (deltaMode 0, −100) = one step in; +100 = one step out", () => {
    const { feed, steps, advance } = setup();
    feed(-100);
    expect(steps).toEqual([1]);
    advance(300);
    feed(100);
    expect(steps).toEqual([1, -1]);
  });

  test("two notches 300 ms apart = two steps", () => {
    const { feed, steps, advance } = setup();
    feed(-100);
    advance(300);
    feed(-100);
    expect(steps).toEqual([1, 1]);
  });

  test("two notches 50 ms apart = one step (at most one step per 150 ms)", () => {
    const { feed, steps, advance } = setup();
    feed(-100);
    advance(50);
    feed(-100);
    expect(steps).toEqual([1]);
  });

  test("a pause longer than 200 ms starts the sum again", () => {
    const { feed, steps, advance } = setup();
    feed(-60);
    advance(250);
    feed(-60);
    expect(steps).toEqual([]);
    advance(100);
    feed(-60);
    expect(steps).toEqual([1]);
  });

  test("line mode (deltaMode 1, a notched wheel in Firefox) counts 33 px per line but each event is at least one step's worth", () => {
    const { feed, steps, advance } = setup();
    feed(-3, 1); // 99 px: Firefox ส่ง 3 บรรทัดต่อหนึ่งรอยล้อ
    expect(steps).toEqual([1]);
    advance(300);
    feed(-1, 1);
    expect(steps).toEqual([1, 1]);
    advance(50);
    feed(-6, 1); // ยังไม่ครบ 150 ms
    expect(steps).toEqual([1, 1]);
  });

  test("page mode (deltaMode 2) counts the page height per page", () => {
    const { feed, steps } = setup();
    feed(0.2, 2); // 160 px
    expect(steps).toEqual([-1]);
  });

  test("deltaY 0 (horizontal scroll) does nothing", () => {
    const { feed, steps } = setup();
    for (let i = 0; i < 10; i++) feed(0);
    expect(steps).toEqual([]);
  });
});
