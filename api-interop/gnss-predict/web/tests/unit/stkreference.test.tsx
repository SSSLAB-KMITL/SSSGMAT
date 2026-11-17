import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { labels, oursLabels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { StkReference } from "../../src/windows/StkReference/StkReference";
import { resetAll } from "./helpers/chrome";

const ALL = Object.values(labels);
const sourceText = (source: "stk" | "ours") => (source === "stk" ? t("help.sourceStk") : t("help.sourceOurs"));

const mount = () => render(<StkReference params={{}} panelId="stkReference" />);
const bodyRows = () => screen.getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent ?? "");
const filter = (text: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
const matching = (q: string) =>
  ALL.filter((l) => [l.text, sourceText(l.source), l.ref ?? ""].some((v) => v.toLowerCase().includes(q.toLowerCase())));

beforeEach(resetAll);
afterEach(cleanup);

describe("the table", () => {
  test("has the columns Text, Source and STK ref", () => {
    mount();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([t("help.colText"), t("help.colSource"), t("help.colRef")]);
    expect([t("help.colText"), t("help.colSource"), t("help.colRef")]).toEqual(["Text", "Source", "STK ref"]);
  });

  test("has a row for every entry of the label table", () => {
    mount();
    expect(bodyRows()).toHaveLength(ALL.length);
  });

  test("shows an STK name with its source and the reference section it comes from", () => {
    mount();
    const stk = ALL.find((l) => l.source === "stk")!;
    const row = bodyRows().find((r) => cells(r)[0] === stk.text && cells(r)[2] === stk.ref)!;
    expect(row).toBeDefined();
    expect(cells(row)).toEqual([stk.text, "STK", stk.ref!]);
  });

  test("marks a name we added as 'Added by GNSS Studio', with no STK reference", () => {
    mount();
    const row = bodyRows().find((r) => cells(r)[0] === "Save As...")!;
    expect(cells(row)).toEqual(["Save As...", "Added by GNSS Studio", ""]);
  });

  test("shows how many entries are listed", () => {
    mount();
    expect(screen.getByText(msg("stkRef.count", { shown: ALL.length, total: ALL.length }))).toBeDefined();
  });
});

describe("the filter box", () => {
  test("keeps the rows whose text matches, ignoring case", () => {
    mount();
    filter("SAVE as");
    const expected = matching("save as");
    expect(expected.length).toBeGreaterThan(0);
    expect(bodyRows()).toHaveLength(expected.length);
    expect(bodyRows().map((r) => cells(r)[0])).toContain("Save As...");
    expect(screen.getByText(msg("stkRef.count", { shown: expected.length, total: ALL.length }))).toBeDefined();
  });

  test("also matches the Source column", () => {
    mount();
    filter("added by");
    expect(bodyRows()).toHaveLength(oursLabels().length);
    for (const row of bodyRows()) expect(cells(row)[1]).toBe("Added by GNSS Studio");
  });

  test("also matches the STK ref column", () => {
    mount();
    filter("§B");
    const expected = matching("§B");
    expect(expected.length).toBeGreaterThan(0);
    expect(bodyRows()).toHaveLength(expected.length);
    for (const row of bodyRows()) expect(cells(row)[2]).toContain("§B");
  });

  test("a query with no match says so, and clearing it brings every row back", () => {
    mount();
    filter("zzz-no-such-name");
    expect(screen.queryAllByRole("row").length).toBe(1); // the header only
    expect(screen.getByText(msg("stkRef.noMatch"))).toBeDefined();
    filter("");
    expect(bodyRows()).toHaveLength(ALL.length);
    expect(screen.queryByText(msg("stkRef.noMatch"))).toBeNull();
  });

  test("has an accessible name", () => {
    mount();
    expect(screen.getByRole("searchbox", { name: t("dialog.catalog.search") })).toBeDefined();
  });
});
