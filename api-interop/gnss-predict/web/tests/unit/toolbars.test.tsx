import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Toolbars } from "../../src/chrome/Toolbars";
import { registerCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useLayout } from "../../src/stores/layout";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { registerAccessCommands } from "../../src/windows/AccessTool/commands";
import { registerReportGraphManagerCommands } from "../../src/windows/ReportGraphManager/commands";
import { makeDoc, openScenario, resetWithCoreCommands } from "./helpers/chrome";

let disposeCore: () => void;
beforeEach(() => {
  disposeCore = resetWithCoreCommands();
  openScenario();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  disposeCore();
});

const animation = () => screen.getByRole("toolbar", { name: t("toolbar.animation") });
const defaults = () => screen.getByRole("toolbar", { name: t("toolbar.default") });
const btn = (bar: HTMLElement, key: Parameters<typeof t>[0]) => within(bar).getByRole("button", { name: t(key) });
const timeField = () => within(animation()).getByLabelText(t("anim.currentTime")) as HTMLInputElement;
const stepField = () => within(animation()).getByLabelText(t("anim.timeStep")) as HTMLInputElement;
const multiplierField = () => within(animation()).queryByLabelText(t("anim.xRealTimeMultiplier")) as HTMLInputElement | null;

describe("Default toolbar", () => {
  test("has New, Open, Save, Insert Object, Properties, Access and Report & Graph Manager, in that order", () => {
    render(<Toolbars />);
    expect(within(defaults()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "New", "Open", "Save", "Insert Object", "Properties", "Access", "Report & Graph Manager",
    ]);
  });

  test("a button whose command is not registered is aria-disabled", () => {
    render(<Toolbars />);
    for (const key of ["toolbar.new", "toolbar.open", "toolbar.save", "toolbar.insertObject", "toolbar.properties"] as const) {
      expect(btn(defaults(), key).getAttribute("aria-disabled"), key).toBe("true");
    }
  });

  test("a button runs its command once the command is registered", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Toolbars />);
    act(() => registerCommand("file.save", { label: "menu.file.save", run }));
    const save = btn(defaults(), "toolbar.save");
    expect(save.getAttribute("aria-disabled")).toBeNull();
    await user.click(save);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("every button has a tooltip with the name from labels.ts", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.hover(btn(defaults(), "toolbar.insertObject"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(t("toolbar.insertObject"));
  });

  test("Access says why it is disabled (no scenario)", async () => {
    const user = userEvent.setup();
    const disposeAccess = registerAccessCommands();
    try {
      useScenario.setState(useScenario.getInitialState(), true);
      render(<Toolbars />);
      const access = btn(defaults(), "toolbar.access");
      expect(access.getAttribute("aria-disabled")).toBe("true");
      await user.hover(access);
      const tip = await screen.findByRole("tooltip");
      expect(tip.textContent).toContain(t("toolbar.access"));
      expect(tip.textContent).toContain(msg("tooltip.noScenario"));
    } finally {
      disposeAccess();
    }
  });

  test("Report & Graph Manager says why it is disabled (no scenario)", async () => {
    const user = userEvent.setup();
    const dispose = registerReportGraphManagerCommands();
    try {
      useScenario.setState(useScenario.getInitialState(), true);
      render(<Toolbars />);
      const rgm = btn(defaults(), "toolbar.reportGraphManager");
      expect(rgm.getAttribute("aria-disabled")).toBe("true");
      await user.hover(rgm);
      const tip = await screen.findByRole("tooltip");
      expect(tip.textContent).toContain(t("toolbar.reportGraphManager"));
      expect(tip.textContent).toContain(msg("tooltip.noScenario"));
    } finally {
      dispose();
    }
  });

  test("hiding the toolbar in View → Toolbars removes it", () => {
    render(<Toolbars />);
    act(() => useLayout.getState().setToolbar("default", false));
    expect(screen.queryByRole("toolbar", { name: t("toolbar.default") })).toBeNull();
    expect(animation()).toBeDefined();
    act(() => useLayout.getState().setToolbar("animation", false));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("Animation toolbar buttons", () => {
  test("has Reset, Step Backward, Reverse, Pause, Start, Step Forward, the two step buttons and the three modes, in order", () => {
    render(<Toolbars />);
    expect(within(animation()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Reset", "Step Backward", "Reverse", "Pause", "Start", "Step Forward", "Decrease Time Step", "Increase Time Step",
      "Normal Animation Mode", "Real-Time Animation Mode", "X Real-Time Animation Mode",
    ]);
  });

  test("Increase Time Step three times from 60 s shows 600.00 sec", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    expect(stepField().value).toBe("60.00 sec");
    for (let i = 0; i < 3; i++) await user.click(btn(animation(), "anim.increaseStep"));
    expect(useTime.getState().step_s).toBe(600);
    expect(stepField().value).toBe("600.00 sec");
    await user.click(btn(animation(), "anim.decreaseStep"));
    expect(stepField().value).toBe("300.00 sec");
  });

  test("the Time Step field is read-only text (it changes with the step buttons)", () => {
    render(<Toolbars />);
    expect(stepField().readOnly).toBe(true);
  });

  test("a very small step shows four decimals", () => {
    act(() => useTime.setState({ step_s: 0.0001 }));
    render(<Toolbars />);
    expect(stepField().value).toBe("0.0001 sec");
  });

  test("Start plays forward, Reverse plays backward, Pause stops", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.click(btn(animation(), "anim.start"));
    expect(useTime.getState().direction).toBe(1);
    expect(btn(animation(), "anim.start").getAttribute("aria-pressed")).toBe("true");
    await user.click(btn(animation(), "anim.reverse"));
    expect(useTime.getState().direction).toBe(-1);
    expect(btn(animation(), "anim.reverse").getAttribute("aria-pressed")).toBe("true");
    await user.click(btn(animation(), "anim.pause"));
    expect(useTime.getState().direction).toBe(0);
  });

  test("Step Forward and Step Backward move one step and stop", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    const t0 = useTime.getState().current.getTime();
    await user.click(btn(animation(), "anim.stepForward"));
    expect(useTime.getState().current.getTime()).toBe(t0 + 60_000);
    await user.click(btn(animation(), "anim.stepBackward"));
    expect(useTime.getState().current.getTime()).toBe(t0);
    expect(useTime.getState().direction).toBe(0);
  });

  test("Reset returns to the Animation Start Time and stops", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.click(btn(animation(), "anim.stepForward"));
    await user.click(btn(animation(), "anim.start"));
    await user.click(btn(animation(), "anim.reset"));
    expect(useTime.getState().current.getTime()).toBe(useTime.getState().animStart.getTime());
    expect(useTime.getState().direction).toBe(0);
  });

  test("the mode buttons set the animation mode and show the current one pressed", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    expect(btn(animation(), "anim.normalMode").getAttribute("aria-pressed")).toBe("true");
    await user.click(btn(animation(), "anim.realTimeMode"));
    expect(useTime.getState().mode).toBe("realtime");
    expect(btn(animation(), "anim.realTimeMode").getAttribute("aria-pressed")).toBe("true");
    expect(btn(animation(), "anim.normalMode").getAttribute("aria-pressed")).toBe("false");
    await user.click(btn(animation(), "anim.xRealTimeMode"));
    expect(useTime.getState().mode).toBe("xrealtime");
  });

  test("with no scenario open the animation buttons are disabled with a Thai reason", async () => {
    const user = userEvent.setup();
    act(() => useScenario.setState(useScenario.getInitialState(), true));
    render(<Toolbars />);
    const start = btn(animation(), "anim.start");
    expect(start.getAttribute("aria-disabled")).toBe("true");
    await user.hover(start);
    expect((await screen.findByRole("tooltip")).textContent).toContain(msg("tooltip.noScenario"));
    await user.click(start);
    expect(useTime.getState().direction).toBe(0);
  });

  test("Start explains itself when the cycle is Stop at Time and the time is at the end", async () => {
    const user = userEvent.setup();
    act(() => useTime.setState({ cycle: "stop", current: new Date(useTime.getState().periodStop) }));
    render(<Toolbars />);
    await user.hover(btn(animation(), "anim.start"));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain(t("anim.start"));
    expect(tip.textContent).toContain(msg("anim.reachedEnd"));
  });

  test("Reverse explains itself the same way at the start of the period", async () => {
    const user = userEvent.setup();
    act(() => useTime.setState({ cycle: "stop", current: new Date(useTime.getState().periodStart) }));
    render(<Toolbars />);
    await user.hover(btn(animation(), "anim.reverse"));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain(t("anim.reverse"));
    expect(tip.textContent).toContain(msg("anim.reachedStart"));
  });

  test("the note is worked out when the tip opens: after Reset at the end of a Stop cycle, Start no longer carries it", async () => {
    const user = userEvent.setup();
    act(() => useTime.setState({ cycle: "stop", current: new Date(useTime.getState().periodStop) }));
    render(<Toolbars />); // drawn while the time is at the end
    await user.click(btn(animation(), "anim.reset")); // nothing in the toolbar re-renders for a plain time change
    expect(useTime.getState().current.getTime()).toBe(useTime.getState().animStart.getTime());
    await user.hover(btn(animation(), "anim.start"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(t("anim.start"));
  });

  test("and the other way round: a note that applies by the time the tip opens is shown", async () => {
    const user = userEvent.setup();
    act(() => useTime.setState({ cycle: "stop" }));
    render(<Toolbars />);
    act(() => useTime.setState({ current: new Date(useTime.getState().periodStop) }));
    await user.hover(btn(animation(), "anim.start"));
    expect((await screen.findByRole("tooltip")).textContent).toContain(msg("anim.reachedEnd"));
  });

  test("Start has no such note in the middle of the period", async () => {
    const user = userEvent.setup();
    act(() => useTime.setState({ cycle: "stop" }));
    render(<Toolbars />);
    await user.hover(btn(animation(), "anim.start"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(t("anim.start"));
  });
});

describe("Current Scenario Time field", () => {
  test("shows the animation time in the scenario's DateFormat", () => {
    render(<Toolbars />);
    expect(timeField().value).toBe("12 Nov 2026 00:00:00.000 UTCG");
  });

  test("shows LTZG with the offset when the scenario uses it", () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }));
    render(<Toolbars />);
    expect(timeField().value).toBe("12 Nov 2026 07:00:00.000 LTZG+07:00");
  });

  test("Current Scenario Time rejects bad text and keeps the time", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    const before = useTime.getState().current.getTime();
    await user.clear(timeField());
    await user.type(timeField(), "garbage{Enter}");
    expect(timeField().getAttribute("aria-invalid")).toBe("true");
    expect(timeField().className).toContain("field-invalid");
    expect(useTime.getState().current.getTime()).toBe(before);
    expect(timeField().value).toBe("garbage"); // what was typed stays so it can be fixed
  });

  test("a valid time outside the analysis period is accepted and the clock follows", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "1 Jan 2030 06:30:15.250 UTCG{Enter}");
    expect(useTime.getState().current.toISOString()).toBe("2030-01-01T06:30:15.250Z");
    expect(timeField().getAttribute("aria-invalid")).toBeNull();
    expect(timeField().value).toBe("1 Jan 2030 06:30:15.250 UTCG"); // leaves edit mode: shows the clock again
  });

  test("a time typed without the suffix is read in the scenario's DateFormat (LTZG uses the unit's offset)", async () => {
    const user = userEvent.setup();
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }));
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "12 Nov 2026 14:00:00{Enter}");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-12T07:00:00.000Z");
  });

  test("Enter with good text after bad text clears the error", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "nope{Enter}");
    expect(timeField().getAttribute("aria-invalid")).toBe("true");
    await user.clear(timeField());
    await user.type(timeField(), "13 Nov 2026 00:00:00.000 UTCG{Enter}");
    expect(timeField().getAttribute("aria-invalid")).toBeNull();
    expect(useTime.getState().current.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  test("Escape reverts the text and the error", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "nope{Enter}");
    await user.keyboard("{Escape}");
    expect(timeField().getAttribute("aria-invalid")).toBeNull();
    expect(timeField().value).toBe("12 Nov 2026 00:00:00.000 UTCG");
  });

  test("the error is explained in Thai", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "nope{Enter}");
    expect(screen.getByRole("alert").textContent).toBe(msg("time.invalid", { example: "12 Nov 2026 00:00:00.000 UTCG" }));
  });

  test("leaving the field without Enter drops what was typed", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "13 Nov");
    await user.tab();
    expect(timeField().value).toBe("12 Nov 2026 00:00:00.000 UTCG");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  test("Enter without editing leaves the clock alone: it does not jump back to the time the field was entered at", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    act(() => timeField().focus()); // snapshot of 12 Nov 00:00:00
    act(() => useTime.getState().setCurrent(new Date(Date.UTC(2026, 10, 12, 5))));
    await user.keyboard("{Enter}");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-12T05:00:00.000Z");
    expect(timeField().getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).not.toBe(timeField()); // Enter leaves the field, which follows the clock again
  });

  test("Enter after typing the same text back is not a change either", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.clear(timeField());
    await user.type(timeField(), "13 Nov 2026 00:00:00.000 UTCG");
    await user.clear(timeField());
    await user.type(timeField(), "12 Nov 2026 00:00:00.000 UTCG");
    act(() => useTime.getState().setCurrent(new Date(Date.UTC(2026, 10, 12, 5))));
    await user.keyboard("{Enter}");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });

  test("with no scenario open the time field is disabled, and an edit in progress is dropped when the scenario closes", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    expect(timeField().disabled).toBe(false);
    await user.clear(timeField());
    await user.type(timeField(), "garbage");
    act(() => useScenario.setState(useScenario.getInitialState(), true));
    expect(timeField().disabled).toBe(true);
    expect(timeField().value).not.toBe("garbage");
    expect(timeField().getAttribute("aria-invalid")).toBeNull();
  });

  describe("while the clock runs", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    });

    test("it refreshes at most ten times a second", () => {
      render(<Toolbars />);
      const at = (sec: number) => new Date(Date.UTC(2026, 10, 12, 0, 0, sec));
      act(() => useTime.getState().setCurrent(at(1)));
      expect(timeField().value).toBe("12 Nov 2026 00:00:01.000 UTCG"); // the first change shows at once
      act(() => useTime.getState().setCurrent(at(2)));
      act(() => useTime.getState().setCurrent(at(3)));
      expect(timeField().value).toBe("12 Nov 2026 00:00:01.000 UTCG"); // within 100 ms: held back
      act(() => void vi.advanceTimersByTime(100));
      expect(timeField().value).toBe("12 Nov 2026 00:00:03.000 UTCG"); // and the latest value lands
      act(() => void vi.advanceTimersByTime(500));
      act(() => useTime.getState().setCurrent(at(4)));
      expect(timeField().value).toBe("12 Nov 2026 00:00:04.000 UTCG"); // after a quiet spell, at once again
    });

    test("it does not overwrite text the user is typing", () => {
      render(<Toolbars />);
      const field = timeField();
      act(() => field.focus());
      fireEvent.change(field, { target: { value: "13 Nov 2026 12:" } });
      act(() => useTime.getState().setCurrent(new Date(Date.UTC(2026, 10, 12, 5))));
      act(() => void vi.advanceTimersByTime(500));
      expect(field.value).toBe("13 Nov 2026 12:");
      act(() => field.blur());
      expect(field.value).toBe("12 Nov 2026 05:00:00.000 UTCG"); // back to following the clock
    });

    test("a focused field that has not been edited holds still too", () => {
      render(<Toolbars />);
      const field = timeField();
      act(() => field.focus());
      const shown = field.value;
      act(() => useTime.getState().setCurrent(new Date(Date.UTC(2026, 10, 12, 5))));
      act(() => void vi.advanceTimersByTime(500));
      expect(field.value).toBe(shown);
    });
  });
});

