// การส่งโมเดลไปกับหน้าเว็บ (web/modelsPackaging.ts ที่ vite.config.ts ใช้): ส่งเฉพาะ catalog.json กับ glb ที่ catalog ระบุ
// ไม่ส่ง _refs/ (ภาพอ้างอิงราว 55 MB), scripts/, renders/, vendor/, textures/ (spec โมเดล 3 มิติ §2)

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { modelFiles, modelsDevHandler, modelsPlugin } from "../../modelsPackaging";
import { resolveModel, type ModelCatalog } from "../../src/cesium/satModels";

const MODELS_DIR = resolve(import.meta.dirname, "../../../models");
const catalog = JSON.parse(readFileSync(join(MODELS_DIR, "catalog.json"), "utf8")) as ModelCatalog;
const FORBIDDEN = ["_refs", "scripts", "renders", "vendor", "textures", "_tools", "NOTES.md"];

describe("modelFiles (what the web build ships under /models/)", () => {
  test("is catalog.json plus exactly the glb of every catalog model", () => {
    const files = modelFiles(MODELS_DIR);
    expect(files).toEqual(["catalog.json", ...catalog.models.map((m) => m.glb)]);
    expect(files.length).toBe(catalog.models.length + 1);
  });

  test("every shipped file exists on disk, is not empty, and glbs start with the glTF magic", () => {
    for (const rel of modelFiles(MODELS_DIR)) {
      const abs = join(MODELS_DIR, rel);
      expect(existsSync(abs), rel).toBe(true);
      expect(statSync(abs).size, rel).toBeGreaterThan(0);
      if (rel.endsWith(".glb")) expect(readFileSync(abs).subarray(0, 4).toString("latin1"), rel).toBe("glTF");
    }
  });

  test("ships no _refs, scripts, renders, vendor, textures or notes", () => {
    for (const rel of modelFiles(MODELS_DIR)) {
      const parts = rel.split("/");
      for (const bad of FORBIDDEN) expect(parts, rel).not.toContain(bad);
      expect(rel.includes("_refs"), rel).toBe(false);
      expect(rel.startsWith("/") || parts.includes(".."), rel).toBe(false);
    }
  });

  test("is only catalog.json and .glb files, none twice", () => {
    const files = modelFiles(MODELS_DIR);
    expect(new Set(files).size).toBe(files.length);
    for (const rel of files) expect(rel === "catalog.json" || rel.endsWith(".glb"), rel).toBe(true);
  });

  test("the url of every model the resolver can return is one of the shipped files", () => {
    const shipped = new Set(modelFiles(MODELS_DIR).map((f) => `/models/${f}`));
    const sats = [
      { block: null, norad: null },
      ...catalog.models.flatMap((m) => (m.blocks ?? []).map((block) => ({ block, norad: null }))),
      ...catalog.models.flatMap((m) => (m.norad_ids ?? []).map((norad) => ({ block: null, norad }))),
      ...catalog.fallback_blocks.map((block) => ({ block, norad: null })),
    ];
    for (const sat of sats) expect(shipped.has(resolveModel(catalog, sat).url), JSON.stringify(sat)).toBe(true);
    // and every model is reachable that way (no glb shipped that nothing can ask for)
    const reached = new Set(sats.map((s) => resolveModel(catalog, s).id));
    expect([...reached].sort()).toEqual(catalog.models.map((m) => m.id).sort());
  });

  test("shipped size is the sum of the catalog glbs and well below the 55 MB of _refs", () => {
    const total = modelFiles(MODELS_DIR).reduce((n, rel) => n + statSync(join(MODELS_DIR, rel)).size, 0);
    expect(total).toBeGreaterThan(10_000_000);
    expect(total).toBeLessThan(40_000_000);
  });
});

describe("modelFiles refuses a catalog that would ship something it should not", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture(glbs: string[], files: string[] = glbs): string {
    const dir = mkdtempSync(join(tmpdir(), "models-fixture-"));
    dirs.push(dir);
    for (const f of files) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), "glTF-fake");
    }
    writeFileSync(
      join(dir, "catalog.json"),
      JSON.stringify({ version: 1, fallback: "generic", models: glbs.map((glb, i) => ({ id: i === 0 ? "generic" : `m${i}`, glb })) }),
    );
    return dir;
  }

  test("a clean fixture passes", () => {
    expect(modelFiles(fixture(["generic/generic.glb", "a/a.glb"]))).toEqual(["catalog.json", "generic/generic.glb", "a/a.glb"]);
  });

  test("a glb listed twice is shipped once", () => {
    expect(modelFiles(fixture(["generic/generic.glb", "generic/generic.glb"]))).toEqual(["catalog.json", "generic/generic.glb"]);
  });

  test("a glb that is missing on disk fails the build", () => {
    expect(() => modelFiles(fixture(["generic/generic.glb", "gone/gone.glb"], ["generic/generic.glb"]))).toThrow(/gone\/gone\.glb/);
  });

  test("a path into _refs, scripts, vendor, textures or renders is refused", () => {
    for (const bad of ["_refs/x/x.glb", "generic/scripts/x.glb", "vendor/x.glb", "generic/textures/x.glb", "renders/x.glb"])
      expect(() => modelFiles(fixture(["generic/generic.glb", bad])), bad).toThrow(/models/);
  });

  test("a path that climbs out of the models folder, or is absolute, is refused", () => {
    for (const bad of ["../catalog.json.glb", "a/../../x.glb", "/etc/passwd.glb", "a//b.glb", "a\\b.glb"])
      expect(() => modelFiles(fixture(["generic/generic.glb", bad])), bad).toThrow(/models/);
  });

  test("a file that is not a .glb is refused", () => {
    expect(() => modelFiles(fixture(["generic/generic.glb", "a/a.png"]))).toThrow(/\.glb/);
  });

  test("a catalog that is not valid or has no models array fails with a clear message", () => {
    const dir = fixture(["generic/generic.glb"]);
    writeFileSync(join(dir, "catalog.json"), "{ not json");
    expect(() => modelFiles(dir)).toThrow(/catalog\.json/);
    writeFileSync(join(dir, "catalog.json"), JSON.stringify({ version: 1 }));
    expect(() => modelFiles(dir)).toThrow(/models/);
  });
});

