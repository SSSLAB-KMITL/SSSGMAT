import { describe, expect, it } from "vitest";
import { closeDialog, dialogKey, showDialog } from "./dialogs";
import type { Dialog } from "./dialogs";

describe("the list of open dialogs", () => {
  const open: Dialog = { kind: "open" };
  const cloneA: Dialog = { kind: "clone", module: "A" };

  it("shows a dialog once: asking for one that is open does not stack another", () => {
    const list = showDialog([], open);
    expect(showDialog(list, open)).toBe(list);
  });

  it("tells the clone dialogs of two modules apart", () => {
    expect(dialogKey(cloneA)).not.toBe(dialogKey({ kind: "clone", module: "B" }));
    expect(showDialog([cloneA], { kind: "clone", module: "B" })).toHaveLength(2);
  });

  it("closes the one dialog and keeps the others, in order", () => {
    const list = showDialog(showDialog(showDialog([], open), cloneA), { kind: "tle" });
    expect(closeDialog(list, cloneA)).toEqual([open, { kind: "tle" }]);
  });
});
