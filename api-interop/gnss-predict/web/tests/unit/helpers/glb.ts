// อ่าน glb ของโมเดลดาวจากโฟลเดอร์ models (ไฟล์ในเครื่อง ไม่ต่อเครือข่าย) สำหรับ test: JSON chunk, node, และ normal ของหน้าแผงจากสามเหลี่ยมจริง
// แกน: glTF (x, y, z) = body (x, z, −y) (catalog.json "frame": glTF Y-up export) จึง body = (gx, −gz, gy)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MODELS_DIR = resolve(import.meta.dirname, "../../../../models");

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

export interface Glb {
  json: {
    nodes: GltfNode[];
    scenes: { nodes: number[] }[];
    scene?: number;
    meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
    materials: { name?: string }[];
    accessors: Accessor[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  bin: DataView;
}

/** อ่าน glb (path ใต้ models/ ตาม catalog เช่น "gps-iif/gps-iif.glb") */
export function readGlb(rel: string): Glb {
  const buf = readFileSync(resolve(MODELS_DIR, rel));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${rel}: not a glb`);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLength))) as Glb["json"];
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return { json, bin: new DataView(buf.buffer, buf.byteOffset + binStart + 8, binLength) };
}

/** parent ของแต่ละ node (root = undefined) */
export function parents(glb: Glb): Map<number, number> {
  const out = new Map<number, number>();
  glb.json.nodes.forEach((n, i) => n.children?.forEach((c) => out.set(c, i)));
  return out;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function read(glb: Glb, index: number): number[][] {
  const a = glb.json.accessors[index];
  const bv = glb.json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
  const stride = bv.byteStride ?? size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[][] = [];
  for (let k = 0; k < a.count; k++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const at = base + k * stride + j * size;
      row.push(
        a.componentType === 5126 ? glb.bin.getFloat32(at, true)
        : a.componentType === 5125 ? glb.bin.getUint32(at, true)
        : a.componentType === 5123 ? glb.bin.getUint16(at, true)
        : glb.bin.getUint8(at),
      );
    }
    out.push(row);
  }
  return out;
}

export type V3 = [number, number, number];

/**
 * normal ของหน้าที่ใช้ material ชื่อ material ใน node ชื่อ nodeName (พิกัด glTF ของ node): ผลรวมของ normal จากการพันของสามเหลี่ยม ถ่วงด้วยพื้นที่
 * (หน้าเซลล์ของแผงเป็นระนาบเดียว ผลรวมจึงเป็น normal ของระนาบนั้น) ไม่มี material นี้ใน node = null
 */
export function faceNormal(glb: Glb, nodeName: string, material: string): V3 | null {
  const node = glb.json.nodes.find((n) => n.name === nodeName);
  if (node?.mesh === undefined) return null;
  let sum: V3 = [0, 0, 0];
  let found = false;
  for (const p of glb.json.meshes[node.mesh].primitives) {
    if (p.material === undefined || glb.json.materials[p.material].name !== material) continue;
    found = true;
    const pos = read(glb, p.attributes.POSITION);
    const idx = p.indices === undefined ? pos.map((_, i) => i) : read(glb, p.indices).map((r) => r[0]);
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const [a, b, c] = [pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      sum = [sum[0] + u[1] * v[2] - u[2] * v[1], sum[1] + u[2] * v[0] - u[0] * v[2], sum[2] + u[0] * v[1] - u[1] * v[0]];
    }
  }
  if (!found) return null;
  const len = Math.hypot(...sum);
  return [sum[0] / len, sum[1] / len, sum[2] / len];
}

/** พื้นที่ของหน้าที่ใช้ material ใน node แยกตามทิศ normal (ปัดเป็นแกน ±X/±Y/±Z ของ glTF) ใช้ดูว่าแผงเป็นสองหน้า (ทั้งสองด้านเป็นเซลล์) หรือไม่ */
export function areaByAxis(glb: Glb, nodeName: string, material: string): Record<string, number> {
  const node = glb.json.nodes.find((n) => n.name === nodeName);
  const out: Record<string, number> = {};
  if (node?.mesh === undefined) return out;
  for (const p of glb.json.meshes[node.mesh].primitives) {
    if (p.material === undefined || glb.json.materials[p.material].name !== material) continue;
    const pos = read(glb, p.attributes.POSITION);
    const idx = p.indices === undefined ? pos.map((_, i) => i) : read(glb, p.indices).map((r) => r[0]);
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const [a, b, c] = [pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const area = Math.hypot(...n) / 2;
      if (area === 0) continue;
      const axis = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) > Math.abs(n[best]) ? i : best), 0);
      const key = `${n[axis] > 0 ? "+" : "-"}${"XYZ"[axis]}`;
      out[key] = (out[key] ?? 0) + area;
    }
  }
  return out;
}

/** ทิศในกรอบตัวดาว → พิกัด glTF ของโมเดล */
export const gltfOfBody = ([x, y, z]: V3): V3 => [x, z, -y];
/** พิกัด glTF → กรอบตัวดาว */
export const bodyOfGltf = ([x, y, z]: V3): V3 => [x, -z, y];
