import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as recent from "../../src/recent";
import { closeScenario, openScenario, scenarioSearch, showWelcome, startWorkspaceFlow } from "../../src/scenarioFiles";
import { useLayout } from "../../src/stores/layout";
import { useScenario } from "../../src/stores/scenario";
import { Workspace } from "../../src/Workspace";
import { openScenario as openFakeScenario, resetAll } from "./helpers/chrome";
import { deferred } from "./helpers/fake-fetch";
import { setUrl } from "./helpers/files";

const apiOf = (): DockviewApi => {
  const api = useLayout.getState().api;
  if (api === null) throw new Error("the workspace is not mounted");
  return api;
};
const ids = () => apiOf().panels.map((p) => p.id).sort();
const kinds = () => apiOf().panels.map((p) => p.api.component);
const DEFAULT_IDS = ["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"];

async function mount() {
  render(<Workspace />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
  return apiOf();
}

let stop: (() => void) | undefined;

beforeEach(() => {
  resetAll();
  localStorage.clear();
  setUrl("?test");
});
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
  vi.restoreAllMocks();
});

describe("scenarioSearch", () => {
  test.each([
    ["", "E2E", "?sc=E2E"],
    ["?test", "E2E", "?test&sc=E2E"],
    ["?sc=OLD", "NEW", "?sc=NEW"],
    ["?test&sc=OLD&x=1", "NEW", "?test&x=1&sc=NEW"],
    ["?scx=1&sc=OLD", "NEW", "?scx=1&sc=NEW"],
    ["?sc=OLD", null, ""],
    ["?test&sc=OLD&x=1", null, "?test&x=1"],
    ["?test", null, "?test"],
    ["", null, ""],
  ])("%j with %j gives %j", (search, name, expected) => {
    expect(scenarioSearch(search, name)).toBe(expected);
  });

  test("keeps the other parameters byte for byte, so ?test stays ?test", () => {
    expect(scenarioSearch("?test&a=b%20c", "X")).toBe("?test&a=b%20c&sc=X");
  });
});

