// การเลือกและโหลด data source ของหน้าต่าง 3D/2D (src/windows/graphics/sceneSource.ts): SceneSource ทดสอบด้วยตัวโหลดปลอม
// สำคัญ: โหลด scene ไม่สำเร็จ (เช่น server ปิดระหว่างดึง CZML: Review Focus 2) ต้องลองใหม่ได้ในการ refresh ครั้งถัดไปแม้ hash เท่าเดิม
// currentSceneUrls (URL ของผลที่ใช้ได้) และ CzmlScene (ตัวโหลด CZML จริง + การสลับ data source ใน viewer) ที่ทั้งสองหน้าต่างใช้ร่วมกัน

import { CzmlDataSource } from "cesium";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { msg } from "../../src/labels/messages.th";
import { useMessages } from "../../src/stores/messages";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { currentSceneUrls, CzmlScene, SceneSource, type SceneUrls } from "../../src/windows/graphics/sceneSource";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";

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

describe("currentSceneUrls", () => {
  const entry = (status: "current" | "stale" | "missing", hash: string | null) => ({ hash, status, available: [] });

  test("scene.czml of the current ephem, then access.czml of every current Facility in name order", () => {
    resetAll();
    openScenario(makeDoc({ name: "S" }));
    const info: ResultsInfo = {
      ephem: entry("current", "abc"),
      access: { ZZZ: entry("current", "z1"), THBK: entry("current", "def"), OLD: entry("stale", "old"), NEW: entry("missing", null) },
      error: null,
    };
    useResults.setState({ status: "current", info });
    expect(currentSceneUrls(useResults.getState())).toEqual({
      sceneUrl: "/api/scenarios/S/ephem/abc/scene.czml",
      accessUrls: ["/api/scenarios/S/access/THBK/def/access.czml", "/api/scenarios/S/access/ZZZ/z1/access.czml"],
    });
  });

  test("no current scene means no access files either (Facilities come from the doc)", () => {
    const results = { info: { ephem: entry("stale", "abc"), access: { THBK: entry("current", "def") }, error: null }, ephemUrl: () => null, accessUrl: () => "/a.czml" };
    expect(currentSceneUrls(results)).toEqual({ sceneUrl: null, accessUrls: [] });
    expect(currentSceneUrls({ info: null, ephemUrl: () => null, accessUrl: () => null })).toEqual({ sceneUrl: null, accessUrls: [] });
  });
});

describe("CzmlScene", () => {
  beforeEach(() => resetAll());

  /** viewer ปลอมที่จด data source ที่ถูกใส่และเอาออก */
  function fakeViewer() {
    const added: CzmlDataSource[] = [];
    const removed: CzmlDataSource[] = [];
    const viewer = {
      dataSources: {
        add: async (ds: CzmlDataSource) => (added.push(ds), ds),
        remove: (ds: CzmlDataSource) => (removed.push(ds), true),
      },
      isDestroyed: () => false,
    };
    return { viewer, added, removed };
  }

  test("a new data source replaces the old one in the viewer; a scene that cannot be read falls back to Facilities only, with the window named", async () => {
    const { viewer, added, removed } = fakeViewer();
    const adopted: [CzmlDataSource, boolean][] = [];
    const changed = vi.fn();
    const scene = new CzmlScene(viewer as never, { window: "2D", adopted: (ds, fromScene) => void adopted.push([ds, fromScene]), changed });
    scene.update({ sceneUrl: null, accessUrls: [] });
    await scene.idle();
    expect(adopted).toHaveLength(1);
    expect(adopted[0][1]).toBe(false);
    expect(scene.ds).toBe(added[0]);
    // CZML ที่อ่านไม่ได้ (data: URL ไม่ต่อเครือข่าย): แจ้งเตือนของหน้าต่าง 2D แล้วใช้ data source ว่างแทน ตัวเก่าถูกเอาออก
    scene.update({ sceneUrl: "data:application/json,not-json", accessUrls: [] });
    await scene.idle();
    expect(scene.failed()).toBe(true);
    expect(changed).toHaveBeenCalled();
    expect(adopted).toHaveLength(2);
    expect(scene.ds).toBe(added[1]);
    expect(removed).toEqual([added[0]]);
    const warning = useMessages.getState().items.at(-1);
    expect(warning?.code).toBe("SCENE_LOAD");
    expect(warning?.text.startsWith(msg("scene.loadFailed", { window: "2D", message: "\u0000" }).split("\u0000")[0])).toBe(true);
    scene.dispose();
  });
});
