import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { labels, oursLabels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useResults } from "../../src/stores/results";
import { useSettings, type HealthInfo } from "../../src/stores/settings";
import { About } from "../../src/windows/About/About";
import { resetAll } from "./helpers/chrome";

const HEALTH: HealthInfo = {
  engine_version: "0.7.3", gmat_found: true, data_dir: "/d", free_bytes: 5e9, writable: true,
  daily: { state: "idle", last_run_utc: null, next_run_utc: null, for_date: null },
};

const mount = () => render(<About params={{}} panelId="about" />);
/** the value shown next to a label in the version list */
const valueOf = (label: string): string => {
  const term = screen.getByText(label, { selector: "dt" });
  return (term.nextElementSibling as HTMLElement).textContent ?? "";
};

beforeEach(resetAll);
afterEach(cleanup);

describe("versions", () => {
  test("show the engine version from /health and the GMAT version from the current manifest", () => {
    useSettings.setState({ health: HEALTH });
    useResults.setState({ manifest: { satellites: [], gmat_version: "R2025a" } });
    mount();
    expect(valueOf(t("help.engineVersion"))).toBe("0.7.3");
    expect(valueOf(t("help.gmatVersion"))).toBe("R2025a");
  });

  test("show a dash for what is not known yet: no /health answer, no results", () => {
    mount();
    expect(valueOf(t("help.engineVersion"))).toBe("—");
    expect(valueOf(t("help.gmatVersion"))).toBe("—");
  });

  test("show a dash for a manifest that does not name the GMAT version", () => {
    useSettings.setState({ health: HEALTH });
    useResults.setState({ manifest: { satellites: [] } });
    mount();
    expect(valueOf(t("help.gmatVersion"))).toBe("—");
  });

  test("follow the stores while the window is open", () => {
    const { rerender } = mount();
    expect(valueOf(t("help.engineVersion"))).toBe("—");
    useSettings.setState({ health: HEALTH });
    rerender(<About params={{}} panelId="about" />);
    expect(valueOf(t("help.engineVersion"))).toBe("0.7.3");
  });
});

describe("notes", () => {
  test("says in Thai that the names follow the STK 13.1.0 help and that GNSS Studio is not from the STK developer", () => {
    mount();
    const note = screen.getByText(msg("about.disclaimer"));
    expect(note.textContent).toContain("STK 13.1.0");
    expect(note.textContent).toContain("ไม่ใช่ผลิตภัณฑ์ของผู้พัฒนา STK");
  });
});

describe("the names added by GNSS Studio", () => {
  const list = () => screen.getByRole("list", { name: t("help.sourceOurs") });

  test("lists every text in oursLabels() (spec §13 criterion 4)", () => {
    mount();
    const shown = new Set(within(list()).getAllByRole("listitem").map((li) => li.textContent));
    const missing = oursLabels().filter((o) => !shown.has(o.text)).map((o) => o.key);
    expect(missing).toEqual([]);
  });

  test("lists nothing that is only an STK name", () => {
    mount();
    const ours = new Set(oursLabels().map((o) => o.text));
    const stkOnly = Object.values(labels).filter((l) => l.source === "stk" && !ours.has(l.text)).map((l) => l.text);
    const shown = within(list()).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(shown.filter((x) => stkOnly.includes(x))).toEqual([]);
    expect(shown.filter((x) => !ours.has(x))).toEqual([]);
  });

  test("shows a text used by several labels once", () => {
    mount();
    const items = within(list()).getAllByRole("listitem").map((li) => li.textContent);
    expect(new Set(items).size).toBe(items.length);
    expect(items.filter((x) => x === "Save")).toHaveLength(1);
  });

  test("is headed by the 'Added by GNSS Studio' tag", () => {
    mount();
    expect(screen.getByRole("heading", { name: t("help.sourceOurs") })).toBeDefined();
  });
});
