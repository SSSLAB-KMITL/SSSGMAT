// การเลือกและโหลด data source ของหน้าต่าง 3D/2D (src/windows/graphics/sceneSource.ts) โดยไม่มี Cesium: ตัวโหลดเป็นตัวปลอม
// สำคัญ: โหลด scene ไม่สำเร็จ (เช่น server ปิดระหว่างดึง CZML: Review Focus 2) ต้องลองใหม่ได้ในการ refresh ครั้งถัดไปแม้ hash เท่าเดิม

import { describe, expect, test, vi } from "vitest";
import { SceneSource, type SceneUrls } from "../../src/windows/graphics/sceneSource";

type DS = { name: string };

function harness() {
  const adopted: [string, boolean][] = [];
  const discarded: string[] = [];
  const failures: unknown[] = [];
  let changes = 0;
  const load = vi.fn<(url: string, access: readonly string[], signal: AbortSignal) => Promise<DS>>();
  const source = new SceneSource<DS>({
    load,
    empty: async () => ({ name: "empty" }),
    adopt: (ds, scene) => void adopted.push([ds.name, scene]),
    discard: (ds) => void discarded.push(ds.name),
    failed: (e) => void failures.push(e),
    changed: () => void changes++,
  });
  return { source, load, adopted, discarded, failures, changes: () => changes };
}

const CURRENT: SceneUrls = { sceneUrl: "/api/scenarios/S/ephem/abc/scene.czml", accessUrls: ["/api/scenarios/S/access/THBK/def/access.czml"] };
const NONE: SceneUrls = { sceneUrl: null, accessUrls: [] };

describe("SceneSource", () => {
  test("a scene that fails once is retried on the next refresh with the same hash and then shows the satellites", async () => {
    const h = harness();
    h.load.mockRejectedValueOnce(new Error("NETWORK")).mockResolvedValueOnce({ name: "scene" });
    expect(h.source.update(CURRENT)).toBe(true);
    await h.source.idle();
    expect(h.failures).toHaveLength(1);
    expect(h.source.failed()).toBe(true);
    expect(h.adopted).toEqual([["empty", false]]); // ระหว่างนั้นแสดง Facility อย่างเดียว
    expect(h.changes()).toBe(1);

    // SSE ต่อใหม่ → useResults.refresh() → URL (hash) เท่าเดิม: ต้องโหลดใหม่ ไม่ใช่แค่ตั้งกราฟิก
    expect(h.source.update(CURRENT)).toBe(true);
    await h.source.idle();
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.load.mock.calls[1].slice(0, 2)).toEqual([CURRENT.sceneUrl, CURRENT.accessUrls]);
    expect(h.adopted).toEqual([["empty", false], ["scene", true]]);
    expect(h.source.failed()).toBe(false);
    expect(h.changes()).toBe(2);
  });

  test("after a successful load the same URLs do not reload (graphics edits only restyle)", async () => {
    const h = harness();
    h.load.mockResolvedValue({ name: "scene" });
    expect(h.source.update(CURRENT)).toBe(true);
    await h.source.idle();
    expect(h.source.update({ ...CURRENT, accessUrls: [...CURRENT.accessUrls] })).toBe(false);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.source.failed()).toBe(false);
  });

  test("no current results = an empty data source (facilities only) and that is not a failure", async () => {
    const h = harness();
    expect(h.source.update(NONE)).toBe(true);
    await h.source.idle();
    expect(h.adopted).toEqual([["empty", false]]);
    expect(h.source.failed()).toBe(false);
    expect(h.changes()).toBe(0);
    expect(h.source.update(NONE)).toBe(false);
  });

  test("results going stale after a failure clear the failed state", async () => {
    const h = harness();
    h.load.mockRejectedValueOnce(new Error("NETWORK"));
    h.source.update(CURRENT);
    await h.source.idle();
    expect(h.source.failed()).toBe(true);
    h.source.update(NONE);
    await h.source.idle();
    expect(h.source.failed()).toBe(false);
  });

  test("a newer request wins: the older load is aborted, and if it still resolves it is discarded", async () => {
    const h = harness();
    let resolveFirst: (ds: DS) => void = () => undefined;
    h.load.mockImplementationOnce(() => new Promise<DS>((r) => (resolveFirst = r))).mockResolvedValueOnce({ name: "second" });
    h.source.update(CURRENT);
    const firstSignal = h.load.mock.calls[0][2];
    h.source.update({ ...CURRENT, sceneUrl: "/api/scenarios/S/ephem/xyz/scene.czml" });
    expect(firstSignal.aborted).toBe(true);
    resolveFirst({ name: "first" });
    await h.source.idle();
    expect(h.adopted).toEqual([["second", true]]);
    expect(h.discarded).toEqual(["first"]);
  });

  test("an aborted load is not a failure", async () => {
    const h = harness();
    h.load.mockImplementationOnce((_u, _a, signal) => new Promise<DS>((_r, reject) => signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError")))));
    h.load.mockResolvedValueOnce({ name: "second" });
    h.source.update(CURRENT);
    h.source.update({ ...CURRENT, sceneUrl: "/other.czml" });
    await h.source.idle();
    expect(h.failures).toEqual([]);
    expect(h.source.failed()).toBe(false);
  });

  test("after dispose nothing is adopted or reported", async () => {
    const h = harness();
    h.load.mockRejectedValueOnce(new Error("late"));
    h.source.update(CURRENT);
    h.source.dispose();
    await h.source.idle();
    expect(h.adopted).toEqual([]);
    expect(h.failures).toEqual([]);
    expect(h.source.update(CURRENT)).toBe(false);
  });
});
