import { describe, expect, it } from "vitest";
import { outline } from "./menuSpec";
import type { MenuSpec } from "./menuSpec";

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
