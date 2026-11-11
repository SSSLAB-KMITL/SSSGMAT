import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useMessages } from "../../src/stores/messages";
import * as recent from "../../src/recent";
import { NewScenarioWizard } from "../../src/windows/NewScenarioWizard/NewScenarioWizard";
import { resetAll } from "./helpers/chrome";
import { fakeFlow, setUrl, type FakeFlow } from "./helpers/files";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";

const ORBITS = [
  { name: "20261112T0000Z", time_utc: "2026-11-12T00:00:00Z", groups: { gps: 31, galileo: 26 }, has_brdc: true },
  { name: "20261110T0000Z", time_utc: "2026-11-10T00:00:00Z", groups: { gps: 31 }, has_brdc: false },
];
const CREATED: Handler = { status: 201, json: { name: "NEW1" }, headers: { ETag: '"e1"' } };

const NOW = new Date("2026-11-12T10:30:00Z"); // the wizard offers the next UTC day, 13 Nov 2026
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const orbitSelect = () => field(t("field.orbitData")) as unknown as HTMLSelectElement;
const ok = () => screen.getByRole("button", { name: t("dialog.ok") });
const post = (f: ReturnType<typeof stubFetch>) => f.calls.find((c) => c.method === "POST" && c.path === "/api/scenarios");
const errorOf = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent;

let flow: FakeFlow;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({ "GET /api/orbits": { json: ORBITS }, "POST /api/scenarios": CREATED, ...over });
}

async function mount() {
  render(<NewScenarioWizard params={{}} panelId="newScenarioWizard" />);
  await waitFor(() => expect(orbitSelect().value).toBe("20261112T0000Z")); // the snapshot list arrived
}

beforeEach(() => {
  resetAll();
  localStorage.clear();
  setUrl("?test");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  flow = fakeFlow();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the fields", () => {
  test("start with the next UTC day at 00:00 for Start, one day later for Stop", async () => {
    server();
    await mount();
    expect(field(t("field.analysisStart")).value).toBe("13 Nov 2026 00:00:00.000 UTCG");
    expect(field(t("field.analysisStop")).value).toBe("14 Nov 2026 00:00:00.000 UTCG");
  });

  test("the next UTC day does not depend on the machine's timezone", async () => {
    vi.setSystemTime(new Date("2026-12-31T23:59:59Z")); // New York (the suite's TZ) is still on 31 Dec
    server();
    await mount();
    expect(field(t("field.analysisStart")).value).toBe("1 Jan 2027 00:00:00.000 UTCG");
    expect(field(t("field.analysisStop")).value).toBe("2 Jan 2027 00:00:00.000 UTCG");
  });

  test("at exactly midnight UTC the next day is still tomorrow", async () => {
    vi.setSystemTime(new Date("2026-11-12T00:00:00Z"));
    server();
    await mount();
    expect(field(t("field.analysisStart")).value).toBe("13 Nov 2026 00:00:00.000 UTCG");
  });

  test("Location is data/scenarios/ and cannot be edited", async () => {
    server();
    await mount();
    const location = field(t("field.location"));
    expect(location.value).toBe("data/scenarios/");
    expect(location.readOnly).toBe(true);
  });

  test("Template offers the two templates, THBK with all four systems first", async () => {
    server();
    await mount();
    const template = field(t("field.template")) as unknown as HTMLSelectElement;
    expect([...template.options].map((o) => [o.value, o.text])).toEqual([
      ["thbk-gnss", t("option.template.thbkAll")],
      ["empty", t("option.template.empty")],
    ]);
    expect(template.value).toBe("thbk-gnss");
  });

  test("Orbit Data lists the snapshots newest first and starts on the newest", async () => {
    server();
    await mount();
    expect([...orbitSelect().options].map((o) => o.value)).toEqual(["20261112T0000Z", "20261110T0000Z"]);
  });

  test("no snapshot yet: a Thai note says so and the field has nothing to pick", async () => {
    server({ "GET /api/orbits": { json: [] } });
    render(<NewScenarioWizard params={{}} panelId="newScenarioWizard" />);
    expect(await screen.findByText(msg("wizard.noSnapshot"))).toBeDefined();
    expect(orbitSelect().options.length).toBe(0);
  });

  test("the snapshot list not being readable is said in Thai with the server's text", async () => {
    server({ "GET /api/orbits": { status: 500, json: { code: "BOOM", text: "อ่านโฟลเดอร์ไม่ได้" } } });
    render(<NewScenarioWizard params={{}} panelId="newScenarioWizard" />);
    expect(await screen.findByText(msg("wizard.orbitsFailed", { message: "อ่านโฟลเดอร์ไม่ได้" }))).toBeDefined();
  });
});

