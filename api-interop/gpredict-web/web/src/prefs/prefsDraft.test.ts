import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { PrefsAnswer } from "../types";
import { pageFailure, prefsFailure, savedNote, TabError } from "./prefPlaces";
import { CommitList, commitPreferences, commitSteps, draftToRequest, draftValue, RESET, resetInDraft, setInDraft } from "./prefsDraft";
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

// the order of the groups in the window, which is the order OK runs them in (Gpredict: General, Modules, Interfaces, Predict)
const ORDER = ["general", "modules", "interfaces", "predict"];

describe("CommitList (onCommit and onCheck of the pages): keyed, the latest registration runs, groups in their fixed order", () => {
  const fn = () => Promise.resolve();
  const other = () => Promise.resolve();

  it("a page that registers the same key again replaces what it registered before", () => {
    const list = new CommitList(ORDER);
    list.add("predict", "radios", other);
    list.add("predict", "radios", fn);
    expect(list.all).toEqual([fn]);
  });

  it("keeps the order of the first registration of each key within a group", () => {
    const list = new CommitList(ORDER);
    list.add("predict", "radios", other);
    list.add("predict", "rotators", fn);
    list.add("predict", "radios", fn); // replaced in its first place
    list.add("predict", "extra", other);
    expect(list.all).toEqual([fn, fn, other]);
    list.add("predict", "radios", other);
    expect(list.all).toEqual([other, fn, other]);
  });

  it("orders by group first: General, Modules, Interfaces, Predict, whichever page was visited and registered first", () => {
    const list = new CommitList(ORDER);
    const run: string[] = [];
    const step = (name: string) => async () => void run.push(name);
    list.add("predict", "a", step("predict"));
    list.add("interfaces", "hwconf", step("interfaces"));
    list.add("general", "qth", step("general:qth"));
    list.add("modules", "layout", step("modules"));
    list.add("general", "tle", step("general:tle"));
    list.add("predict", "b", step("predict:b"));
    return (async () => {
      for (const commit of list.all) await commit();
      expect(run).toEqual(["general:qth", "general:tle", "modules", "interfaces", "predict", "predict:b"]);
    })();
  });

  it("the same key of two groups is two entries", () => {
    const list = new CommitList(ORDER);
    list.add("predict", "save", fn);
    list.add("modules", "save", other);
    expect(list.all).toEqual([other, fn]);
  });

  it("a group that is not in the order runs after the others", () => {
    const list = new CommitList(ORDER);
    list.add("elsewhere", "x", other);
    list.add("predict", "y", fn);
    expect(list.all).toEqual([fn, other]);
  });

  it("a closure made at every render runs once, and it is the newest (it sees the newest state)", async () => {
    const list = new CommitList(ORDER);
    const seen: number[] = [];
    for (let render = 1; render <= 3; render++) list.add("predict", "save", async () => void seen.push(render));
    for (const commit of list.all) await commit();
    expect(seen).toEqual([3]);
  });

  it("tells the group and key of each entry, in the same order (the window names the group of a failure)", () => {
    const list = new CommitList(ORDER);
    list.add("predict", "a", fn);
    list.add("general", "qth", other);
    expect(list.entries.map((e) => [e.page, e.key])).toEqual([
      ["general", "qth"],
      ["predict", "a"],
    ]);
  });
});