describe("openScenario", () => {
  test("loads the scenario, puts it in the URL with replaceState keeping ?test and the hash, restores its layout and remembers it", async () => {
    const load = vi.fn(async () => true);
    const restoreFor = vi.fn(async () => undefined);
    useScenario.setState({ load } as never);
    useLayout.setState({ restoreFor } as never);
    setUrl("?test#top");
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    expect(await openScenario("E2E")).toBe(true);
    expect(load).toHaveBeenCalledWith("E2E");
    expect(restoreFor).toHaveBeenCalledWith("E2E");
    expect(window.location.search + window.location.hash).toBe("?test&sc=E2E#top");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(recent.list()).toEqual(["E2E"]);
  });

  test("is finished only when the layout has been restored", async () => {
    const gate = deferred<void>();
    useScenario.setState({ load: vi.fn(async () => true) } as never);
    useLayout.setState({ restoreFor: vi.fn(() => gate.promise) } as never);
    let done = false;
    const opening = openScenario("E2E").then((ok) => {
      done = true;
      return ok;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    gate.resolve();
    expect(await opening).toBe(true);
  });

  test("a scenario that cannot be opened leaves the URL, the layout and the recent list alone", async () => {
    const restoreFor = vi.fn();
    useScenario.setState({ load: vi.fn(async () => false) } as never);
    useLayout.setState({ restoreFor } as never);
    expect(await openScenario("E2E")).toBe(false);
    expect(restoreFor).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?test");
    expect(recent.list()).toEqual([]);
  });

  test("opening one while another is open just switches, without asking", async () => {
    openFakeScenario();
    const load = vi.fn(async () => true);
    useScenario.setState({ load } as never);
    useLayout.setState({ restoreFor: vi.fn() } as never);
    expect(await openScenario("Second")).toBe(true);
    expect(load).toHaveBeenCalledWith("Second");
  });
});

describe("closeScenario (File → Close and Exit)", () => {
  test("closes the scenario, takes sc out of the URL, closes the windows that belong to it and shows Welcome", async () => {
    const api = await mount();
    openFakeScenario();
    setUrl("?test&sc=T");
    const layout = useLayout.getState();
    layout.openPanel("insertObjects");
    layout.openPanel("satelliteCatalog");
    layout.openPanel("viewFromTo");
    layout.openPanel("windowProperties3d");
    layout.openPanel("windowProperties2d");
    layout.openPanel("propertiesBrowser", { path: "*/Satellite/G01" });
    layout.openPanel("propertiesBrowser", { path: "*/Facility/THBK" });
    expect(api.panels).toHaveLength(5 + 7);

    closeScenario();

    expect(useScenario.getState().name).toBeNull();
    expect(window.location.search).toBe("?test");
    expect(kinds().filter((k) => k !== "welcome").sort()).toEqual(
      ["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"],
    );
    expect(ids()).toEqual([...DEFAULT_IDS, "welcome"].sort());
  });

  test("leaves the windows that have nothing to do with a scenario", async () => {
    await mount();
    openFakeScenario();
    const layout = useLayout.getState();
    layout.openPanel("about");
    layout.openPanel("stkReference");
    layout.openPanel("fetchOrbitData");
    layout.openPanel("dailyForecastSettings");
    layout.openPanel("newScenarioWizard");
    closeScenario();
    expect(kinds()).toEqual(expect.arrayContaining(["about", "stkReference", "fetchOrbitData", "dailyForecastSettings", "newScenarioWizard", "welcome"]));
  });

  test("with Welcome already open it stays the only Welcome", async () => {
    await mount();
    openFakeScenario();
    showWelcome();
    closeScenario();
    expect(kinds().filter((k) => k === "welcome")).toHaveLength(1);
  });

  test("with no scenario open (Exit from the Welcome state) it just shows Welcome", async () => {
    await mount();
    closeScenario();
    expect(ids()).toEqual([...DEFAULT_IDS, "welcome"].sort());
  });

  test("with the workspace not mounted it still closes the scenario and clears the URL", () => {
    openFakeScenario();
    setUrl("?sc=T");
    expect(() => closeScenario()).not.toThrow();
    expect(useScenario.getState().name).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("startWorkspaceFlow", () => {
  /** load and restoreFor are mocked; the workspace is real, so Welcome is a real window */
  const fakeLoad = (result: boolean) => {
    const load = vi.fn(async () => result);
    const restoreFor = vi.fn(async () => undefined);
    useScenario.setState({ load } as never);
    useLayout.setState({ restoreFor } as never);
    return { load, restoreFor };
  };

  test("without ?sc it shows Welcome over the default layout, once the workspace is up", async () => {
    stop = startWorkspaceFlow();
    await mount();
    await waitFor(() => expect(kinds()).toContain("welcome"));
    expect(ids()).toEqual([...DEFAULT_IDS, "welcome"].sort()); // not wiped by the default layout that is applied as the workspace starts
  });

  test("with ?sc=NAME it loads that scenario and restores its layout, without showing Welcome", async () => {
    const { load, restoreFor } = fakeLoad(true);
    setUrl("?test&sc=E2E");
    stop = startWorkspaceFlow();
    await mount();
    await waitFor(() => expect(restoreFor).toHaveBeenCalledWith("E2E"));
    expect(load).toHaveBeenCalledWith("E2E");
    expect(kinds()).not.toContain("welcome");
    expect(window.location.search).toBe("?test&sc=E2E");
    expect(recent.list()).toEqual(["E2E"]);
  });

  test("with ?sc=NAME that cannot be opened it shows Welcome and drops sc from the URL", async () => {
    const { restoreFor } = fakeLoad(false);
    setUrl("?test&sc=Missing");
    stop = startWorkspaceFlow();
    await mount();
    await waitFor(() => expect(kinds()).toContain("welcome"));
    expect(restoreFor).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?test");
    expect(recent.list()).toEqual([]);
  });

  test("an empty ?sc= counts as no scenario", async () => {
    const { load } = fakeLoad(true);
    setUrl("?sc=");
    stop = startWorkspaceFlow();
    await mount();
    await waitFor(() => expect(kinds()).toContain("welcome"));
    expect(load).not.toHaveBeenCalled();
  });

  test("starts when the workspace is already up", async () => {
    await mount();
    stop = startWorkspaceFlow();
    await waitFor(() => expect(kinds()).toContain("welcome"));
  });

  test("starts once, even if the workspace is attached again", async () => {
    const { load } = fakeLoad(true);
    setUrl("?sc=E2E");
    await mount();
    stop = startWorkspaceFlow();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const api = apiOf();
    act(() => {
      useLayout.getState().detach();
      useLayout.getState().attach(api);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("stopped before the workspace is up it does nothing", async () => {
    const { load } = fakeLoad(true);
    setUrl("?sc=E2E");
    const off = startWorkspaceFlow();
    off();
    await mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(load).not.toHaveBeenCalled();
    expect(kinds()).not.toContain("welcome");
  });

  test("a scenario that is closed from elsewhere (deleted by another tab) brings Welcome back and drops sc", async () => {
    await mount();
    stop = startWorkspaceFlow();
    await waitFor(() => expect(kinds()).toContain("welcome"));
    useLayout.getState().closePanel("welcome");
    openFakeScenario();
    setUrl("?test&sc=T");
    act(() => useScenario.getState().close());
    expect(kinds()).toContain("welcome");
    expect(window.location.search).toBe("?test");
  });

  test("a scenario that is opened does not bring Welcome", async () => {
    await mount();
    stop = startWorkspaceFlow();
    await waitFor(() => expect(kinds()).toContain("welcome"));
    useLayout.getState().closePanel("welcome");
    act(() => openFakeScenario());
    expect(kinds()).not.toContain("welcome");
  });
});
