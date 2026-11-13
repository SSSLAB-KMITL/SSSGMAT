import { describe, expect, it } from "vitest";
import type { PrefsAnswer } from "../types";
import { CommitList, draftToRequest, draftValue, RESET, resetInDraft, setInDraft } from "./prefsDraft";
import type { Draft } from "./prefsDraft";

const ELEV = "PREDICT/MINIMUM_ELEV";
const PASSES = "PREDICT/NUMBER_OF_PASSES";
const COLS = "PREDICT/SINGLE_PASS_COL";
const REAL_T0 = "PREDICT/USE_REAL_T0";

/** What GET /api/prefs answers: `user` holds the keys the user has set, whose values are in `values`. */
function answer(user: Record<string, number | boolean | string | string[]> = {}): PrefsAnswer {
  const defaults = { [ELEV]: 5, [PASSES]: 10, [COLS]: ["Time", "Az", "El"], [REAL_T0]: false };
  return { values: { ...defaults, ...user }, defaults, user: Object.keys(user) };
}

const empty: Draft = new Map();

describe("draftToRequest", () => {
  it("sends only changed keys", () => {
    const a = answer();
    expect(draftToRequest(a, setInDraft(empty, ELEV, 5))).toEqual({ set: {}, remove: [] });
    expect(draftToRequest(a, setInDraft(empty, ELEV, 30))).toEqual({ set: { [ELEV]: 30 }, remove: [] });
    expect(draftToRequest(a, empty)).toEqual({ set: {}, remove: [] });
  });

  it("does not send a key that was changed and changed back", () => {
    const draft = setInDraft(setInDraft(empty, ELEV, 30), ELEV, 5);
    expect(draftToRequest(answer(), draft)).toEqual({ set: {}, remove: [] });
  });

  it("reset of a user key removes it", () => {
    const a = answer({ [ELEV]: 30 });
    expect(draftToRequest(a, resetInDraft(empty, [ELEV]))).toEqual({ set: {}, remove: [ELEV] });
  });

  it("reset then change sets it, and the key is never in both set and remove", () => {
    const a = answer({ [ELEV]: 30 });
    const draft = setInDraft(resetInDraft(empty, [ELEV]), ELEV, 40);
    const request = draftToRequest(a, draft);
    expect(request).toEqual({ set: { [ELEV]: 40 }, remove: [] });
    expect(Object.keys(request.set).filter((k) => request.remove.includes(k))).toEqual([]);
  });

  it("reset then the value the key has now sends nothing (the user's value stays)", () => {
    const a = answer({ [ELEV]: 30 });
    expect(draftToRequest(a, setInDraft(resetInDraft(empty, [ELEV]), ELEV, 30))).toEqual({ set: {}, remove: [] });
  });

  it("reset of a default key sends nothing", () => {
    expect(draftToRequest(answer(), resetInDraft(empty, [ELEV, PASSES]))).toEqual({ set: {}, remove: [] });
  });

  it("changing a default key back to its default after a user value is set goes to set (the user value is replaced)", () => {
    const a = answer({ [ELEV]: 30 });
    expect(draftToRequest(a, setInDraft(empty, ELEV, 5))).toEqual({ set: { [ELEV]: 5 }, remove: [] });
  });

  it("compares lists by their items in order, not by identity", () => {
    const a = answer();
    expect(draftToRequest(a, setInDraft(empty, COLS, ["Time", "Az", "El"]))).toEqual({ set: {}, remove: [] });
    expect(draftToRequest(a, setInDraft(empty, COLS, ["Time", "El"]))).toEqual({ set: { [COLS]: ["Time", "El"] }, remove: [] });
    expect(draftToRequest(a, setInDraft(empty, COLS, ["El", "Az", "Time"]))).toEqual({ set: { [COLS]: ["El", "Az", "Time"] }, remove: [] });
  });

  it("sends flags and several keys together, set and remove side by side", () => {
    const a = answer({ [PASSES]: 20 });
    const draft = setInDraft(resetInDraft(setInDraft(empty, REAL_T0, true), [PASSES]), ELEV, 12);
    expect(draftToRequest(a, draft)).toEqual({ set: { [REAL_T0]: true, [ELEV]: 12 }, remove: [PASSES] });
  });
});

describe("draftValue", () => {
  it("shows the value in effect until the page changes it", () => {
    const a = answer({ [ELEV]: 30 });
    expect(draftValue(a, empty, ELEV)).toBe(30);
    expect(draftValue(a, empty, PASSES)).toBe(10);
    expect(draftValue(a, setInDraft(empty, ELEV, 41), ELEV)).toBe(41);
  });

  it("shows the default after reset", () => {
    const a = answer({ [ELEV]: 30 });
    expect(draftValue(a, resetInDraft(empty, [ELEV]), ELEV)).toBe(5);
  });

  it("shows the new value after reset then change", () => {
    const a = answer({ [ELEV]: 30 });
    expect(draftValue(a, setInDraft(resetInDraft(empty, [ELEV]), ELEV, 40), ELEV)).toBe(40);
  });

  it("throws for a key the server does not know, so that a typo in a page cannot pass for a value", () => {
    expect(() => draftValue(answer(), empty, "PREDICT/NOPE")).toThrow("PREDICT/NOPE");
    expect(() => draftValue(answer(), resetInDraft(empty, ["PREDICT/NOPE"]), "PREDICT/NOPE")).toThrow("PREDICT/NOPE");
  });
});

describe("the draft is immutable", () => {
  it("setInDraft and resetInDraft return new maps and leave the old one alone", () => {
    const one = setInDraft(empty, ELEV, 30);
    const two = resetInDraft(one, [ELEV, PASSES]);
    expect(empty.size).toBe(0);
    expect(one.get(ELEV)).toBe(30);
    expect(one.has(PASSES)).toBe(false);
    expect(two.get(ELEV)).toBe(RESET);
    expect(two.get(PASSES)).toBe(RESET);
  });
});

describe("CommitList (onCommit of the pages)", () => {
  const fn = () => Promise.resolve();
  const other = () => Promise.resolve();

  it("keeps a function registered again by the same page once", () => {
    const list = new CommitList();
    list.add("predict", fn);
    list.add("predict", fn);
    list.add("predict", fn);
    expect(list.all).toEqual([fn]);
  });

  it("keeps the order of registration and the same function of two pages twice", () => {
    const list = new CommitList();
    list.add("predict", other);
    list.add("modules", fn);
    list.add("predict", fn);
    list.add("predict", other);
    expect(list.all).toEqual([other, fn, fn]);
  });
});