describe("commitPreferences: every part is checked, then the preferences are saved, then the pages commit", () => {
  /** steps that write what they do into `log`; `failing` names the step that rejects */
  function steps(log: string[], failing: string | null = null, checks = 2, commits = 2) {
    const step = (name: string) => async () => {
      log.push(name);
      if (name === failing) throw new Error(`${name} failed`);
    };
    return {
      checkPrefs: step("checkPrefs"),
      checks: Array.from({ length: checks }, (_, i) => step(`check${i}`)),
      savePrefs: step("savePrefs"),
      commits: Array.from({ length: commits }, (_, i) => step(`commit${i}`)),
    };
  }

  it("commits run after prefs in registration order, after every check", async () => {
    const log: string[] = [];
    await commitPreferences(steps(log));
    expect(log).toEqual(["checkPrefs", "check0", "check1", "savePrefs", "commit0", "commit1"]);
  });

  it("nothing is saved when a check fails", async () => {
    const log: string[] = [];
    await expect(commitPreferences(steps(log, "check1"))).rejects.toThrow("check1 failed");
    expect(log).toEqual(["checkPrefs", "check0", "check1"]); // no savePrefs, no commit
  });

  it("nothing is saved when the check of the preferences fails, and the pages are not asked to check", async () => {
    const log: string[] = [];
    await expect(commitPreferences(steps(log, "checkPrefs"))).rejects.toThrow("checkPrefs failed");
    expect(log).toEqual(["checkPrefs"]);
  });

  it("a failed save stops before the commits", async () => {
    const log: string[] = [];
    await expect(commitPreferences(steps(log, "savePrefs"))).rejects.toThrow("savePrefs failed");
    expect(log).toEqual(["checkPrefs", "check0", "check1", "savePrefs"]);
  });

  it("a failed commit stops the commits after it", async () => {
    const log: string[] = [];
    await expect(commitPreferences(steps(log, "commit0"))).rejects.toThrow("commit0 failed");
    expect(log).toEqual(["checkPrefs", "check0", "check1", "savePrefs", "commit0"]);
  });

  it("runs the steps one at a time", async () => {
    const log: string[] = [];
    const slow = (name: string) => async () => {
      log.push(`${name}:start`);
      await Promise.resolve();
      await Promise.resolve();
      log.push(`${name}:end`);
    };
    await commitPreferences({ checkPrefs: slow("p"), checks: [slow("c0"), slow("c1")], savePrefs: slow("s"), commits: [slow("m")] });
    expect(log).toEqual(["p:start", "p:end", "c0:start", "c0:end", "c1:start", "c1:end", "s:start", "s:end", "m:start", "m:end"]);
  });

  it("works with no checks and no commits", async () => {
    const log: string[] = [];
    await commitPreferences(steps(log, null, 0, 0));
    expect(log).toEqual(["checkPrefs", "savePrefs"]);
  });
});