describe("OK", () => {
  test("sends name, start, stop, template and snapshot as ISO times ending in Z, then opens the scenario", async () => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(flow.calls).toContain("open:insertObjects"));
    expect(post(f)?.body).toEqual({
      name: "NEW1", start: "2026-11-13T00:00:00Z", stop: "2026-11-14T00:00:00Z", template: "thbk-gnss", snapshot: "20261112T0000Z",
    });
  });

  test("opens the new scenario, closes the wizard, and only then opens Insert STK Objects", async () => {
    const user = userEvent.setup();
    server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(flow.calls).toContain("open:insertObjects"));
    // the layout is restored before Insert STK Objects opens (a restore replaces every window)
    expect(flow.calls).toEqual(["load:NEW1", "restore:NEW1", "close:newScenarioWizard", "open:insertObjects"]);
    expect(window.location.search).toBe("?test&sc=NEW1");
    expect(recent.list()).toEqual(["NEW1"]);
  });

  test("waits for the layout restore to finish before closing the wizard and opening Insert STK Objects", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    flow.restoreFor.mockImplementation(async (name: string) => {
      flow.calls.push(`restore:${name}`);
      await gate.promise; // a restore replaces every window, so anything opened before it ends would be wiped
    });
    server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(flow.calls).toContain("restore:NEW1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(flow.calls).toEqual(["load:NEW1", "restore:NEW1"]);
    gate.resolve();
    await waitFor(() => expect(flow.calls).toContain("open:insertObjects"));
    expect(flow.calls).toEqual(["load:NEW1", "restore:NEW1", "close:newScenarioWizard", "open:insertObjects"]);
  });

  test("sends what was picked: Empty template, the older snapshot, and typed times", async () => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), "Mine_2");
    await user.selectOptions(field(t("field.template")), "empty");
    await user.selectOptions(orbitSelect(), "20261110T0000Z");
    await user.clear(field(t("field.analysisStart")));
    await user.type(field(t("field.analysisStart")), "1 jan 2027 06:30:00");
    await user.clear(field(t("field.analysisStop")));
    await user.type(field(t("field.analysisStop")), "2 Jan 2027 06:30:00.000 UTCG");
    await user.click(ok());
    await waitFor(() => expect(post(f)).toBeDefined());
    expect(post(f)?.body).toEqual({
      name: "Mine_2", start: "2027-01-01T06:30:00Z", stop: "2027-01-02T06:30:00Z", template: "empty", snapshot: "20261110T0000Z",
    });
  });

  test("with no snapshot to pick it leaves the field out and lets the server say what is missing", async () => {
    const user = userEvent.setup();
    const f = server({
      "GET /api/orbits": { json: [] },
      "POST /api/scenarios": { status: 422, json: { code: "ORBIT_SOURCE_UNAVAILABLE", text: "ยังไม่มี snapshot ข้อมูลวงโคจร", field: "snapshot" } },
    });
    render(<NewScenarioWizard params={{}} panelId="newScenarioWizard" />);
    await screen.findByText(msg("wizard.noSnapshot"));
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(errorOf(orbitSelect())).toBe("ยังไม่มี snapshot ข้อมูลวงโคจร"));
    expect(post(f)?.body).not.toHaveProperty("snapshot");
    expect(orbitSelect().getAttribute("aria-invalid")).toBe("true");
  });

  test("is disabled while the request is running, so it is sent once", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ status: number; json: unknown }>();
    const f = server({ "POST /api/scenarios": () => gate.promise });
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect((ok() as HTMLButtonElement).disabled).toBe(true));
    await user.click(ok());
    gate.resolve({ status: 201, json: { name: "NEW1" } });
    await waitFor(() => expect(flow.calls).toContain("open:insertObjects"));
    expect(f.count("POST /api/scenarios")).toBe(1);
  });

  test("Cancel is off while the request is running, so a cancelled wizard cannot still open the new scenario, and back on after a refusal", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ status: number; json: unknown }>();
    server({ "POST /api/scenarios": () => gate.promise });
    await mount();
    const cancel = () => screen.getByRole("button", { name: t("dialog.cancel") }) as HTMLButtonElement;
    expect(cancel().disabled).toBe(false);
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(cancel().disabled).toBe(true));
    await user.click(cancel());
    expect(flow.closePanel).not.toHaveBeenCalled();
    gate.resolve({ status: 409, json: { code: "NAME_EXISTS", text: "ซ้ำ", field: "name" } });
    await waitFor(() => expect(cancel().disabled).toBe(false));
    await user.click(cancel());
    expect(flow.closePanel).toHaveBeenCalledWith("newScenarioWizard");
  });

  test("Cancel stays off while the new scenario is being opened, until the wizard is replaced", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    flow.restoreFor.mockImplementation(() => gate.promise);
    server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(flow.restoreFor).toHaveBeenCalled());
    expect((screen.getByRole("button", { name: t("dialog.cancel") }) as HTMLButtonElement).disabled).toBe(true);
    gate.resolve();
    await waitFor(() => expect(flow.calls).toContain("open:insertObjects"));
  });

  test("the scenario was created but cannot be opened: no Insert STK Objects, and the wizard closes", async () => {
    const user = userEvent.setup();
    flow = fakeFlow(false);
    server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    await waitFor(() => expect(flow.calls).toContain("close:newScenarioWizard"));
    expect(flow.calls).not.toContain("open:insertObjects");
    expect(flow.calls).not.toContain("restore:NEW1");
  });
});

