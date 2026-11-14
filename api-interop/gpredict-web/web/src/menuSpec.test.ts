import { describe, expect, it } from "vitest";
import { laterItem, outline } from "./menuSpec";
import type { MenuSpec } from "./menuSpec";

describe("laterItem", () => {
  it("makes a disabled item from a label of LATER", () => {
    expect(laterItem("Full screen")).toEqual({ kind: "item", label: "Full screen", later: 4 });
    // (the accelerator is only a sample: neither of these items has one)
    expect(laterItem("Detach module", "F11")).toEqual({ kind: "item", label: "Detach module", accel: "F11", later: 4 });
  });

  it("throws for a label that is not in LATER", () => {
    expect(() => laterItem("Nothing")).toThrow();
  });
});

describe("outline", () => {
  it("writes a menu as one line per item, a submenu's items indented", () => {
    const menu: MenuSpec<string>[] = [
      { kind: "item", label: "A", accel: "Ctrl+A", action: "a" },
      { kind: "separator" },
      { kind: "check", label: "B", checked: true, action: "b" },
      { kind: "check", label: "C", checked: false, disabled: true },
      { kind: "submenu", label: "D", items: [{ kind: "radio", label: "E", checked: true, action: "e" }, { kind: "radio", label: "F", checked: false, action: "f" }] },
    ];
    expect(outline(menu)).toEqual(["A [Ctrl+A]", "-", "[x] B", "[ ] C (disabled)", "D >", "  (o) E", "  ( ) F"]);
  });
});