describe("X Real Time Multiplier field", () => {
  test("is not shown in Normal mode and appears after X Real-Time Animation Mode is chosen", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    expect(multiplierField()).toBeNull();
    await user.click(btn(animation(), "anim.xRealTimeMode"));
    expect(multiplierField()).not.toBeNull();
    expect(multiplierField()!.value).toBe("60");
    await user.click(btn(animation(), "anim.realTimeMode"));
    expect(multiplierField()).toBeNull();
  });

  test("Enter commits a positive number", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.click(btn(animation(), "anim.xRealTimeMode"));
    await user.clear(multiplierField()!);
    await user.type(multiplierField()!, "120.5{Enter}");
    expect(useTime.getState().multiplier).toBe(120.5);
    expect(multiplierField()!.getAttribute("aria-invalid")).toBeNull();
  });

  test.each(["0", "-5", ""])("%j is rejected: red border, aria-invalid, multiplier unchanged", async (text) => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.click(btn(animation(), "anim.xRealTimeMode"));
    await user.clear(multiplierField()!);
    if (text !== "") await user.type(multiplierField()!, text);
    await user.keyboard("{Enter}");
    expect(multiplierField()!.getAttribute("aria-invalid")).toBe("true");
    expect(multiplierField()!.className).toContain("field-invalid");
    expect(useTime.getState().multiplier).toBe(60);
  });

  test("Enter without editing keeps the multiplier as it is now, not as it was when the field was entered", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.click(btn(animation(), "anim.xRealTimeMode"));
    act(() => multiplierField()!.focus());
    act(() => useTime.setState({ multiplier: 90 }));
    await user.keyboard("{Enter}");
    expect(useTime.getState().multiplier).toBe(90);
  });

  test("is disabled with no scenario open", () => {
    act(() => useTime.setState({ mode: "xrealtime" }));
    act(() => useScenario.setState(useScenario.getInitialState(), true));
    render(<Toolbars />);
    expect(multiplierField()!.disabled).toBe(true);
  });

  test("Escape reverts to the stored multiplier", async () => {
    const user = userEvent.setup();
    render(<Toolbars />);
    await user.click(btn(animation(), "anim.xRealTimeMode"));
    await user.clear(multiplierField()!);
    await user.type(multiplierField()!, "0{Enter}");
    await user.keyboard("{Escape}");
    expect(multiplierField()!.value).toBe("60");
    expect(multiplierField()!.getAttribute("aria-invalid")).toBeNull();
  });
});
