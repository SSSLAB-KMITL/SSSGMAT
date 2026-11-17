// ตัวตรวจ request ของ e2e (tests/e2e/localRequest.ts): อนุญาตเฉพาะ server ของ e2e, data:, blob: และ (ตอนวัดประสิทธิภาพ) origin ของ GNSS_E2E_PERF_URL ตรงตัว

import { describe, expect, test } from "vitest";
import { allowedOrigins, E2E_ORIGIN, isLocalRequest } from "../e2e/localRequest";

describe("allowedOrigins", () => {
  test("is only the e2e server when no perf URL is set", () => {
    expect(allowedOrigins(undefined)).toEqual([`${E2E_ORIGIN}/`]);
    expect(allowedOrigins("")).toEqual([`${E2E_ORIGIN}/`]);
  });

  test("adds exactly the origin of the perf URL (no path, no query)", () => {
    expect(allowedOrigins("http://127.0.0.1:8767/?sc=acc_20261111&test")).toEqual([`${E2E_ORIGIN}/`, "http://127.0.0.1:8767/"]);
  });

  test("ignores a perf URL that is not an http(s) URL", () => {
    expect(allowedOrigins("not a url")).toEqual([`${E2E_ORIGIN}/`]);
    expect(allowedOrigins("data:text/html,x")).toEqual([`${E2E_ORIGIN}/`]);
    expect(allowedOrigins("file:///etc/passwd")).toEqual([`${E2E_ORIGIN}/`]);
  });
});

describe("isLocalRequest", () => {
  const plain = allowedOrigins(undefined);
  const perf = allowedOrigins("http://127.0.0.1:8767/?sc=acc_20261111&test");

  test("the e2e server, data: and blob: are local", () => {
    expect(isLocalRequest(`${E2E_ORIGIN}/api/health`, plain)).toBe(true);
    expect(isLocalRequest("data:image/png;base64,AAAA", plain)).toBe(true);
    expect(isLocalRequest("blob:http://127.0.0.1:8766/abc", plain)).toBe(true);
  });

  test("without a perf URL the perf server origin is outside", () => {
    expect(isLocalRequest("http://127.0.0.1:8767/api/health", plain)).toBe(false);
  });

  test("with a perf URL its origin is local too, and nothing broader", () => {
    expect(isLocalRequest("http://127.0.0.1:8767/api/scenarios/acc_20261111/results", perf)).toBe(true);
    expect(isLocalRequest(`${E2E_ORIGIN}/api/health`, perf)).toBe(true);
    expect(isLocalRequest("http://127.0.0.1:8768/", perf)).toBe(false); // another port
    expect(isLocalRequest("http://127.0.0.1:8767.evil.example/", perf)).toBe(false); // the origin is matched whole, not as a prefix of a host
    expect(isLocalRequest("https://127.0.0.1:8767/", perf)).toBe(false); // another scheme
    expect(isLocalRequest("http://localhost:8767/", perf)).toBe(false); // another host
    expect(isLocalRequest("https://cesium.com/", perf)).toBe(false);
  });
});
