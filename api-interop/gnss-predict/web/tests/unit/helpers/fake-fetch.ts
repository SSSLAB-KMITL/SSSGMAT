// fetch ปลอมสำหรับ test ที่แตะ API: จับคู่ "METHOD /path" (ไม่รวม query) กับคำตอบ ไม่ต่อเครือข่ายจริง
// คำขอที่ไม่มี route ทำให้ promise ถูก reject ด้วย Error (test จึง fail ดัง ๆ ไม่แอบต่อเน็ต)

import { vi } from "vitest";

export interface Call {
  method: string;
  /** path เต็ม ไม่รวม query เช่น /api/scenarios/E2E */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** ignoreAbort: ไม่สนใจ AbortSignal (จำลองคำตอบที่มาถึงพอดีก่อนการยกเลิก) */
export function stubFetch(routes: Record<string, Handler>, opts: { ignoreAbort?: boolean } = {}) {
  const calls: Call[] = [];
  const impl = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const raw = typeof init.body === "string" ? init.body : undefined;
    const call: Call = { method, path: url.pathname, query: url.searchParams, headers, body: raw === undefined ? undefined : JSON.parse(raw) };
    calls.push(call);
    const signal = opts.ignoreAbort ? null : (init.signal ?? null);
    if (signal?.aborted) throw abortError();
    const handler = routes[`${method} ${url.pathname}`];
    if (handler === undefined) throw new Error(`unexpected fetch ${method} ${url.pathname}${url.search}`);
    const pending = Promise.resolve(typeof handler === "function" ? handler(call) : handler);
    const aborted = new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(abortError())));
    const reply = await Promise.race([pending, aborted]);
    const body = reply.text !== undefined ? reply.text : reply.json !== undefined ? JSON.stringify(reply.json) : "";
    const status = reply.status ?? 200;
    return new Response(status === 204 || status === 304 ? null : body, { status, headers: reply.headers });
  };
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return { calls, fn, routes, count: (route: string) => calls.filter((c) => `${c.method} ${c.path}` === route).length };
}

/** promise ที่ test เป็นคน resolve เอง (ไว้คุมลำดับคำตอบของ fetch) */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
