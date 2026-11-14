// ตัวเลือกโมเดลของดาว (src/cesium/satModels.ts): block → fallback_blocks → norad_ids → fallback ตาม models/catalog.json จริง
// (spec โมเดล 3 มิติ §1 ข้อ 1) และการโหลด /models/catalog.json ครั้งเดียว

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveModel, type ModelCatalog } from "../../src/cesium/satModels";
import { stubFetch } from "./helpers/fake-fetch";

const CATALOG_PATH = resolve(import.meta.dirname, "../../../models/catalog.json");
const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as ModelCatalog;

describe("resolveModel by block", () => {
  test("GPS-IIF → gps-iif", () => {
    expect(resolveModel(catalog, { block: "GPS-IIF", norad: 40730 })).toEqual({
      id: "gps-iif",
      url: "/models/gps-iif/gps-iif.glb",
      wings: "two",
      eo: false,
    });
  });

  test("GAL-2 → galileo-foc, and the url is the catalog's glb path (file name is galileo_foc.glb, not the id)", () => {
    const r = resolveModel(catalog, { block: "GAL-2", norad: 41549 });
    expect(r.id).toBe("galileo-foc");
    expect(r.url).toBe("/models/galileo-foc/galileo_foc.glb");
    expect(r.eo).toBe(false);
  });

  test("QZS-2I → qzss-igso", () => {
    expect(resolveModel(catalog, { block: "QZS-2I", norad: 42965 }).id).toBe("qzss-igso");
  });

  test("every block listed by every model resolves to that model, with the url of its glb", () => {
    const seen = new Map<string, string>();
    for (const m of catalog.models) for (const b of m.blocks ?? []) if (!seen.has(b)) seen.set(b, m.id);
    expect(seen.size).toBeGreaterThan(30);
    for (const [block, id] of seen) {
      const r = resolveModel(catalog, { block, norad: null });
      expect(r.id, block).toBe(id);
      expect(r.url, block).toBe(`/models/${catalog.models.find((m) => m.id === id)!.glb}`);
      expect(r.eo, block).toBe(false);
    }
  });

  test("a block wins over a NORAD id of an earth-observation model", () => {
    const r = resolveModel(catalog, { block: "GPS-IIF", norad: 41836 });
    expect(r.id).toBe("gps-iif");
    expect(r.eo).toBe(false);
  });

  test("blocks match exactly (case and spelling), so a near miss is not a hit", () => {
    expect(resolveModel(catalog, { block: "gps-iif", norad: null }).id).toBe("generic");
    expect(resolveModel(catalog, { block: "GPS-IIF ", norad: null }).id).toBe("generic");
  });
});

describe("resolveModel fallbacks", () => {
  test("a fallback block → generic (not eo)", () => {
    expect(catalog.fallback_blocks.length).toBeGreaterThan(0);
    for (const block of catalog.fallback_blocks) {
      const r = resolveModel(catalog, { block, norad: null });
      expect(r, block).toEqual({ id: "generic", url: "/models/generic/generic.glb", wings: "two", eo: false });
    }
  });

  test("a fallback block is decided before norad_ids (documented order block → fallback_blocks → norad_ids)", () => {
    expect(resolveModel(catalog, { block: "GPS-IIA", norad: 41836 }).id).toBe("generic");
  });

  test("unknown block and unknown NORAD → generic", () => {
    expect(resolveModel(catalog, { block: "NOT-A-BLOCK", norad: 99999 })).toEqual({
      id: "generic",
      url: "/models/generic/generic.glb",
      wings: "two",
      eo: false,
    });
  });

  test("no block and no NORAD → generic", () => {
    expect(resolveModel(catalog, { block: null, norad: null }).id).toBe("generic");
  });
});

describe("resolveModel by NORAD (earth-observation models)", () => {
  test("NORAD 41836 → himawari-9 with eo true, even with an unknown block", () => {
    const expected = { id: "himawari-9", url: "/models/himawari-9/himawari-9.glb", wings: "single", eo: true };
    expect(resolveModel(catalog, { block: null, norad: 41836 })).toEqual(expected);
    expect(resolveModel(catalog, { block: "NOT-A-BLOCK", norad: 41836 })).toEqual(expected);
  });

  test("a null block with a known NORAD → that model, for every norad_ids entry in the catalog", () => {
    let n = 0;
    for (const m of catalog.models)
      for (const norad of m.norad_ids ?? []) {
        n += 1;
        const r = resolveModel(catalog, { block: null, norad });
        expect(r.id, `${m.id} ${norad}`).toBe(m.id);
        expect(r.eo, `${m.id} ${norad}`).toBe(true);
        expect(r.url).toBe(`/models/${m.glb}`);
      }
    expect(n).toBeGreaterThanOrEqual(10);
  });

  test("without a NORAD id the result is never eo", () => {
    expect(resolveModel(catalog, { block: null, norad: null }).eo).toBe(false);
  });
});

