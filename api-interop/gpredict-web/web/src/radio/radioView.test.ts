import { describe, expect, it } from "vitest";
import {
  answerRequest,
  beginEdit,
  beginEdits,
  countdownSize,
  editedValue,
  ellipsize,
  filterSats,
  finishEdit,
  finishEdits,
  fmtAngle,
  fmtDoppler,
  fmtLo,
  fmtRange,
  fmtRate,
  isPttSpace,
  NO_REQUESTS,
  pttKey,
  RADIO_TOOLTIPS,
  radioTitle,
  sendRequest,
  TRANSPONDER_CHARS,
} from "./radioView";
import type { Edit } from "./radioView";

const ISS = { norad: 25544, name: "ISS (ZARYA)" };
const SO50 = { norad: 27607, name: "SO-50" };
const AO7 = { norad: 7530, name: "AO-07" };

describe("read-out formats", () => {
  it("Az and El are %7.2f with the degree sign", () => {
    expect(fmtAngle(0)).toBe("   0.00°");
    expect(fmtAngle(123.456)).toBe(" 123.46°");
    expect(fmtAngle(-12.34)).toBe(" -12.34°");
    expect(fmtAngle(359.999)).toBe(" 360.00°");
  });

  it("Doppler is %.0f Hz, four dashes before the first tick", () => {
    expect(fmtDoppler(null)).toBe("---- Hz");
    expect(fmtDoppler(-3404.4)).toBe("-3404 Hz");
    expect(fmtDoppler(3404.6)).toBe("3405 Hz");
    expect(fmtDoppler(0)).toBe("0 Hz");
  });

  it("Doppler keeps the minus sign of a negative zero like C's %.0f (the server sends -0.0 at range rate 0)", () => {
    expect(fmtDoppler(-0)).toBe("-0 Hz");
    expect(fmtDoppler(-0.3)).toBe("-0 Hz");
    expect(fmtDoppler(0.3)).toBe("0 Hz");
  });

  it("LO is whole MHz", () => {
    expect(fmtLo(0)).toBe("0 MHz");
    expect(fmtLo(120)).toBe("120 MHz");
    expect(fmtLo(-9750)).toBe("-9750 MHz");
  });

  it("Range is %.0f km and Rate %.3f km/s", () => {
    expect(fmtRange(2345.67)).toBe("2346 km");
    expect(fmtRate(7.1234)).toBe("7.123 km/s");
    expect(fmtRate(-0.5)).toBe("-0.500 km/s");
  });

  it("before the first tick the labels show what Gpredict starts with", () => {
    expect(fmtAngle(null)).toBe("   0.00°");
    expect(fmtRange(null)).toBe("0 km");
    expect(fmtRate(null)).toBe("0.0 km/s");
  });
});

describe("filterSats", () => {
  it("keeps the satellites whose name has the text, ignoring case", () => {
    expect(filterSats([ISS, SO50], "iss")).toEqual([ISS]);
    expect(filterSats([ISS, SO50], "SO-")).toEqual([SO50]);
    expect(filterSats([ISS, SO50], "zarya")).toEqual([ISS]);
  });

  it("an empty text keeps every satellite", () => {
    expect(filterSats([ISS, SO50], "")).toEqual([ISS, SO50]);
  });

  it("nothing matches: the list is empty", () => {
    expect(filterSats([ISS, SO50], "nope")).toEqual([]);
  });

  it("the list is in the name order of Sky at a glance: ignoring case, numbers by value, same name by NORAD", () => {
    const a = { norad: 2, name: "sat 10" };
    const b = { norad: 3, name: "SAT 9" };
    const c = { norad: 1, name: "sat 9" };
    expect(filterSats([a, b, c], "")).toEqual([c, b, a]);
    expect(filterSats([SO50, AO7, ISS], "")).toEqual([AO7, ISS, SO50]);
  });
});

