// The windows of App (Sky at a glance, Time Controller, ...) are children of one element. Two children of one element with the same
// key make React mix them up: while the Time Controller (key = module name) was open, the Sky at a glance window (the same key) was
// copied again on every tick. The tests run without a DOM, so this is checked on the source of App.tsx with the TypeScript parser, and on
// the source of DetachedApp.tsx (the page of a module window), which has the same windows.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import detachedSource from "./DetachedApp.tsx?raw";

/** The key of a JSX element as written (`current`, `"x"`, `` `sky:${current}` ``), or null without one. */
function keyOf(el: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  const attrs = ts.isJsxElement(el) ? el.openingElement.attributes : el.attributes;
  for (const a of attrs.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== "key" || a.initializer === undefined) continue;
    const init = a.initializer;
    return ts.isJsxExpression(init) ? (init.expression?.getText() ?? null) : init.getText();
  }
  return null;
}

/** The keys of the elements that can be rendered in one child slot: `<X key/>`, `cond && <X key/>`, `c ? <X key/> : <Y key/>`. */
function slotKeys(node: ts.Node): string[] {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const k = keyOf(node);
    return k === null ? [] : [k];
  }
  if (ts.isJsxExpression(node)) return node.expression === undefined ? [] : slotKeys(node.expression);
  if (ts.isParenthesizedExpression(node)) return slotKeys(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return slotKeys(node.right);
  if (ts.isConditionalExpression(node)) return [...slotKeys(node.whenTrue), ...slotKeys(node.whenFalse)];
  return [];
}

/** For every JSX element and fragment of `source` that has keyed children: its tag and the keys of its child slots, slot by slot. */
function childKeys(source: string): { parent: string; slots: string[][] }[] {
  const file = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { parent: string; slots: string[][] }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const slots = node.children.map(slotKeys).filter((keys) => keys.length > 0);
      if (slots.length > 0) out.push({ parent: ts.isJsxElement(node) ? node.openingElement.getText().slice(0, 40) : "<>", slots });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** The keys that are used in two different child slots of one element. */
function clashes(slots: string[][]): string[] {
  const seen = new Map<string, number>();
  const twice: string[] = [];
  slots.forEach((keys, i) => {
    for (const k of new Set(keys)) {
      const at = seen.get(k);
      if (at !== undefined && at !== i) twice.push(k);
      seen.set(k, i);
    }
  });
  return twice;
}

describe("keys of the children of App", () => {
  it("finds a clash between two windows that are keyed by the module name", () => {
    const sample = "const a = <div>{s && <Sky key={current} />}{t && <Tc key={current} />}{u ? <A key={x} /> : <B key={x} />}</div>;";
    expect(childKeys(sample).map((p) => clashes(p.slots))).toEqual([["current"]]);
  });

  it.each([
    ["App.tsx", appSource],
    ["DetachedApp.tsx", detachedSource],
  ])("gives no two children of one element of %s the same key", (_, source) => {
    const parents = childKeys(source);
    expect(parents.length).toBeGreaterThan(0);
    for (const p of parents) expect(clashes(p.slots), p.parent).toEqual([]);
  });
});