describe("resolveModel wings", () => {
  test("wings come from wing_nodes: two nodes → two, one node → single (real catalog)", () => {
    for (const m of catalog.models) {
      const nodes = m.wing_nodes ?? [];
      const sat = (m.blocks ?? []).length > 0 ? { block: m.blocks![0]!, norad: null } : { block: null, norad: (m.norad_ids ?? [])[0] ?? null };
      if (m.id === "generic") continue; // reached by fallback, checked above
      expect(resolveModel(catalog, sat).wings, m.id).toBe(nodes.length === 1 ? "single" : "two");
    }
    expect(resolveModel(catalog, { block: null, norad: 25994 }).wings).toBe("single"); // terra
    expect(resolveModel(catalog, { block: "GPS-IIF", norad: null }).wings).toBe("two");
  });

  test("without wing_nodes: single for the earth-observation ids, two for everything else", () => {
    const bare: ModelCatalog = {
      version: 1,
      frame: "x",
      overrides: {},
      fallback: "generic",
      fallback_blocks: [],
      models: [
        { id: "generic", glb: "generic/generic.glb", blocks: [], size_m: [1, 1, 1], triangles: 1, status: "done" },
        { id: "gps-iif", glb: "gps-iif/gps-iif.glb", blocks: ["GPS-IIF"], size_m: [1, 1, 1], triangles: 1, status: "done" },
        { id: "terra", glb: "terra/terra.glb", blocks: [], norad_ids: [25994], size_m: [1, 1, 1], triangles: 1, status: "done" },
        { id: "goes", glb: "goes/goes.glb", blocks: [], norad_ids: [41866], size_m: [1, 1, 1], triangles: 1, status: "done" },
      ],
    };
    expect(resolveModel(bare, { block: "GPS-IIF", norad: null }).wings).toBe("two");
    expect(resolveModel(bare, { block: null, norad: 25994 }).wings).toBe("single");
    expect(resolveModel(bare, { block: null, norad: 41866 }).wings).toBe("single");
    expect(resolveModel(bare, { block: null, norad: null }).wings).toBe("two"); // generic
  });

  test("wing_nodes in the catalog beat the EO list", () => {
    const odd: ModelCatalog = {
      version: 1,
      frame: "x",
      overrides: {},
      fallback: "generic",
      fallback_blocks: [],
      models: [
        { id: "generic", glb: "generic/generic.glb", blocks: [], size_m: [1, 1, 1], triangles: 1, status: "done", wing_nodes: ["wing-Y"] },
        { id: "terra", glb: "terra/terra.glb", blocks: [], norad_ids: [25994], size_m: [1, 1, 1], triangles: 1, status: "done", wing_nodes: ["wing+Y", "wing-Y"] },
      ],
    };
    expect(resolveModel(odd, { block: null, norad: 25994 }).wings).toBe("two");
    expect(resolveModel(odd, { block: null, norad: null }).wings).toBe("single");
  });
});

describe("resolveModel with an odd catalog", () => {
  test("a block listed by two models goes to the first one in catalog order; a NORAD id likewise", () => {
    const dup: ModelCatalog = {
      version: 1,
      frame: "x",
      overrides: {},
      fallback: "generic",
      fallback_blocks: [],
      models: [
        { id: "generic", glb: "generic/generic.glb", blocks: [], size_m: [1, 1, 1], triangles: 1, status: "done" },
        { id: "a", glb: "a/a.glb", blocks: ["DUP"], norad_ids: [7], size_m: [1, 1, 1], triangles: 1, status: "done" },
        { id: "b", glb: "b/b.glb", blocks: ["DUP"], norad_ids: [7], size_m: [1, 1, 1], triangles: 1, status: "done" },
      ],
    };
    expect(resolveModel(dup, { block: "DUP", norad: null }).id).toBe("a");
    expect(resolveModel(dup, { block: null, norad: 7 }).id).toBe("a");
  });

  test("a model with no blocks / norad_ids fields at all is only reachable as the fallback", () => {
    const sparse: ModelCatalog = {
      version: 1,
      frame: "x",
      overrides: {},
      fallback: "generic",
      fallback_blocks: [],
      models: [{ id: "generic", glb: "generic/generic.glb", size_m: [1, 1, 1], triangles: 1, status: "done" }],
    };
    expect(resolveModel(sparse, { block: "GPS-IIF", norad: 1 }).id).toBe("generic");
  });

  test("the same catalog object answers repeatedly with equal results (index is cached, not rebuilt wrongly)", () => {
    const a = resolveModel(catalog, { block: "GLO-M+", norad: null });
    const b = resolveModel(catalog, { block: "GLO-M+", norad: null });
    expect(a).toEqual(b);
    expect(a.id).toBe("glonass-m");
  });
});

