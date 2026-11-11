import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerCommand, resetCommands } from "../../src/commands";
import { installShortcuts } from "../../src/shortcuts";

let uninstall: () => void;
const run = {
  save: vi.fn(), del: vi.fn(), find: vi.fn(),
};

beforeEach(() => {
  resetCommands();
  for (const fn of Object.values(run)) fn.mockReset();
  registerCommand("file.save", { label: "menu.file.save", run: run.save });
  registerCommand("object.delete", { label: "menu.object.delete", run: run.del });
  registerCommand("edit.find", { label: "menu.edit.find", run: run.find });
  uninstall = installShortcuts();
  document.body.innerHTML = "";
});
afterEach(() => {
  uninstall();
  resetCommands();
  document.body.innerHTML = "";
});

/** ส่ง keydown ไปที่ element (bubbles) แล้วบอกว่า preventDefault ถูกเรียกไหม */
function press(target: Element | Window, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function scope(): { tree: HTMLElement; input: HTMLInputElement } {
  document.body.innerHTML = `<div data-focus-scope="objectBrowser"><div id="tree" tabindex="0"></div><input id="find" type="text"></div><div id="elsewhere" tabindex="0"></div>`;
  return { tree: document.getElementById("tree")!, input: document.getElementById("find") as HTMLInputElement };
}

describe("Ctrl+S", () => {
  test("runs file.save and blocks the browser's save dialog", () => {
    expect(press(document.body, { key: "s", ctrlKey: true })).toBe(true);
    expect(run.save).toHaveBeenCalledTimes(1);
  });

  test("works with Cmd (meta) as well, and with a capital S", () => {
    expect(press(document.body, { key: "S", metaKey: true })).toBe(true);
    expect(run.save).toHaveBeenCalledTimes(1);
  });

  test("is found by the physical key, so it also works on the Thai keyboard layout", () => {
    expect(press(document.body, { key: "ห", code: "KeyS", ctrlKey: true })).toBe(true);
    expect(run.save).toHaveBeenCalledTimes(1);
  });

  test("blocks the browser's save even when file.save is not registered", () => {
    resetCommands();
    expect(press(document.body, { key: "s", ctrlKey: true })).toBe(true);
    expect(run.save).not.toHaveBeenCalled();
  });

  test("still works while typing in a text field", () => {
    const { input } = scope();
    expect(press(input, { key: "s", ctrlKey: true })).toBe(true);
    expect(run.save).toHaveBeenCalledTimes(1);
  });

  test("holding the keys down saves once", () => {
    expect(press(document.body, { key: "s", ctrlKey: true, repeat: true })).toBe(true);
    expect(run.save).not.toHaveBeenCalled();
  });

  test("plain S, and Ctrl+Shift+S or Ctrl+Alt+S, are not Save", () => {
    expect(press(document.body, { key: "s" })).toBe(false);
    expect(press(document.body, { key: "s", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press(document.body, { key: "s", ctrlKey: true, altKey: true })).toBe(false);
    expect(run.save).not.toHaveBeenCalled();
  });
});

describe("keys the browser keeps", () => {
  test("Ctrl+N, Ctrl+O and Ctrl+Q are never prevented and run nothing", () => {
    for (const key of ["n", "o", "q"]) {
      expect(press(document.body, { key, ctrlKey: true }), `Ctrl+${key}`).toBe(false);
      expect(press(document.body, { key, metaKey: true }), `Cmd+${key}`).toBe(false);
    }
    expect(run.save).not.toHaveBeenCalled();
    expect(run.del).not.toHaveBeenCalled();
    expect(run.find).not.toHaveBeenCalled();
  });
});

describe("Delete and Ctrl+F", () => {
  test("Delete runs object.delete only when focus is inside the Object Browser", () => {
    const { tree } = scope();
    tree.focus();
    press(tree, { key: "Delete" });
    expect(run.del).toHaveBeenCalledTimes(1);
    const elsewhere = document.getElementById("elsewhere")!;
    elsewhere.focus();
    press(elsewhere, { key: "Delete" });
    press(document.body, { key: "Delete" });
    expect(run.del).toHaveBeenCalledTimes(1);
  });

  test("Delete does nothing while typing in the Object Browser's find box", () => {
    const { input } = scope();
    input.focus();
    press(input, { key: "Delete" });
    expect(run.del).not.toHaveBeenCalled();
  });

  test("Delete on a checkbox inside the Object Browser still counts (it is not text entry)", () => {
    document.body.innerHTML = `<div data-focus-scope="objectBrowser"><input id="cb" type="checkbox"></div>`;
    const cb = document.getElementById("cb")!;
    press(cb, { key: "Delete" });
    expect(run.del).toHaveBeenCalledTimes(1);
  });

  test("holding Delete down deletes once", () => {
    const { tree } = scope();
    press(tree, { key: "Delete" });
    press(tree, { key: "Delete", repeat: true });
    expect(run.del).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+F runs edit.find and blocks the browser's find only inside the Object Browser", () => {
    const { tree } = scope();
    expect(press(tree, { key: "f", ctrlKey: true })).toBe(true);
    expect(run.find).toHaveBeenCalledTimes(1);
    expect(press(document.getElementById("elsewhere")!, { key: "f", ctrlKey: true })).toBe(false);
    expect(press(document.body, { key: "F", metaKey: true })).toBe(false);
    expect(run.find).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+F is left to the browser when edit.find is not available", () => {
    const { tree } = scope();
    resetCommands();
    expect(press(tree, { key: "f", ctrlKey: true })).toBe(false);
  });

  test("keys are ignored while a modifier turns them into another shortcut", () => {
    const { tree } = scope();
    press(tree, { key: "Delete", ctrlKey: true });
    press(tree, { key: "Delete", shiftKey: true });
    expect(run.del).not.toHaveBeenCalled();
  });
});

describe("installShortcuts", () => {
  test("installs exactly one keydown listener on the target, and removing it stops everything", () => {
    uninstall();
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const off = installShortcuts(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(target.addEventListener.mock.calls[0][0]).toBe("keydown");
    off();
    expect(target.removeEventListener).toHaveBeenCalledWith("keydown", target.addEventListener.mock.calls[0][1]);
    uninstall = installShortcuts();
    uninstall();
    expect(press(document.body, { key: "s", ctrlKey: true })).toBe(false);
    uninstall = () => undefined;
  });
});
