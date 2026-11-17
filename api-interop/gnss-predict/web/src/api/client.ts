// ตัวเรียก HTTP API ของ server (spec server §6, §10)
// - ทุก path อยู่ใต้ /api (ใส่ให้เอง ใส่มาแล้วก็ไม่ซ้ำ)
// - ETag อ่านจาก header ตามตัว (มีเครื่องหมายคำพูด) และส่งกลับใน If-Match ตามตัว
// - ข้อผิดพลาดทุกแบบเป็น ApiError: server ตอบ {code, text, field, detail}; ตอบอย่างอื่น = HTTP_<status>; fetch ล้ม = NETWORK (status 0)
// - การยกเลิกด้วย AbortSignal ไม่ถูกแปลงเป็น ApiError (ผู้เรียกใช้ isAbortError แยกได้)

import { msg } from "../labels/messages.th";

export const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** ข้อความของ server แสดงตามที่ส่งมา (NETWORK และ HTTP_<status> ที่ server ไม่ได้ส่งซองข้อผิดพลาดมา ใช้ข้อความของหน้าเว็บ/ตัวเนื้อหา) */
  readonly text: string;
  readonly field: string | null;
  readonly detail: string | null;

  constructor(init: { status: number; code: string; text: string; field?: string | null; detail?: string | null }) {
    super(init.text);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.text = init.text;
    this.field = init.field ?? null;
    this.detail = init.detail ?? null;
  }
}

export interface ApiResult<T> {
  data: T;
  /** ค่า header ETag ตามที่ได้รับ (มีเครื่องหมายคำพูด) ไม่มี = null */
  etag: string | null;
  headers: Headers;
}

export interface ApiOptions {
  signal?: AbortSignal;
}

/** path ที่ไม่ขึ้นต้นด้วย /api ได้ /api นำหน้า */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p === API_BASE || p.startsWith(`${API_BASE}/`) || p.startsWith(`${API_BASE}?`) ? p : `${API_BASE}${p}`;
}

export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

/** ข้อความสั้นของข้อผิดพลาดใด ๆ ไว้ใส่ในข้อความถึงผู้ใช้ */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.text;
  return e instanceof Error ? e.message : String(e);
}

/** ETag เปล่า (ไม่มี W/ และไม่มีเครื่องหมายคำพูด) ไว้เทียบค่าใน header (มีคำพูด) กับค่าใน body/event ของ server (เปล่า) */
export function normalizeEtag(tag: string): string {
  const t = tag.trim().replace(/^W\//, "");
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function detailText(detail: unknown): string | null {
  if (detail === null || detail === undefined) return null;
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** ตัวเนื้อหาของคำตอบที่ไม่ผ่านเป็น ApiError: ซองของ server ถ้ามี ไม่มีก็ HTTP_<status> */
function errorFrom(status: number, bodyText: string, statusText: string): ApiError {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (typeof body === "object" && body !== null) {
      const b = body as Record<string, unknown>;
      if (typeof b.code === "string" && typeof b.text === "string") {
        return new ApiError({ status, code: b.code, text: b.text, field: stringOrNull(b.field), detail: detailText(b.detail) });
      }
    }
  } catch {
    // ไม่ใช่ JSON: ตกไปใช้ HTTP_<status>
  }
  const text = bodyText.trim().slice(0, 300) || statusText || `HTTP ${status}`;
  return new ApiError({ status, code: `HTTP_${status}`, text });
}

async function run(method: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<{ res: Response; body: string }> {
  try {
    const res = await fetch(apiUrl(path), { ...init, method, signal });
    return { res, body: await res.text() };
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError({
      status: 0, code: "NETWORK", text: msg("server.disconnected"), detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function request<T>(method: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<ApiResult<T>> {
  const { res, body } = await run(method, path, init, signal);
  if (!res.ok) throw errorFrom(res.status, body, res.statusText);
  let data: T;
  if (body.trim() === "") {
    data = null as T;
  } else {
    try {
      data = JSON.parse(body) as T;
    } catch {
      throw errorFrom(res.status, body, res.statusText); // 2xx แต่ไม่ใช่ JSON (เช่น dev server ตอบ index.html)
    }
  }
  return { data, etag: res.headers.get("ETag"), headers: res.headers };
}

export function apiGet<T>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  return request<T>("GET", path, {}, opts.signal);
}

/** body ไม่ส่ง (undefined) = ไม่มี body; ifMatch ส่งตามตัว (null/undefined = ไม่ใส่ header) */
export function apiSend<T>(method: string, path: string, body?: unknown, ifMatch?: string | null, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ifMatch !== null && ifMatch !== undefined) headers["If-Match"] = ifMatch;
  return request<T>(method, path, { headers, body: body === undefined ? undefined : JSON.stringify(body) }, opts.signal);
}

/** ไฟล์ข้อความ (CSV) ของ bundle ผลลัพธ์ ข้อผิดพลาดเป็น ApiError แบบเดียวกัน */
export async function apiGetText(path: string, opts: ApiOptions = {}): Promise<string> {
  const { res, body } = await run("GET", path, {}, opts.signal);
  if (!res.ok) throw errorFrom(res.status, body, res.statusText);
  return body;
}

/** ส่ง JSON แล้วรับคำตอบเป็นข้อความ (ไฟล์รายงาน .txt/.csv พร้อม Content-Disposition) ข้อผิดพลาดเป็น ApiError แบบเดียวกัน */
export async function apiSendText(method: string, path: string, body: unknown, opts: ApiOptions = {}): Promise<{ text: string; headers: Headers }> {
  const init: RequestInit = { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const { res, body: text } = await run(method, path, init, opts.signal);
  if (!res.ok) throw errorFrom(res.status, text, res.statusText);
  return { text, headers: res.headers };
}
