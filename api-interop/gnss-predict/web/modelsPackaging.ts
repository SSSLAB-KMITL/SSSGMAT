// ส่งโมเดล 3 มิติของดาวไปกับหน้าเว็บ (vite.config.ts ใช้; tests/unit/models-packaging.test.ts ตรวจ)
//
// build: คัดลอก catalog.json กับ glb ทุกตัวที่ catalog ระบุไป dist/models/<path> (server ส่ง web/dist ผ่าน 404 handler อยู่แล้ว)
// dev: ส่ง path เดียวกันจากโฟลเดอร์โมเดลโดยตรง
// ส่งเฉพาะไฟล์ที่ catalog ระบุ ไม่ส่งทั้งโฟลเดอร์: _refs/ (ภาพอ้างอิงราว 55 MB), scripts/, renders/, vendor/, textures/ ต้องไม่หลุดไปกับแอป
// path ใน catalog ที่ชี้ออกนอกโฟลเดอร์หรือเข้าโฟลเดอร์เหล่านั้นทำให้ build ล้ม (ไม่คัดลอกเงียบ ๆ)

import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";

/** โฟลเดอร์ของโมเดลที่ไม่ใช่ผลผลิตสำหรับแอป */
const NOT_SHIPPED = new Set(["_refs", "_tools", "scripts", "renders", "vendor", "textures"]);
const SEGMENT = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]*$/;
const URL_PREFIX = "/models/";

/** path ใต้โฟลเดอร์โมเดล (ใช้ "/" เสมอ) ที่ต้องส่ง: catalog.json แล้วตามด้วย glb ของโมเดลแต่ละตัวตามลำดับใน catalog (ไม่ซ้ำ) */
export function modelFiles(modelsDir: string): string[] {
  let catalog: unknown;
  try {
    catalog = JSON.parse(readFileSync(join(modelsDir, "catalog.json"), "utf8"));
  } catch (e) {
    throw new Error(`models: อ่าน catalog.json ใน ${modelsDir} ไม่ได้ (${e instanceof Error ? e.message : String(e)})`);
  }
  const models = (catalog as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) throw new Error("models: catalog.json ไม่มีรายการ models");
  const files = ["catalog.json"];
  for (const m of models) {
    const glb = (m as { glb?: unknown } | null)?.glb;
    if (typeof glb !== "string" || !glb.endsWith(".glb")) throw new Error(`models: โมเดลต้องระบุไฟล์ .glb แต่ได้ ${JSON.stringify(glb)}`);
    const parts = glb.split("/");
    if (parts.length < 2 || !parts.every((p) => SEGMENT.test(p) && p !== "." && p !== ".." && !NOT_SHIPPED.has(p)))
      throw new Error(`models: path ของ glb ไม่ปลอดภัยหรืออยู่ในโฟลเดอร์ที่ไม่ส่งไปกับแอป: ${glb}`);
    let isFile = false;
    try {
      isFile = statSync(join(modelsDir, glb)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) throw new Error(`models: catalog ระบุ ${glb} แต่ไม่มีไฟล์นี้ใน ${modelsDir}`);
    if (!files.includes(glb)) files.push(glb);
  }
  return files;
}

type Next = (err?: unknown) => void;

function contentType(rel: string): string {
  return rel.endsWith(".json") ? "application/json; charset=utf-8" : "model/gltf-binary";
}

/** middleware ของ dev server: ตอบ GET/HEAD /models/<ไฟล์ใน modelFiles> ที่เหลือส่งต่อ (ไม่อ่านไฟล์นอกรายการ) */
export function modelsDevHandler(modelsDir: string): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  return (req, res, next) => {
    const url = req.url ?? "";
    if ((req.method !== "GET" && req.method !== "HEAD") || !url.startsWith(URL_PREFIX)) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(url.slice(URL_PREFIX.length).split(/[?#]/, 1)[0] ?? "");
    } catch {
      return next();
    }
    try {
      if (!modelFiles(modelsDir).includes(rel)) return next();
      const body = readFileSync(join(modelsDir, rel));
      res.statusCode = 200;
      res.setHeader("Content-Type", contentType(rel));
      res.setHeader("Content-Length", String(body.length));
      res.setHeader("Cache-Control", "no-cache");
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (e) {
      next(e);
    }
  };
}

export function modelsPlugin(modelsDir: string): Plugin {
  return {
    name: "gnss-studio-models",
    configureServer(server) {
      server.middlewares.use(modelsDevHandler(modelsDir));
    },
    generateBundle() {
      for (const rel of modelFiles(modelsDir))
        this.emitFile({ type: "asset", fileName: `models/${rel}`, source: readFileSync(join(modelsDir, rel)) });
    },
  };
}
