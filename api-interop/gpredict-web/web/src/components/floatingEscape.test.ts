import ts from "typescript";
import { describe, expect, it } from "vitest";
import radioSource from "../radio/RadioControl.tsx?raw";
import rotatorSource from "../radio/RotatorControl.tsx?raw";
import { shouldCloseOnEscape } from "./floatingEscape";

describe("Escape on a floating window", () => {
  const press = { key: "Escape", defaultPrevented: false, closeOnEscape: true, front: true, popupOpen: false };

  it("closes the front window", () => {
    expect(shouldCloseOnEscape(press)).toBe(true);
  });

  it("does not close a window that keeps itself open on Escape (Radio Control, Antenna Control: Gpredict closes them only with the close button)", () => {
    expect(shouldCloseOnEscape({ ...press, closeOnEscape: false })).toBe(false);
  });

  it("does not close a window behind another, nor while a popup menu is open, nor when a control has used the key, nor on another key", () => {
    expect(shouldCloseOnEscape({ ...press, front: false })).toBe(false);
    expect(shouldCloseOnEscape({ ...press, popupOpen: true })).toBe(false);
    expect(shouldCloseOnEscape({ ...press, defaultPrevented: true })).toBe(false);
    expect(shouldCloseOnEscape({ ...press, key: "Enter" })).toBe(false);
  });
});

/** The value of `closeOnEscape` on the FloatingWindow elements of a source file, as written ("false"), or "(none)" without one. */
function closeOnEscapeOf(source: string): string[] {
  const file = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "FloatingWindow") {
      const attr = node.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === "closeOnEscape");
      const init = attr !== undefined && ts.isJsxAttribute(attr) ? attr.initializer : undefined;
      out.push(init === undefined ? "(none)" : ts.isJsxExpression(init) ? (init.expression?.getText() ?? "(none)") : init.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

describe("the controller windows stay open on Escape", () => {
  // one stray Escape must not disengage the radio or the rotator in the middle of a pass (the close sends q / S and saves Cycle)
  it.each([
    ["Radio Control", radioSource],
    ["Antenna Control", rotatorSource],
  ])("%s gives its FloatingWindow closeOnEscape={false}", (_, source) => {
    expect(closeOnEscapeOf(source)).toEqual(["false"]);
  });
});
