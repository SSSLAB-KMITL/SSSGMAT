import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WorkspaceModeBar } from "../../src/chrome/WorkspaceModeBar";
import { useWorkspaceMode, readWorkspaceMode, WORKSPACE_MODE_KEY } from "../../src/stores/workspaceMode";
import { useScenario } from "../../src/stores/scenario";
import { useLayout } from "../../src/stores/layout";
import { NewScenarioWizard } from "../../src/windows/NewScenarioWizard/NewScenarioWizard";
import { SatelliteCatalog } from "../../src/windows/SatelliteCatalog/SatelliteCatalog";
import { t } from "../../src/labels/labels";
import { resetAll } from "./helpers/chrome";
import { fakeFlow } from "./helpers/files";
import { stubFetch } from "./helpers/fake-fetch";
import { loadObjects, entry } from "./helpers/objects";

beforeEach(() => { resetAll(); localStorage.clear(); useWorkspaceMode.setState({ mode: "gnss" }); loadObjects(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("switching mode preserves the open scenario and layout and never sends a write", async () => {
  fakeFlow();
  const f = stubFetch({});
  const doc = useScenario.getState().doc;
  const api = useLayout.getState().api;
  render(<WorkspaceModeBar />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "โหมดการทำงาน" }), "satellites");
  expect(useScenario.getState().doc).toBe(doc);
  expect(useLayout.getState().api).toBe(api);
  expect(f.calls).toHaveLength(0);
  expect(readWorkspaceMode()).toBe("satellites");
  expect(localStorage.getItem(WORKSPACE_MODE_KEY)).toBe("satellites");
});

test("both workflows open the catalog in the same workspace", async () => {
  const flow = fakeFlow();
  render(<WorkspaceModeBar />);
  await userEvent.click(screen.getByRole("button", { name: "เลือกดาว GNSS" }));
  expect(flow.openPanel).toHaveBeenLastCalledWith("satelliteCatalog", expect.objectContaining({ catalogMode: "gnss" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "โหมดการทำงาน" }), "satellites");
  await userEvent.click(screen.getByRole("button", { name: "เลือกดาว / นำเข้าจาก Gpredict" }));
  expect(flow.openPanel).toHaveBeenLastCalledWith("satelliteCatalog", expect.objectContaining({ catalogMode: "satellites", expandImport: true, importFormat: "gpredict_local" }));
});

test("selection remains available without a scenario; catalog action requires one", async () => {
  fakeFlow(); useScenario.getState().close();
  render(<WorkspaceModeBar />);
  expect((screen.getByRole("button", { name: "เลือกดาว GNSS" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "สร้าง Scenario" }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "โหมดการทำงาน" }), "satellites");
  expect(useWorkspaceMode.getState().mode).toBe("satellites");
});

test.each([["gnss", "thbk-gnss"], ["satellites", "empty"]] as const)("%s chooses the new scenario default %s", async (mode, template) => {
  fakeFlow(); useWorkspaceMode.setState({ mode });
  stubFetch({ "GET /api/orbits": { json: [] } });
  render(<NewScenarioWizard />);
  await waitFor(() => expect((screen.getByLabelText(t("field.template")) as HTMLSelectElement).value).toBe(template));
});

test("mode-specific catalog filter keeps all four GNSS systems and can reveal general satellites", async () => {
  const rows = ["G", "R", "E", "C", "X", "U"].map((system, i) => entry(i+1, [], { prn: `${system}01`, system, norad: 90000+i }));
  stubFetch({ "GET /api/catalog": { json: rows } });
  render(<SatelliteCatalog params={{ catalogMode: "gnss", requestId: 1 }} />);
  await screen.findByText("R01");
  expect(screen.queryByText("U01")).toBeNull();
  expect(screen.queryByText("X01")).toBeNull();
  for (const letter of "GREC") expect(screen.getByText(`${letter}01`)).toBeDefined();
  await userEvent.selectOptions(screen.getByLabelText(t("field.system")), "");
  expect(screen.getByText("U01")).toBeDefined();
  expect(screen.getByText("X01")).toBeDefined();
});

test("general catalog opens Gpredict import but does not import or download automatically", async () => {
  const f = stubFetch({ "GET /api/catalog": { json: [] } });
  render(<SatelliteCatalog params={{ catalogMode: "satellites", expandImport: true, importFormat: "gpredict_local", requestId: 2 }} />);
  expect((screen.getByLabelText("รูปแบบข้อมูลวงโคจร") as HTMLSelectElement).value).toBe("gpredict_local");
  expect((screen.getByText("เพิ่มดาวด้วย NORAD หรือไฟล์ TLE / OMM").closest("details") as HTMLDetailsElement).open).toBe(true);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  expect(f.calls[0].method).toBe("GET");
});

test("unavailable local storage does not stop mode selection", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(() => useWorkspaceMode.getState().setMode("satellites")).not.toThrow();
  expect(useWorkspaceMode.getState().mode).toBe("satellites");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(readWorkspaceMode()).toBe("gnss");
});