// ---- plugin: build copies the same list; dev serves the same paths ----

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | undefined;
  setHeader(k: string, v: string): void;
  end(b?: Buffer | string): void;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    end(b) {
      res.body = b === undefined ? undefined : Buffer.from(b);
    },
  };
  return res;
}

function request(handler: ReturnType<typeof modelsDevHandler>, url: string, method = "GET") {
  const res = fakeRes();
  let nextCalled = false;
  let nextArg: unknown;
  handler({ url, method } as never, res as never, (e?: unknown) => {
    nextCalled = true;
    nextArg = e;
  });
  return { res, nextCalled: () => nextCalled, nextArg: () => nextArg };
}

describe("modelsPlugin build", () => {
  test("emits every shipped file as models/<path>, byte for byte, and nothing else", () => {
    const plugin = modelsPlugin(MODELS_DIR);
    const emitted: { fileName: string; source: Uint8Array; type: string }[] = [];
    const generateBundle = plugin.generateBundle as unknown as (this: { emitFile(f: unknown): void }) => void;
    generateBundle.call({ emitFile: (f) => emitted.push(f as never) });
    expect(emitted.map((e) => e.fileName)).toEqual(modelFiles(MODELS_DIR).map((f) => `models/${f}`));
    for (const e of emitted) {
      expect(e.type).toBe("asset");
      expect(Buffer.compare(Buffer.from(e.source), readFileSync(join(MODELS_DIR, e.fileName.slice("models/".length))))).toBe(0);
    }
  });
});

describe("modelsDevHandler (npm run dev serves the same /models/ paths)", () => {
  const handler = modelsDevHandler(MODELS_DIR);

  test("serves catalog.json as JSON", () => {
    const { res, nextCalled } = request(handler, "/models/catalog.json");
    expect(nextCalled()).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body!.toString("utf8")).fallback).toBe("generic");
  });

  test("serves every catalog glb with the glTF media type and the file's bytes, ignoring a query string", () => {
    for (const m of catalog.models) {
      const { res, nextCalled } = request(handler, `/models/${m.glb}?v=1`);
      expect(nextCalled(), m.id).toBe(false);
      expect(res.statusCode, m.id).toBe(200);
      expect(res.headers["content-type"], m.id).toBe("model/gltf-binary");
      expect(Buffer.compare(res.body!, readFileSync(join(MODELS_DIR, m.glb))), m.id).toBe(0);
    }
  });

  test("a HEAD request gets the headers and no body", () => {
    const { res } = request(handler, "/models/gps-iif/gps-iif.glb", "HEAD");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe(String(statSync(join(MODELS_DIR, "gps-iif/gps-iif.glb")).size));
    expect(res.body).toBeUndefined();
  });

  test("anything outside the catalog is passed on, never read from the models folder", () => {
    for (const url of [
      "/models/_refs/x.jpg",
      "/models/gps-iif/NOTES.md",
      "/models/gps-iif/textures/a.png",
      "/models/../vendor/x",
      "/models/%2e%2e/catalog.json",
      "/models/gps-iif/gps-iif.glb/../../terra/terra.glb",
      "/models/",
      "/models",
      "/modelsx/catalog.json",
      "/api/models/catalog.json",
      "/cesium/Assets/approximateTerrainHeights.json",
    ]) {
      const { res, nextCalled } = request(handler, url);
      expect(nextCalled(), url).toBe(true);
      expect(res.body, url).toBeUndefined();
    }
  });

  test("methods other than GET and HEAD are passed on", () => {
    expect(request(handler, "/models/catalog.json", "POST").nextCalled()).toBe(true);
    expect(request(handler, "/models/catalog.json", "PUT").nextCalled()).toBe(true);
  });

  test("a broken catalog is reported to the dev server rather than served half-way", () => {
    const dir = mkdtempSync(join(tmpdir(), "models-dev-"));
    try {
      writeFileSync(join(dir, "catalog.json"), "{ not json");
      const { nextCalled, nextArg } = request(modelsDevHandler(dir), "/models/catalog.json");
      expect(nextCalled()).toBe(true);
      expect(nextArg()).toBeInstanceOf(Error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
