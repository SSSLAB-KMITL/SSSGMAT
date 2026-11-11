import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { NamePromptDialog, type NamePromptDialogProps } from "../../src/chrome/NamePromptDialog";
import { t } from "../../src/labels/labels";
import { deferred } from "./helpers/fake-fetch";

afterEach(cleanup);

const field = () => screen.getByRole("textbox", { name: t("field.name") }) as HTMLInputElement;
const ok = () => screen.getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement;
const cancel = () => screen.getByRole("button", { name: t("dialog.cancel") }) as HTMLButtonElement;
const errorOf = () => document.getElementById(field().getAttribute("aria-describedby") ?? "")?.textContent;

function setup(over: Partial<NamePromptDialogProps> = {}) {
  const submit = vi.fn(over.submit ?? (async (_value: string) => undefined));
  const onClose = vi.fn();
  const props: NamePromptDialogProps = {
    open: true, title: "Ask", validate: (v) => (/^[a-z]+$/.test(v) ? null : "letters only"), onClose, ...over, submit,
  };
  const view = render(<NamePromptDialog {...props} />);
  return { submit, onClose, view, props };
}

describe("NamePromptDialog", () => {
  test("shows the title and one Name field that starts focused with the initial value, OK and Cancel", () => {
    setup({ initialValue: "abc" });
    expect(screen.getByRole("dialog", { name: "Ask" })).toBeDefined();
    expect(field().value).toBe("abc");
    expect(document.activeElement).toBe(field());
    expect(ok()).toBeDefined();
    expect(cancel()).toBeDefined();
  });

  test("starts empty without an initial value, and renders nothing while closed", () => {
    const { view, props } = setup();
    expect(field().value).toBe("");
    view.rerender(<NamePromptDialog {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a value that fails validate is shown on the field and nothing is submitted; typing clears it", async () => {
    const user = userEvent.setup();
    const { submit, onClose } = setup();
    await user.type(field(), "A1");
    await user.click(ok());
    expect(errorOf()).toBe("letters only");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(submit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.type(field(), "x");
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  test("a valid value is submitted as typed, then the dialog is closed", async () => {
    const user = userEvent.setup();
    const { submit, onClose } = setup();
    await user.type(field(), "abc{Enter}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith("abc");
  });

  test("an error that fieldError claims goes on the field with that text, and the dialog stays", async () => {
    const user = userEvent.setup();
    const { onClose } = setup({
      submit: async () => { throw new ApiError({ status: 409, code: "NAME_EXISTS", text: "ชื่อซ้ำ" }); },
      fieldError: (e) => (e instanceof ApiError && e.status === 409 ? e.text : null),
    });
    await user.type(field(), "abc");
    await user.click(ok());
    await waitFor(() => expect(errorOf()).toBe("ชื่อซ้ำ"));
    expect(onClose).not.toHaveBeenCalled();
    expect(ok().disabled).toBe(false);
  });

  test("any other error goes through handleError and its text is shown under the field; null shows nothing", async () => {
    const user = userEvent.setup();
    const handleError = vi.fn((e: unknown) => (e instanceof Error && e.message === "quiet" ? null : "ขัดข้อง"));
    let fail = new Error("boom");
    setup({ submit: async () => { throw fail; }, handleError });
    await user.type(field(), "abc");
    await user.click(ok());
    expect((await screen.findByRole("alert")).textContent).toBe("ขัดข้อง");
    expect(field().getAttribute("aria-invalid")).toBeNull();
    fail = new Error("quiet");
    await user.click(ok());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(handleError).toHaveBeenCalledTimes(2);
  });

  test("without handleError the text of the error is shown", async () => {
    const user = userEvent.setup();
    setup({ submit: async () => { throw new Error("disk full"); } });
    await user.type(field(), "abc");
    await user.click(ok());
    expect((await screen.findByRole("alert")).textContent).toBe("disk full");
  });

  test("while submitting OK and Cancel are disabled, Esc does not close, and a second Enter does not submit again", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    const { submit, onClose } = setup({ submit: () => gate.promise });
    await user.type(field(), "abc{Enter}");
    await waitFor(() => expect(ok().disabled).toBe(true));
    expect(cancel().disabled).toBe(true);
    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");
    expect(onClose).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  test("Cancel and Esc close it when nothing is running", async () => {
    const user = userEvent.setup();
    const { onClose, submit } = setup();
    await user.click(cancel());
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });

  test("starts from initialValue again each time it opens, and selects the text when asked to", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>again</button>
          <NamePromptDialog open={open} title="Ask" initialValue="seed" validate={() => null} submit={async () => undefined} onClose={() => setOpen(false)} selectOnFocus />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(4);
    await user.keyboard("x"); // the text was selected, so this replaces it
    expect(field().value).toBe("x");
    await user.click(cancel());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "again", hidden: true }));
    expect(field().value).toBe("seed");
  });
});