describe("checks before sending", () => {
  test.each(["", "has space", "ชื่อไทย", "a/b", "x".repeat(33)])("rejects the name %j", async (name) => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    if (name !== "") await user.type(field(t("field.name")), name);
    await user.click(ok());
    expect(errorOf(field(t("field.name")))).toBe(msg("scenario.nameInvalid"));
    expect(field(t("field.name")).getAttribute("aria-invalid")).toBe("true");
    expect(post(f)).toBeUndefined();
  });

  test.each(["A", "a_b-9", "x".repeat(32)])("accepts the name %j", async (name) => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), name);
    await user.click(ok());
    await waitFor(() => expect(post(f)).toBeDefined());
  });

  test("rejects a Start that is not a UTCG time, showing an example", async () => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.clear(field(t("field.analysisStart")));
    await user.type(field(t("field.analysisStart")), "tomorrow");
    await user.click(ok());
    expect(errorOf(field(t("field.analysisStart")))).toBe(msg("time.invalid", { example: "13 Nov 2026 00:00:00.000 UTCG" }));
    expect(field(t("field.analysisStart")).className).toContain("field-invalid");
    expect(field(t("field.analysisStop")).getAttribute("aria-invalid")).toBeNull();
    expect(post(f)).toBeUndefined();
  });

  test("rejects a Stop that is not a UTCG time", async () => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.clear(field(t("field.analysisStop")));
    await user.type(field(t("field.analysisStop")), "31 Feb 2027 00:00:00");
    await user.click(ok());
    expect(errorOf(field(t("field.analysisStop")))).toBe(msg("time.invalid", { example: "13 Nov 2026 00:00:00.000 UTCG" }));
    expect(post(f)).toBeUndefined();
  });

  test.each(["13 Nov 2026 00:00:00", "12 Nov 2026 00:00:00"])("rejects a Stop (%s) that is not after Start", async (stop) => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.clear(field(t("field.analysisStop")));
    await user.type(field(t("field.analysisStop")), stop);
    await user.click(ok());
    expect(errorOf(field(t("field.analysisStop")))).toBe(msg("wizard.stopBeforeStart"));
    expect(post(f)).toBeUndefined();
  });

  test("shows every problem at once, and fixing a field clears only its own message", async () => {
    const user = userEvent.setup();
    server();
    await mount();
    await user.clear(field(t("field.analysisStart")));
    await user.click(ok());
    expect(field(t("field.name")).getAttribute("aria-invalid")).toBe("true");
    expect(field(t("field.analysisStart")).getAttribute("aria-invalid")).toBe("true");
    await user.type(field(t("field.name")), "N");
    expect(field(t("field.name")).getAttribute("aria-invalid")).toBeNull();
    expect(field(t("field.analysisStart")).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("errors from the server", () => {
  test("a taken name turns the Name field red with the server's text, and nothing is opened", async () => {
    const user = userEvent.setup();
    server({
      "POST /api/scenarios": { status: 409, json: { code: "NAME_EXISTS", text: "มี scenario ชื่อ NEW1 อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)", field: "name", detail: "NEW1" } },
    });
    await mount();
    await user.type(field(t("field.name")), "new1");
    await user.click(ok());
    await waitFor(() => expect(field(t("field.name")).getAttribute("aria-invalid")).toBe("true"));
    expect(field(t("field.name")).className).toContain("field-invalid");
    expect(errorOf(field(t("field.name")))).toBe("มี scenario ชื่อ NEW1 อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)");
    expect(flow.load).not.toHaveBeenCalled();
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(useMessages.getState().items).toEqual([]); // the field says it; nothing else to report
    expect((ok() as HTMLButtonElement).disabled).toBe(false); // and it can be sent again with another name
  });

  test.each([["start", "field.analysisStart"], ["stop", "field.analysisStop"], ["snapshot", "field.orbitData"], ["template", "field.template"]] as const)(
    "a 422 on %s goes on that field",
    async (serverField, label) => {
      const user = userEvent.setup();
      server({ "POST /api/scenarios": { status: 422, json: { code: "SCENARIO_INVALID", text: `ผิดที่ ${serverField}`, field: serverField } } });
      await mount();
      await user.type(field(t("field.name")), "NEW1");
      await user.click(ok());
      await waitFor(() => expect(errorOf(field(t(label)))).toBe(`ผิดที่ ${serverField}`));
      expect(field(t("field.name")).getAttribute("aria-invalid")).toBeNull();
    },
  );

  test("an error that names no field is shown above the buttons and goes to the Message Viewer", async () => {
    const user = userEvent.setup();
    server({ "POST /api/scenarios": { status: 500, json: { code: "BOOM", text: "ดิสก์เต็ม" } } });
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    expect(await screen.findByText("ดิสก์เต็ม")).toBeDefined();
    expect(useMessages.getState().items.map((m) => [m.level, m.code, m.text])).toEqual([["error", "BOOM", "ดิสก์เต็ม"]]);
    expect(flow.load).not.toHaveBeenCalled();
  });

  test("the server being unreachable is shown the same way", async () => {
    const user = userEvent.setup();
    const f = server();
    f.routes["POST /api/scenarios"] = () => {
      throw new Error("offline");
    };
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(ok());
    expect(await screen.findByText(msg("server.disconnected"))).toBeDefined();
  });
});

describe("Cancel", () => {
  test("closes the wizard and sends nothing", async () => {
    const user = userEvent.setup();
    const f = server();
    await mount();
    await user.type(field(t("field.name")), "NEW1");
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(flow.closePanel).toHaveBeenCalledWith("newScenarioWizard");
    expect(post(f)).toBeUndefined();
  });
});