describe("tooltips (ref-R §2.2 to §2.6)", () => {
  it("uplink doppler tooltip keeps Gpredict's word", () => {
    expect(RADIO_TOOLTIPS.upDoppler).toContain("downlink");
    expect(RADIO_TOOLTIPS.upDoppler).toBe(RADIO_TOOLTIPS.downDoppler);
  });

  it("device 1 tooltip has no space after the dot", () => {
    expect(RADIO_TOOLTIPS.device1).toBe(
      "Select primary radio device.This device will be used for downlink and uplink unless you select a secondary device for uplink",
    );
  });

  it("every tooltip is Gpredict's text", () => {
    expect(RADIO_TOOLTIPS).toEqual({
      downDoppler: "The Doppler shift according to the range rate and the currently selected downlink frequency",
      upDoppler: "The Doppler shift according to the range rate and the currently selected downlink frequency",
      satellite: "Select target object",
      track: "Track the satellite transponder.\nEnabling this button will apply Doppler correction to the frequency of the radio.",
      transponder: "Select a transponder",
      tune:
        "Tune the radio to this transponder. The uplink and downlink will be set to the center of the transponder passband. " +
        "In case of beacons, only the downlink will be tuned to the beacon frequency.",
      lock:
        "Lock the uplink and the downlink to each other. Whenever you change the downlink (in the controller or on the dial, " +
        "the uplink will track it according to whether the transponder is inverting or not. Similarly, if you change the uplink " +
        "the downlink will track it automatically.\n\nIf the downlink and uplink are initially out of sync when you enable this " +
        "function, the current downlink frequency will be used as baseline for setting the new uplink frequency.",
      range: "This is the current distance between the satellite and the observer.",
      rate: "The rate of change for the distance between the satellite and the observer.",
      device1:
        "Select primary radio device.This device will be used for downlink and uplink unless you select a secondary device for uplink",
      engage: "Engage the selected radio device",
      device2: "Select secondary radio device\nThis device will be used for uplink",
      cycle: "This parameter controls the delay between commands sent to the rig.",
      countdown: "The time remaining until the next AOS or LOS event",
    });
  });
});

describe("ellipsize", () => {
  it("transponder names are cut at 30", () => {
    const long = "Linear transponder with a very long name indeed";
    const cut = ellipsize(long);
    expect(Array.from(cut)).toHaveLength(TRANSPONDER_CHARS);
    expect(cut).toBe("Linear transponder with a ver…");
    expect(cut.endsWith("…")).toBe(true);
  });

  it("a name of 30 characters or fewer is left alone", () => {
    expect(ellipsize("U/v Linear")).toBe("U/v Linear");
    expect(ellipsize("x".repeat(30))).toBe("x".repeat(30));
    expect(ellipsize("x".repeat(31))).toBe(`${"x".repeat(29)}…`);
    expect(ellipsize("")).toBe("");
  });

  it("takes the limit as an argument and does not split a character of two code units", () => {
    expect(ellipsize("abcdef", 4)).toBe("abc…");
    expect(ellipsize("😀😀😀😀", 3)).toBe("😀😀…");
  });
});

describe("window", () => {
  it("title is Gpredict's with the module name", () => {
    expect(radioTitle("Amateur")).toBe("Gpredict Radio Control: Amateur");
  });

  it("the count-down is large until the first AOS or LOS time, then xx-large", () => {
    expect(countdownSize("ΔT: 00:00:00")).toBe("large");
    expect(countdownSize("AOS in 12:34")).toBe("xx-large");
    expect(countdownSize("LOS in 01:02:03")).toBe("xx-large");
  });
});

describe("isPttSpace", () => {
  it("SPACE switches PTT only for an FT817/857/897 (manual) radio", () => {
    expect(isPttSpace(" ", true, "BUTTON")).toBe(true);
    expect(isPttSpace(" ", true, "DIV")).toBe(true);
    expect(isPttSpace(" ", false, "BUTTON")).toBe(false);
  });

  it("other keys do not", () => {
    expect(isPttSpace("Enter", true, "BUTTON")).toBe(false);
    expect(isPttSpace("a", true, "DIV")).toBe(false);
  });

  it("a space typed into a text field or a list is not PTT (GTK gives the key to the focused entry first)", () => {
    expect(isPttSpace(" ", true, "INPUT")).toBe(false);
    expect(isPttSpace(" ", true, "SELECT")).toBe(false);
    expect(isPttSpace(" ", true, "TEXTAREA")).toBe(false);
  });
});

