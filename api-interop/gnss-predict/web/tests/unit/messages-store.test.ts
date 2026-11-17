import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { MESSAGE_CAP, isMessage, report, useMessages, useVisibleMessages, type Message } from "../../src/stores/messages";

const msgAt = (sec: number, level: Message["level"] = "info", code = "C", text = "t", object: string | null = null): Message => ({
  time: new Date(Date.UTC(2026, 10, 12, 1, 0, 0) + sec * 1000).toISOString(),
  level, code, text, object,
});

beforeEach(() => useMessages.setState(useMessages.getInitialState(), true));
const st = () => useMessages.getState();

describe("add", () => {
  test("keeps messages oldest first even when they arrive out of order", () => {
    st().add(msgAt(5, "info", "B"));
    st().add(msgAt(1, "info", "A"));
    st().add(msgAt(9, "info", "C"));
    expect(st().items.map((m) => m.code)).toEqual(["A", "B", "C"]);
  });

  test("a message with the same time, code, text and object is not added twice", () => {
    st().add(msgAt(1, "error", "X", "boom", "*/Satellite/G01"));
    st().add(msgAt(1, "error", "X", "boom", "*/Satellite/G01"));
    expect(st().items).toHaveLength(1);
    // ต่างกันที่ช่องใดช่องหนึ่งถือว่าเป็นคนละข้อความ
    st().add(msgAt(1, "error", "X", "boom", "*/Satellite/G02"));
    st().add(msgAt(1, "error", "Y", "boom", "*/Satellite/G01"));
    st().add(msgAt(1, "error", "X", "other", "*/Satellite/G01"));
    st().add(msgAt(2, "error", "X", "boom", "*/Satellite/G01"));
    expect(st().items).toHaveLength(5);
  });

  test("a null object and a missing object are the same message", () => {
    st().add(msgAt(1));
    st().add({ ...msgAt(1), object: undefined as unknown as null });
    expect(st().items).toHaveLength(1);
  });

  test("lastTime follows the newest message and survives the clear commands", () => {
    expect(st().lastTime).toBeNull();
    st().add(msgAt(3));
    st().add(msgAt(1));
    expect(st().lastTime).toBe(msgAt(3).time);
    st().clearAll();
    expect(st().lastTime).toBe(msgAt(3).time);
  });

  test("lastServerTime follows only the messages that came from the server", () => {
    expect(st().lastServerTime).toBeNull();
    st().add(msgAt(5, "info", "S1"), { fromServer: true });
    st().add(msgAt(100, "warning", "LOCAL")); // นาฬิกาของเครื่องนี้ เดินเร็วกว่า server
    expect(st().lastTime).toBe(msgAt(100).time);
    expect(st().lastServerTime).toBe(msgAt(5).time);
    st().addMany([msgAt(3, "info", "S0"), msgAt(8, "info", "S2")], { fromServer: true });
    expect(st().lastServerTime).toBe(msgAt(8).time);
    st().add(msgAt(2, "info", "S-old"), { fromServer: true }); // มาทีหลังแต่เก่ากว่า: ไม่ถอย
    expect(st().lastServerTime).toBe(msgAt(8).time);
    st().clearAll();
    expect(st().lastServerTime).toBe(msgAt(8).time);
  });

  test("a server message that is already held still counts for lastServerTime", () => {
    st().add(msgAt(5, "info", "S1"));
    expect(st().lastServerTime).toBeNull();
    st().addMany([msgAt(5, "info", "S1")], { fromServer: true });
    expect(st().items).toHaveLength(1);
    expect(st().lastServerTime).toBe(msgAt(5).time);
  });

  test("keeps at most 5000 messages and drops the oldest", () => {
    expect(MESSAGE_CAP).toBe(5000);
    st().addMany(Array.from({ length: 5003 }, (_, i) => msgAt(i, "info", `C${i}`)));
    expect(st().items).toHaveLength(5000);
    expect(st().items[0].code).toBe("C3");
    expect(st().items.at(-1)?.code).toBe("C5002");
    st().add(msgAt(9000, "info", "NEW"));
    expect(st().items).toHaveLength(5000);
    expect(st().items.at(-1)?.code).toBe("NEW");
    expect(st().items[0].code).toBe("C4");
  });

  test("addMany adds only the messages not already held", () => {
    st().add(msgAt(1, "info", "A"));
    st().addMany([msgAt(1, "info", "A"), msgAt(2, "info", "B"), msgAt(2, "info", "B")]);
    expect(st().items.map((m) => m.code)).toEqual(["A", "B"]);
  });
});

