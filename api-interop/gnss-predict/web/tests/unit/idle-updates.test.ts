// skipIdleDisplayUpdates (src/cesium/idleUpdates.ts): ข้าม DataSourceDisplay.update เมื่อไม่มีอะไรเปลี่ยน และกลับมา update เมื่อเวลา entity
// data source หรือ primitive ของ scene เปลี่ยน (primitive ที่ visualizer เพิ่มทีหลังและ primitive ที่พร้อมทีหลัง: โมเดล 3 มิติ)
// ใช้ EntityCollection / DataSourceCollection / PrimitiveCollection / Event จริงของ Cesium (ไม่ต้องมี WebGL) กับ display และโมเดลปลอม

import { Cartesian3, CustomDataSource, DataSourceCollection, EntityCollection, Event, JulianDate, PrimitiveCollection } from "cesium";
import { describe, expect, test, vi } from "vitest";
import { skipIdleDisplayUpdates } from "../../src/cesium/idleUpdates";

const t0 = JulianDate.fromIso8601("2026-11-11T00:00:00Z");
const t1 = JulianDate.fromIso8601("2026-11-11T00:01:00Z");

function viewer(ready = true) {
  const original = vi.fn((_time: JulianDate) => ready);
  class Display {
    update(time: JulianDate): boolean {
      return original(time);
    }
  }
  const display = new Display();
  const scene = { primitives: new PrimitiveCollection(), requestRender: vi.fn() };
  return { original, display, scene, v: { dataSourceDisplay: display, entities: new EntityCollection(), dataSources: new DataSourceCollection(), scene } };
}

/** primitive แบบ Model ของ Cesium: ModelVisualizer เพิ่มเข้า scene.primitives หลัง Model.fromGltfAsync เสร็จ แล้วมัน ready ทีหลังอีกที (readyEvent) */
function fakeModel() {
  return { readyEvent: new Event(), update: vi.fn(), isDestroyed: () => false, destroy: vi.fn() };
}

describe("skipIdleDisplayUpdates", () => {
  test("skips an update when the time and the entities are unchanged, and resumes when the time moves", () => {
    const { original, display, v } = viewer();
    skipIdleDisplayUpdates(v);
    expect(display.update(t0)).toBe(true);
    expect(display.update(t0)).toBe(true);
    expect(display.update(JulianDate.clone(t0))).toBe(true);
    expect(original).toHaveBeenCalledTimes(1);
    display.update(t1);
    expect(original).toHaveBeenCalledTimes(2);
  });

  test("an entity added, removed or changed makes the next update run", () => {
    const { original, display, v } = viewer();
    skipIdleDisplayUpdates(v);
    display.update(t0);
    const e = v.entities.add({ id: "x", position: Cartesian3.ZERO });
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
    e.show = false; // ค่าของ entity เปลี่ยน
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(3);
    v.entities.remove(e);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(4);
  });

  test("entities of data sources added later are watched; a data source added or removed counts as a change", async () => {
    const { original, display, v } = viewer();
    skipIdleDisplayUpdates(v);
    display.update(t0);
    const ds = new CustomDataSource("later");
    await v.dataSources.add(ds);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
    ds.entities.add({ id: "y", position: Cartesian3.ZERO });
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(3);
    v.dataSources.remove(ds);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(4);
    ds.entities.add({ id: "z", position: Cartesian3.ZERO }); // ไม่อยู่ใน viewer แล้ว: ไม่ต้อง update
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(4);
  });

  test("keeps updating while the display is not ready yet", () => {
    const { original, display, v } = viewer(false);
    skipIdleDisplayUpdates(v);
    display.update(t0);
    display.update(t0);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(3);
  });

  test("a primitive added to the scene later (ModelVisualizer's model after Model.fromGltfAsync) makes the next update run and asks for a frame", () => {
    // ModelVisualizer ตั้ง modelMatrix, minimumPixelSize, สี, ขอบ ให้ Model ใน update() รอบหลังจากที่ Model ถูกเพิ่มเท่านั้น
    // ข้ามรอบนั้น = โมเดลค้างที่ modelMatrix ตั้งต้น (ศูนย์กลางโลก) ขนาดขั้นต่ำ 0: มองไม่เห็นแม้ ready และ show
    const { original, display, scene, v } = viewer();
    skipIdleDisplayUpdates(v);
    display.update(t0);
    scene.primitives.add(fakeModel());
    expect(scene.requestRender).toHaveBeenCalledTimes(1);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
  });

  test("a primitive that becomes ready later (Model.readyEvent: node transformations apply only then) makes the next update run, once", () => {
    const { original, display, scene, v } = viewer();
    skipIdleDisplayUpdates(v);
    const model = fakeModel();
    scene.primitives.add(model);
    display.update(t0);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(1);
    model.readyEvent.raiseEvent(model);
    expect(scene.requestRender).toHaveBeenCalledTimes(2);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
    expect(model.readyEvent.numberOfListeners).toBe(0); // ready ครั้งเดียว: เลิกฟังแล้ว
  });

  test("a primitive added and removed before it was ready is not listened to any more", () => {
    const { scene, v } = viewer();
    skipIdleDisplayUpdates(v);
    const model = fakeModel();
    scene.primitives.add(model);
    expect(model.readyEvent.numberOfListeners).toBe(1);
    scene.primitives.remove(model);
    expect(model.readyEvent.numberOfListeners).toBe(0);
  });

  test("touch() forces the next update", () => {
    const { original, display, v } = viewer();
    const idle = skipIdleDisplayUpdates(v);
    display.update(t0);
    idle.touch();
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2);
  });

  test("dispose restores the display's own update and stops listening", () => {
    const { original, display, v } = viewer();
    const idle = skipIdleDisplayUpdates(v);
    const pending = fakeModel();
    v.scene.primitives.add(pending);
    expect(Object.hasOwn(display, "update")).toBe(true);
    idle.dispose();
    expect(Object.hasOwn(display, "update")).toBe(false); // prototype method again
    display.update(t0);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2); // ไม่ข้ามแล้ว
    expect(v.entities.collectionChanged.numberOfListeners).toBe(0);
    expect(v.scene.primitives.primitiveAdded.numberOfListeners).toBe(0);
    expect(v.scene.primitives.primitiveRemoved.numberOfListeners).toBe(0);
    expect(pending.readyEvent.numberOfListeners).toBe(0);
    idle.dispose(); // ซ้ำได้
  });

  test("an own update method (not from the prototype) is put back as it was", () => {
    const own = vi.fn(() => true);
    const display = { update: own };
    const scene = { primitives: new PrimitiveCollection(), requestRender: vi.fn() };
    const idle = skipIdleDisplayUpdates({ dataSourceDisplay: display, entities: new EntityCollection(), dataSources: new DataSourceCollection(), scene });
    expect(display.update).not.toBe(own);
    idle.dispose();
    expect(display.update).toBe(own);
  });
});