describe("commitSteps: OK of the window, with the text of a failure placed", () => {
  const label = (g: string) => ({ general: "General", modules: "Modules", interfaces: "Interfaces", predict: "Predict" })[g]!;

  /** the window's parts, which write what they do into `log`; `refusal` is what the dry run of the preferences throws */
  function parts(log: string[], overrides: { changed?: boolean; refusal?: unknown } = {}) {
    const checks = new CommitList(ORDER);
    const commits = new CommitList(ORDER);
    const step = (name: string, failure?: unknown) => async () => {
      log.push(name);
      if (failure !== undefined) throw failure;
    };
    return {
      checks,
      commits,
      step,
      parts: {
        changed: overrides.changed ?? true,
        checkPrefs: step("checkPrefs", overrides.refusal),
        savePrefs: step("savePrefs"),
        checks,
        commits,
        prefsFailedAs: (e: unknown) => prefsFailure(e, (g) => label(g)),
        pageFailedAs: (page: string, e: unknown) => pageFailure(label(page), e),
        prefsPart: "General → Number Formats, Modules → Map View",
        pagePart: (page: string, key: string) => (key === "qth" ? "General → Ground Stations" : label(page)),
      },
    };
  }

  it("nothing is saved when a page's check fails, and the error says its group and tab and the Thai text of the server", async () => {
    const log: string[] = [];
    const w = parts(log);
    w.checks.add("interfaces", "hwconf", w.step("check interfaces", new TabError("Rotators", "Port ต้องเป็นจำนวนเต็ม 1024–65535")));
    w.checks.add("general", "qth", w.step("check general"));
    w.commits.add("general", "qth", w.step("commit general"));
    w.commits.add("interfaces", "hwconf", w.step("commit interfaces"));
    await expect(commitPreferences(commitSteps(w.parts))).rejects.toThrow("Interfaces → Rotators: Port ต้องเป็นจำนวนเต็ม 1024–65535");
    expect(log).toEqual(["checkPrefs", "check general", "check interfaces"]); // General first; no savePrefs, no commit
  });

  it("nothing is saved when the preferences are refused: the error is placed by the key the server names", async () => {
    const log: string[] = [];
    const w = parts(log, { refusal: new ApiError("PREFS_INVALID", "Minimum elevation ต้องเป็นจำนวนเต็ม 1–90", 422, "error", "PREDICT/MINIMUM_ELEV") });
    w.checks.add("interfaces", "hwconf", w.step("check interfaces"));
    w.commits.add("interfaces", "hwconf", w.step("commit interfaces"));
    await expect(commitPreferences(commitSteps(w.parts))).rejects.toThrow(
      "Predict → Pass Conditions: Minimum elevation ต้องเป็นจำนวนเต็ม 1–90",
    );
    expect(log).toEqual(["checkPrefs"]);
  });

  it("a failed commit names its group", async () => {
    const log: string[] = [];
    const w = parts(log);
    w.commits.add("interfaces", "hwconf", w.step("commit interfaces", new ApiError("HWCONF_INVALID", "เขียนไฟล์ไม่ได้", 500)));
    await expect(commitPreferences(commitSteps(w.parts))).rejects.toThrow("Interfaces: เขียนไฟล์ไม่ได้");
  });

  it("a commit that fails after other parts were written says which parts are saved already (Cancel does not take them back)", async () => {
    const log: string[] = [];
    const w = parts(log);
    w.commits.add("interfaces", "hwconf", w.step("commit interfaces", new ApiError("HWCONF_INVALID", "เขียนไฟล์ไม่ได้", 500)));
    w.commits.add("general", "qth", w.step("commit general"));
    const failure = await commitPreferences(commitSteps(w.parts)).then(
      () => null,
      (e: unknown) => (e as Error).message,
    );
    expect(log).toEqual(["checkPrefs", "savePrefs", "commit general", "commit interfaces"]);
    expect(failure).toBe(
      "Interfaces: เขียนไฟล์ไม่ได้ (บันทึกส่วนเหล่านี้ไปแล้ว กด Cancel ก็ไม่ย้อนกลับ: General → Number Formats, Modules → Map View, General → Ground Stations)",
    );
  });

  it("a failure with nothing written before it has no note: the save of the preferences, or a first commit when no preference changed", async () => {
    const message = (p: Promise<void>) => p.then(() => null, (e: unknown) => (e as Error).message);
    const refused = parts([]);
    refused.parts.savePrefs = refused.step("savePrefs", new ApiError("PREFS_INVALID", "เขียนไฟล์ไม่ได้", 500));
    expect(await message(commitPreferences(commitSteps(refused.parts)))).toBe("เขียนไฟล์ไม่ได้");

    const first = parts([], { changed: false });
    first.commits.add("general", "qth", first.step("commit general", new ApiError("QTH_INVALID", "ไม่มีสถานี", 409)));
    first.commits.add("interfaces", "hwconf", first.step("commit interfaces"));
    expect(await message(commitPreferences(commitSteps(first.parts)))).toBe("General: ไม่มีสถานี");

    const second = parts([], { changed: false });
    second.commits.add("general", "qth", second.step("commit general"));
    second.commits.add("interfaces", "hwconf", second.step("commit interfaces", new ApiError("HWCONF_INVALID", "เขียนไฟล์ไม่ได้", 500)));
    expect(await message(commitPreferences(commitSteps(second.parts)))).toBe(`Interfaces: เขียนไฟล์ไม่ได้ ${savedNote(["General → Ground Stations"])}`);
  });

  it("a second OK starts a new list: what the first OK saved is not named again", async () => {
    const w = parts([], { changed: false });
    let fail = true;
    w.commits.add("general", "qth", w.step("commit general"));
    w.commits.add("interfaces", "hwconf", async () => {
      if (fail) throw new ApiError("HWCONF_INVALID", "เขียนไฟล์ไม่ได้", 500);
    });
    await expect(commitPreferences(commitSteps(w.parts))).rejects.toThrow(savedNote(["General → Ground Stations"]));
    fail = false;
    await expect(commitPreferences(commitSteps(w.parts))).resolves.toBeUndefined();
  });

  it("without a change to a preference the preferences are neither checked nor saved, and the pages still are", async () => {
    const log: string[] = [];
    const w = parts(log, { changed: false });
    w.checks.add("interfaces", "hwconf", w.step("check"));
    w.commits.add("interfaces", "hwconf", w.step("commit"));
    await commitPreferences(commitSteps(w.parts));
    expect(log).toEqual(["check", "commit"]);
  });
});