describe("pttKey", () => {
  it("the first keydown of SPACE switches PTT; a key held down only swallows its repeats", () => {
    expect(pttKey("keydown", " ", true, "BUTTON", false)).toBe("toggle");
    expect(pttKey("keydown", " ", true, "BUTTON", true)).toBe("swallow");
  });

  it("the keyup of SPACE is swallowed too: Firefox presses the focused button on keyup", () => {
    expect(pttKey("keyup", " ", true, "BUTTON", false)).toBe("swallow");
    expect(pttKey("keyup", " ", true, "DIV", false)).toBe("swallow");
  });

  it("keys that are not PTT pass, on keydown and on keyup", () => {
    for (const type of ["keydown", "keyup"]) {
      expect(pttKey(type, " ", false, "BUTTON", false)).toBeNull();
      expect(pttKey(type, " ", true, "INPUT", false)).toBeNull();
      expect(pttKey(type, "Enter", true, "BUTTON", false)).toBeNull();
    }
  });
});

describe("edits that the server has not answered", () => {
  it("rapid steps accumulate: the last value is shown while any request is in flight", () => {
    let e: Edit | undefined = undefined;
    e = beginEdit(e, 145890001);
    e = beginEdit(e, 145890002);
    expect(e).toEqual({ value: 145890002, inFlight: 2 });
    expect(editedValue(e, 145890000)).toBe(145890002); // a tick that still has the old number does not move the knob back
  });

  it("the server's number is shown again once the last answer is in", () => {
    let e: Edit | undefined = beginEdit(beginEdit(undefined, 1), 2);
    e = finishEdit(e);
    expect(e).toEqual({ value: 2, inFlight: 1 });
    expect(editedValue(e, 0)).toBe(2);
    e = finishEdit(e);
    expect(e).toBeUndefined();
    expect(editedValue(e, 7)).toBe(7);
  });

  it("finishing an edit that is not there changes nothing", () => {
    expect(finishEdit(undefined)).toBeUndefined();
  });
});

describe("the edits of a window, by name", () => {
  it("each number has its own edit: a step of Cycle does not touch the knob's", () => {
    let e = beginEdits<"az" | "cycle">({}, "az", 10);
    e = beginEdits(e, "cycle", 500);
    e = beginEdits(e, "az", 11);
    expect(e).toEqual({ az: { value: 11, inFlight: 2 }, cycle: { value: 500, inFlight: 1 } });
    e = finishEdits(e, "az");
    expect(e).toEqual({ az: { value: 11, inFlight: 1 }, cycle: { value: 500, inFlight: 1 } });
    e = finishEdits(finishEdits<"az" | "cycle">(e, "az"), "cycle");
    expect(editedValue(e.az, 0)).toBe(0);
    expect(editedValue(e.cycle, 3)).toBe(3);
  });

  it("does not change the object it is given", () => {
    const before = beginEdits<"az">({}, "az", 1);
    beginEdits(before, "az", 2);
    finishEdits(before, "az");
    expect(before).toEqual({ az: { value: 1, inFlight: 1 } });
  });
});

describe("the order of the requests and their answers", () => {
  it("requests are numbered 1, 2, 3 ...", () => {
    const a = sendRequest(NO_REQUESTS);
    const b = sendRequest(a.order);
    expect([a.n, b.n]).toEqual([1, 2]);
  });

  it("answers in the order of the requests are all shown", () => {
    const a = sendRequest(NO_REQUESTS);
    const b = sendRequest(a.order);
    const first = answerRequest(b.order, a.n);
    expect(first.show).toBe(true);
    expect(answerRequest(first.order, b.n).show).toBe(true);
  });

  it("an answer that comes after the answer of a newer request is dropped", () => {
    const a = sendRequest(NO_REQUESTS);
    const b = sendRequest(a.order);
    const newer = answerRequest(b.order, b.n);
    expect(newer.show).toBe(true);
    expect(answerRequest(newer.order, a.n).show).toBe(false);
    // and the newest one that was shown stays the newest
    expect(answerRequest(newer.order, a.n).order).toEqual(newer.order);
  });

  it("an answer is shown once", () => {
    const a = sendRequest(NO_REQUESTS);
    const shown = answerRequest(a.order, a.n);
    expect(answerRequest(shown.order, a.n).show).toBe(false);
  });

  it("does not change the order it is given", () => {
    sendRequest(NO_REQUESTS);
    answerRequest(NO_REQUESTS, 1);
    expect(NO_REQUESTS).toEqual({ sent: 0, applied: 0 });
  });
});