describe("visible and the clear commands", () => {
  beforeEach(() => {
    st().addMany([msgAt(1, "error", "E1"), msgAt(2, "warning", "W1"), msgAt(3, "info", "I1")]);
  });
  const codes = (tab: Parameters<ReturnType<typeof st>["visible"]>[0]) => st().visible(tab).map((m) => m.code);

  test("each tab shows its own level and All shows everything", () => {
    expect(codes("all")).toEqual(["E1", "W1", "I1"]);
    expect(codes("error")).toEqual(["E1"]);
    expect(codes("warning")).toEqual(["W1"]);
    expect(codes("info")).toEqual(["I1"]);
  });

  test("clearTab(error) empties the Error tab but the All tab still has the error message", () => {
    st().clearTab("error");
    expect(codes("error")).toEqual([]);
    expect(codes("all")).toEqual(["E1", "W1", "I1"]);
    expect(codes("warning")).toEqual(["W1"]);
    expect(st().items).toHaveLength(3); // ซ่อน ไม่ลบ
  });

  test("clearTab(all) hides the list of the All tab only", () => {
    st().clearTab("all");
    expect(codes("all")).toEqual([]);
    expect(codes("error")).toEqual(["E1"]);
  });

  test("clearAll empties every tab", () => {
    st().clearAll();
    for (const tab of ["all", "error", "warning", "info"] as const) expect(codes(tab), tab).toEqual([]);
  });

  test("a message that arrives after a clear shows normally", () => {
    st().clearAll();
    st().add(msgAt(10, "error", "E2"));
    expect(codes("all")).toEqual(["E2"]);
    expect(codes("error")).toEqual(["E2"]);
    st().clearTab("error");
    st().add(msgAt(11, "error", "E3"));
    expect(codes("error")).toEqual(["E3"]);
    expect(codes("all")).toEqual(["E2", "E3"]);
  });

  test("a cleared message that the server delivers again stays hidden", () => {
    st().clearTab("error");
    st().add(msgAt(1, "error", "E1"));
    expect(codes("error")).toEqual([]);
  });
});

describe("useVisibleMessages", () => {
  test("follows add and clear without re-rendering forever", () => {
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useVisibleMessages("error"); });
    expect(result.current).toEqual([]);
    act(() => st().add(msgAt(1, "error", "E1")));
    act(() => st().add(msgAt(2, "info", "I1")));
    expect(result.current.map((m) => m.code)).toEqual(["E1"]);
    act(() => st().clearTab("error"));
    expect(result.current).toEqual([]);
    expect(renders).toBeLessThan(10);
  });
});

describe("detail", () => {
  test("a message may carry a detail (the long text that Details shows) and it is kept", () => {
    st().add({ ...msgAt(1, "error", "JOB_FAILED", "GMAT ล้มเหลว"), detail: "Traceback (most recent call last): ..." });
    expect(st().items[0].detail).toBe("Traceback (most recent call last): ...");
    expect(st().visible("error")[0].detail).toBe("Traceback (most recent call last): ...");
  });

  test("report() takes the object and the detail", () => {
    report("error", "X", "text", "*/Satellite/G01", "more");
    expect(st().items[0]).toMatchObject({ code: "X", text: "text", object: "*/Satellite/G01", detail: "more" });
    report("info", "Y", "plain");
    expect(st().items[1].detail ?? null).toBeNull();
  });

  test("a message from the network may have a detail that is a string or null, but not another type", () => {
    const base = { time: "2026-11-12T01:00:00Z", level: "error", code: "C", text: "t", object: null };
    expect(isMessage({ ...base, detail: "d" })).toBe(true);
    expect(isMessage({ ...base, detail: null })).toBe(true);
    expect(isMessage(base)).toBe(true);
    expect(isMessage({ ...base, detail: 5 })).toBe(false);
  });
});
