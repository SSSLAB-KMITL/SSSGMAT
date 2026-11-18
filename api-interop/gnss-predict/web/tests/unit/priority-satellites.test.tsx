import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PrioritySatellites } from "../../src/windows/SatelliteCatalog/PrioritySatellites";
import { WorkspaceModeBar } from "../../src/chrome/WorkspaceModeBar";
import { useScenario } from "../../src/stores/scenario";
import { resetAll } from "./helpers/chrome";
import { fakeFlow } from "./helpers/files";
import { stubFetch } from "./helpers/fake-fetch";
import { loadObjects, makeScenarioDoc, makeTree } from "./helpers/objects";

const mission = (id: string, name: string, norad: number | null, available: boolean, status = "catalogued", aliases: string[] = []) => ({ id, name, norad, orbit_available: available, mission_status: status, aliases, note: "", reference_url: "https://celestrak.org/", orbit_epoch: null, catalog_name: name });
const catalog = { checked_on: "2026-11-17", source_error: null, collections: [
  { id: "thai", label: "ดาวไทย", note: "", entries: [mission("thaicom7", "THAICOM 7", 40141, true, "catalogued", ["ASIASAT 6", "ไทยคม 7"]), mission("theos2a", "THEOS-2A", null, false, "launch_failed"), mission("napa1", "NAPA-1", 46320, false, "deorbited")] },
  { id: "commercial", label: "IKONOS / GeoEye / WorldView", note: "EYEVIEW ใช้เลือกชื่อในกลุ่มนี้", entries: [mission("ikonos", "IKONOS", 25919, true, "retired", ["ECONOS"])] },
  { id: "cosmos_russia", label: "COSMOS รัสเซีย", note: "", entries: [] },
  { id: "cosmo_skymed", label: "COSMO-SkyMed อิตาลี", note: "", entries: [] },
] };
function server() {
  return stubFetch({
    "GET /api/satellite-collections": { json: catalog },
    "POST /api/scenarios/S1/objects": { status: 201, json: { created: ["*/Satellite/THAICOM_7"], etag: "e2", results_stale: false }, headers: { ETag: '"e2"' } },
    "GET /api/scenarios/S1": { json: makeScenarioDoc(), headers: { ETag: '"e2"' } },
    "GET /api/scenarios/S1/objects": { json: makeTree() },
  });
}
beforeEach(() => { resetAll(); loadObjects(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("closed priority registry does not request data until opened", async () => {
  const f = server(); render(<PrioritySatellites />);
  expect(f.calls).toHaveLength(0);
  await userEvent.click(screen.getByText("ดาวไทย / รายการสำคัญ"));
  await screen.findByText("THAICOM 7");
  expect(f.calls).toHaveLength(1);
});

test("all requested mission statuses stay visible and unavailable orbits cannot be selected", async () => {
  server(); render(<PrioritySatellites initiallyOpen />);
  const available = await screen.findByRole("checkbox", { name: "เลือก THAICOM 7" });
  expect((available as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByRole("checkbox", { name: "เลือก THEOS-2A" }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox", { name: "เลือก NAPA-1" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("นำส่งไม่สำเร็จ / ไม่มีวงโคจร")).toBeDefined();
  expect(screen.getByText("กลับเข้าสู่บรรยากาศแล้ว")).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "เลือกทั้งหมดที่นำเข้าได้ในกลุ่มนี้" }));
  expect(screen.getByText(/เลือกแล้ว 1 ดวง/)).toBeDefined();
});

test("selecting a Thai alias imports the verified NORAD through the ETag queue", async () => {
  const f = server(); render(<PrioritySatellites initiallyOpen />);
  await screen.findByText("THAICOM 7");
  await userEvent.type(screen.getByLabelText("ค้นรายการสำคัญ"), "ASIASAT 6");
  await userEvent.click(screen.getByRole("checkbox", { name: "เลือก THAICOM 7" }));
  await userEvent.click(screen.getByRole("button", { name: "นำเข้าดาวที่เลือก" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("เพิ่มดาวใหม่ 1 ดวง"));
  const post = f.calls.find(c => c.method === "POST")!;
  expect(post.body).toEqual({ class: "Satellite", method: "Import Orbits", format: "priority", norads: [40141] });
  expect(post.headers.has("If-Match")).toBe(true);
});

test("ECONOS finds IKONOS and both Cosmos families have separate choices", async () => {
  server(); render(<PrioritySatellites initiallyOpen />);
  await screen.findByText("THAICOM 7");
  const select = screen.getByLabelText("กลุ่มรายการสำคัญ");
  expect(within(select).getByRole("option", { name: /COSMOS รัสเซีย/ })).toBeDefined();
  expect(within(select).getByRole("option", { name: /COSMO-SkyMed อิตาลี/ })).toBeDefined();
  await userEvent.selectOptions(select, "commercial");
  await userEvent.type(screen.getByLabelText("ค้นรายการสำคัญ"), "ECONOS");
  expect(screen.getByText("IKONOS")).toBeDefined();
  expect(screen.getByText("ยุติภารกิจ / มี TLE ติดตาม")).toBeDefined();
});

test("main workspace can open the registry without a scenario or importing automatically", async () => {
  const flow = fakeFlow(); useScenario.getState().close(); render(<WorkspaceModeBar />);
  await userEvent.click(screen.getByRole("button", { name: "ดาวไทย / รายการสำคัญ" }));
  expect(flow.openPanel).toHaveBeenCalledWith("satelliteCatalog", expect.objectContaining({ priorityOpen: true, catalogMode: "satellites" }));
});