describe("loadModelCatalog", () => {
  beforeEach(() => {
    vi.resetModules(); // each test gets a fresh module-level cache
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("fetches /models/catalog.json once and caches it", async () => {
    const f = stubFetch({ "GET /models/catalog.json": { json: catalog } });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    const a = await loadModelCatalog();
    const b = await loadModelCatalog();
    expect(f.count("GET /models/catalog.json")).toBe(1);
    expect(b).toBe(a);
    expect(a.models.map((m) => m.id)).toEqual(catalog.models.map((m) => m.id));
  });

  test("callers that ask while the first fetch is in flight share it", async () => {
    const f = stubFetch({ "GET /models/catalog.json": { json: catalog } });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    const [a, b, c] = await Promise.all([loadModelCatalog(), loadModelCatalog(), loadModelCatalog()]);
    expect(f.count("GET /models/catalog.json")).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("the loaded catalog resolves like the file does", async () => {
    stubFetch({ "GET /models/catalog.json": { json: catalog } });
    const { loadModelCatalog, resolveModel: resolveFresh } = await import("../../src/cesium/satModels");
    const loaded = await loadModelCatalog();
    expect(resolveFresh(loaded, { block: "GPS-IIF", norad: null }).id).toBe("gps-iif");
  });

  test("a failure is not cached: a 404, then a good answer, loads", async () => {
    let calls = 0;
    const f = stubFetch({ "GET /models/catalog.json": () => (++calls === 1 ? { status: 404, text: "nope" } : { json: catalog }) });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    await expect(loadModelCatalog()).rejects.toThrow(/404/);
    const cat = await loadModelCatalog();
    expect(cat.fallback).toBe("generic");
    expect(f.count("GET /models/catalog.json")).toBe(2);
  });

  test("an HTML answer (the server's SPA fallback when the file is missing) is rejected, not mistaken for a catalog", async () => {
    stubFetch({ "GET /models/catalog.json": { text: "<!doctype html><title>app</title>", headers: { "content-type": "text/html" } } });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    await expect(loadModelCatalog()).rejects.toThrow();
  });

  test("a catalog without models is rejected", async () => {
    stubFetch({ "GET /models/catalog.json": { json: { version: 1, models: [], fallback: "generic" } } });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    await expect(loadModelCatalog()).rejects.toThrow(/models/);
  });

  test("a catalog whose fallback is not one of its models is rejected", async () => {
    stubFetch({ "GET /models/catalog.json": { json: { version: 1, models: [catalog.models[0]], fallback: "generic" } } });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    await expect(loadModelCatalog()).rejects.toThrow(/fallback "generic"/);
  });

  test("a catalog that is not an object is rejected", async () => {
    stubFetch({ "GET /models/catalog.json": { json: [1, 2, 3] } });
    const { loadModelCatalog } = await import("../../src/cesium/satModels");
    await expect(loadModelCatalog()).rejects.toThrow();
  });

  test("a missing fallback_blocks or overrides field is filled in empty", async () => {
    const lean = { version: 1, frame: "x", fallback: "generic", models: [catalog.models.find((m) => m.id === "generic")!] };
    stubFetch({ "GET /models/catalog.json": { json: lean } });
    const { loadModelCatalog, resolveModel: resolveFresh } = await import("../../src/cesium/satModels");
    const cat = await loadModelCatalog();
    expect(cat.fallback_blocks).toEqual([]);
    expect(cat.overrides).toEqual({});
    expect(resolveFresh(cat, { block: "GPS-IIA", norad: null }).id).toBe("generic");
  });
});

describe("unit-test guard for /models (tests/unit/setup.ts)", () => {
  const settledWithin = (p: Promise<unknown>, ms: number): Promise<string> =>
    Promise.race([p.then(() => "resolved", () => "rejected"), new Promise<string>((r) => setTimeout(() => r("pending"), ms))]);

  test("an unstubbed fetch of a model file never reaches the network: it stays pending (satellites stay points, no warning)", async () => {
    expect(await settledWithin(fetch("/models/catalog.json"), 50)).toBe("pending");
    expect(await settledWithin(fetch("/models/gps-iif/gps-iif.glb"), 50)).toBe("pending");
    // แม้ URL เต็ม (port ที่ปิดอยู่จะ reject ทันทีถ้าออกไปจริง)
    expect(await settledWithin(fetch("http://127.0.0.1:9/models/catalog.json"), 50)).toBe("pending");
    expect(await settledWithin(fetch(new URL("http://127.0.0.1:9/models/x.glb")), 50)).toBe("pending");
    expect(await settledWithin(fetch(new Request("http://127.0.0.1:9/models/x.glb")), 50)).toBe("pending");
  });

  test("other URLs are not touched by the guard", async () => {
    expect(await settledWithin(fetch("http://127.0.0.1:9/api/health"), 2000)).toBe("rejected");
  });
});
