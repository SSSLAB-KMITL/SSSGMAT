import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as recent from "../../src/recent";

const KEY = "gnss-studio.recent";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("recent list", () => {
  test("is empty before anything is opened", () => {
    expect(recent.list()).toEqual([]);
  });

  test("keeps the newest name on top and never repeats a name", () => {
    recent.push("A");
    recent.push("B");
    recent.push("C");
    expect(recent.list()).toEqual(["C", "B", "A"]);
    recent.push("A"); // opening it again moves it to the top instead of adding a copy
    expect(recent.list()).toEqual(["A", "C", "B"]);
  });

  test("keeps the 4 newest names", () => {
    for (const name of ["A", "B", "C", "D", "E"]) recent.push(name);
    expect(recent.list()).toEqual(["E", "D", "C", "B"]);
    expect(recent.RECENT_MAX).toBe(4);
  });

  test("names differing only in case are one scenario (the server ignores case in names)", () => {
    recent.push("e2e");
    recent.push("Other");
    recent.push("E2E");
    expect(recent.list()).toEqual(["E2E", "Other"]);
  });

  test("is stored as a JSON array under gnss-studio.recent, and read back by a later session", () => {
    recent.push("A");
    recent.push("B");
    expect(recent.RECENT_KEY).toBe(KEY);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual(["B", "A"]);
    localStorage.setItem(KEY, JSON.stringify(["X", "Y"]));
    expect(recent.list()).toEqual(["X", "Y"]);
  });

  test("is also reachable as the recent object", () => {
    expect(recent.recent.push).toBe(recent.push);
    expect(recent.recent.list).toBe(recent.list);
  });
});

describe("unusable storage contents", () => {
  test.each([
    ["not JSON", "{oops"],
    ["not an array", JSON.stringify({ a: 1 })],
    ["null", "null"],
  ])("%s gives an empty list", (_what, raw) => {
    localStorage.setItem(KEY, raw);
    expect(recent.list()).toEqual([]);
  });

  test("keeps only the non-empty strings, without repeats, at most 4", () => {
    localStorage.setItem(KEY, JSON.stringify(["A", 3, "", "B", null, "A", "C", "D", "E"]));
    expect(recent.list()).toEqual(["A", "B", "C", "D"]);
  });

  test("pushing on top of junk starts a clean list", () => {
    localStorage.setItem(KEY, "{oops");
    recent.push("A");
    expect(recent.list()).toEqual(["A"]);
  });
});

describe("storage that cannot be used", () => {
  test("a read that throws gives an empty list and no error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => recent.list()).not.toThrow();
    expect(recent.list()).toEqual([]);
  });

  test("the storage object itself being unreachable gives an empty list and no error", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(recent.list()).toEqual([]);
    expect(() => recent.push("A")).not.toThrow();
  });

  test("a write that throws (quota, private mode) is ignored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => recent.push("A")).not.toThrow();
  });
});

describe("remove", () => {
  test("takes a name out and keeps the order of the rest", () => {
    for (const name of ["A", "B", "C"]) recent.push(name);
    recent.remove("B");
    expect(recent.list()).toEqual(["C", "A"]);
  });

  test("ignores case, like push (the server ignores case in names)", () => {
    recent.push("Gone");
    recent.remove("gone");
    expect(recent.list()).toEqual([]);
  });

  test("a name that is not in the list changes nothing and tells nobody", () => {
    recent.push("A");
    const listener = vi.fn();
    recent.subscribe(listener);
    recent.remove("Z");
    expect(recent.list()).toEqual(["A"]);
    expect(listener).not.toHaveBeenCalled();
  });

  test("tells listeners after removing", () => {
    recent.push("A");
    const listener = vi.fn();
    recent.subscribe(listener);
    recent.remove("A");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("storage that cannot be used never throws", () => {
    recent.push("A");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => recent.remove("A")).not.toThrow();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => recent.remove("A")).not.toThrow();
  });
});

describe("subscribe", () => {
  test("tells listeners after a push, and stops after unsubscribing", () => {
    const listener = vi.fn();
    const off = recent.subscribe(listener);
    recent.push("A");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    recent.push("B");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
