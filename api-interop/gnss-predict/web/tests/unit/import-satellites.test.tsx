import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ImportSatellites } from "../../src/windows/SatelliteCatalog/ImportSatellites";
import { useScenario } from "../../src/stores/scenario";
import { resetAll } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";
import { loadObjects, makeScenarioDoc, makeTree } from "./helpers/objects";

beforeEach(() => { resetAll(); loadObjects(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const button = () => screen.getByRole("button", { name: "นำเข้าและเพิ่มลง Scenario" });
async function mount() {
  render(<ImportSatellites />);
  await userEvent.click(screen.getByText("เพิ่มดาวด้วย NORAD หรือไฟล์ TLE / OMM"));
}
function server() {
  return stubFetch({
    "POST /api/scenarios/S1/objects": { status: 201, json: { created: ["*/Satellite/ISS"], etag: "e2", results_stale: false }, headers: { ETag: '"e2"' } },
    "GET /api/scenarios/S1": { json: makeScenarioDoc(), headers: { ETag: '"e2"' } },
    "GET /api/scenarios/S1/objects": { json: makeTree() },
  });
}

test("NORAD imports through the existing ETag queue and refreshes the scenario", async () => {
  const f = server();
  await mount();
  await userEvent.type(screen.getByLabelText("NORAD ที่ต้องการเพิ่ม"), "25544");
  await userEvent.click(button());
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("1 ดวง"));
  const post = f.calls.find(c => c.method === "POST")!;
  expect(post.body).toEqual({ class: "Satellite", method: "Import Orbits", format: "norad", norad: 25544 });
  expect(post.headers.has("If-Match")).toBe(true);
  expect(f.count("GET /api/scenarios/S1")).toBeGreaterThan(0);
});

test("invalid NORAD does not send a request", async () => {
  const f = server();
  await mount();
  await userEvent.type(screen.getByLabelText("NORAD ที่ต้องการเพิ่ม"), "3399999");
  await userEvent.click(button());
  expect(screen.getByRole("alert").textContent).toContain("339999");
  expect(f.calls).toHaveLength(0);
});

test("pasted OMM uses the same import flow", async () => {
  const f = server();
  await mount();
  await userEvent.selectOptions(screen.getByLabelText("รูปแบบข้อมูลวงโคจร"), "omm");
  const data = '[{"NORAD_CAT_ID":25544}]';
  await userEvent.click(screen.getByLabelText("ข้อมูล TLE หรือ OMM JSON"));
  await userEvent.paste(data);
  await userEvent.click(button());
  await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
  expect(f.calls.find(c => c.method === "POST")!.body).toEqual({ class: "Satellite", method: "Import Orbits", format: "omm", text: data });
});

test("requires an open scenario", async () => {
  useScenario.getState().close();
  await mount();
  expect((button() as HTMLButtonElement).disabled).toBe(true);
});
