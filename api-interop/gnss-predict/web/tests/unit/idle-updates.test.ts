// skipIdleDisplayUpdates (src/cesium/idleUpdates.ts): ข้าม DataSourceDisplay.update เมื่อไม่มีอะไรเปลี่ยน และกลับมา update เมื่อเวลา entity
// หรือ data source เปลี่ยน ใช้ EntityCollection / DataSourceCollection จริงของ Cesium (ไม่ต้องมี WebGL) กับ display ปลอม

import { Cartesian3, CustomDataSource, DataSourceCollection, EntityCollection, JulianDate } from "cesium";
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
  return { original, display, v: { dataSourceDisplay: display, entities: new EntityCollection(), dataSources: new DataSourceCollection() } };
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
    expect(Object.hasOwn(display, "update")).toBe(true);
    idle.dispose();
    expect(Object.hasOwn(display, "update")).toBe(false); // prototype method again
    display.update(t0);
    display.update(t0);
    expect(original).toHaveBeenCalledTimes(2); // ไม่ข้ามแล้ว
    expect(v.entities.collectionChanged.numberOfListeners).toBe(0);
    idle.dispose(); // ซ้ำได้
  });

  test("an own update method (not from the prototype) is put back as it was", () => {
    const own = vi.fn(() => true);
    const display = { update: own };
    const idle = skipIdleDisplayUpdates({ dataSourceDisplay: display, entities: new EntityCollection(), dataSources: new DataSourceCollection() });
    expect(display.update).not.toBe(own);
    idle.dispose();
    expect(display.update).toBe(own);
  });
});
