import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COMMAND_LABELS, commandText, commandTooltip, invalidateCommands, isEnabled, isRegistered, registerCommand, resetCommands, runCommand,
  subscribeCommands, commandsVersion, type CommandId,
} from "../../src/commands";
import { labels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { TOOLBAR_NAMES } from "../../src/layout/workbook";

beforeEach(resetCommands);
afterEach(resetCommands);

describe("command registry", () => {
  test("a command that was never registered is disabled and does nothing", () => {
    expect(isRegistered("file.save")).toBe(false);
    expect(isEnabled("file.save")).toBe(false);
    expect(() => runCommand("file.save")).not.toThrow();
  });

  test("a registered command runs, and is enabled unless enabled() says otherwise", () => {
    const run = vi.fn();
    registerCommand("file.save", { label: "menu.file.save", run });
    expect(isEnabled("file.save")).toBe(true);
    runCommand("file.save");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("enabled() false disables the command and runCommand refuses to run it", () => {
    const run = vi.fn();
    let on = false;
    registerCommand("file.save", { label: "menu.file.save", run, enabled: () => on });
    expect(isEnabled("file.save")).toBe(false);
    runCommand("file.save");
    expect(run).not.toHaveBeenCalled();
    on = true;
    expect(isEnabled("file.save")).toBe(true);
    runCommand("file.save");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a throwing enabled() counts as disabled", () => {
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn(), enabled: () => { throw new Error("boom"); } });
    expect(isEnabled("file.save")).toBe(false);
  });

  test("registering again replaces the earlier registration", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerCommand("file.save", { label: "menu.file.save", run: first });
    registerCommand("file.save", { label: "menu.file.save", run: second });
    runCommand("file.save");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("registerCommand returns a disposer that removes the registration only while it is still the current one", () => {
    const a = vi.fn();
    const b = vi.fn();
    const disposeA = registerCommand("file.save", { label: "menu.file.save", run: a });
    const disposeB = registerCommand("file.save", { label: "menu.file.save", run: b }); // B replaces A
    disposeA(); // A's disposer must leave B in place
    expect(isRegistered("file.save")).toBe(true);
    runCommand("file.save");
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    disposeB();
    expect(isRegistered("file.save")).toBe(false);
    expect(isEnabled("file.save")).toBe(false);
  });

  test("a disposer notifies subscribers when it removes something, and is harmless to call twice", () => {
    const dispose = registerCommand("file.save", { label: "menu.file.save", run: vi.fn() });
    const listener = vi.fn();
    subscribeCommands(listener);
    dispose();
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("a command that throws, or rejects, does not break the caller", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerCommand("file.save", { label: "menu.file.save", run: () => { throw new Error("sync"); } });
    registerCommand("file.saveAs", { label: "menu.file.saveAs", run: () => Promise.reject(new Error("async")) });
    expect(() => runCommand("file.save")).not.toThrow();
    expect(() => runCommand("file.saveAs")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test("it is observable: registering, replacing and invalidating notify subscribers and bump the version", () => {
    const listener = vi.fn();
    const off = subscribeCommands(listener);
    const v0 = commandsVersion();
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(1);
    invalidateCommands();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(commandsVersion()).toBeGreaterThan(v0);
    off();
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("the tooltip is the registered one, and the pending ones are Thai and only while unregistered", () => {
    expect(commandTooltip("file.save")).toBeUndefined();
    for (const id of ["analysis.access", "analysis.reportGraphManager", "analysis.validation", "object.access", "object.reportGraphManager"] as const) {
      expect(commandTooltip(id), id).toBe(msg("tooltip.subtask4"));
    }
    registerCommand("analysis.access", { label: "menu.analysis.access", run: vi.fn() });
    expect(commandTooltip("analysis.access")).toBeUndefined(); // sub-project 4 registered it: no more "not yet" note
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn(), enabled: () => false, tooltip: () => "เหตุผล" });
    expect(commandTooltip("file.save")).toBe("เหตุผล");
  });

  test("commandText is the registered text(), else the label of the registration, else the default label", () => {
    expect(commandText("file.save")).toBe(t("menu.file.save"));
    registerCommand("file.recent.1", { label: "menu.file.recent", run: vi.fn(), text: () => "T1" });
    expect(commandText("file.recent.1")).toBe("T1");
  });
});

describe("command ids", () => {
  const ids = Object.keys(COMMAND_LABELS) as CommandId[];

  test("every id of spec §5.1-§5.2 and §7 is there, once", () => {
    const expected = [
      "file.new", "file.open", "file.save", "file.saveAs", "file.close", "file.exit", "file.recent.1", "file.recent.2", "file.recent.3", "file.recent.4",
      "edit.cut", "edit.copy", "edit.paste", "edit.delete", "edit.find",
      "view.objectBrowser", "view.timelineView", "view.messageViewer", "view.new3d", "view.new2d",
      ...TOOLBAR_NAMES.map((n) => `view.toolbar.${n}`), "view.fullScreen",
      "insert.new", "insert.facility", "insert.satellite", "insert.constellation",
      "analysis.access", "analysis.reportGraphManager", "analysis.validation",
      "object.properties", "object.access", "object.reportGraphManager", "object.zoomTo", "object.rename", "object.delete",
      "utilities.fetchOrbitData", "utilities.dailyForecastSettings",
      "window.windows", "window.cascade", "window.tileHorizontally", "window.tileVertically",
      "help.welcome", "help.stkReference", "help.about",
      "anim.reset", "anim.stepBackward", "anim.reverse", "anim.pause", "anim.start", "anim.stepForward", "anim.decreaseStep", "anim.increaseStep",
      "anim.normal", "anim.realtime", "anim.xrealtime",
      "g3d.homeView", "g3d.viewFromTo", "g3d.properties", "g3d.grabGlobe", "g3d.zoomIn",
      "g2d.properties", "g2d.zoomIn", "g2d.zoomOut",
      "ob.newGroup", "ob.expandAll", "ob.collapseAll", "ob.colorSelectors", "ob.onOffToggles", "ob.showFlagged",
    ];
    expect([...ids].sort()).toEqual([...expected].sort());
  });

  test("every id has a label key that exists in labels.ts", () => {
    for (const id of ids) expect(labels[COMMAND_LABELS[id]], id).toBeDefined();
  });
});
