import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSaveAs } from "../../src/chrome/SaveAsDialog";
import { registerFileCommands } from "../../src/chrome/fileCommands";
import { commandText, commandTooltip, isEnabled, isRegistered, runCommand, subscribeCommands, type CommandId } from "../../src/commands";
import { msg } from "../../src/labels/messages.th";
import * as recent from "../../src/recent";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { openScenario, resetAll } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";
import { fakeFlow, setUrl, type FakeFlow } from "./helpers/files";

const FILE_IDS: CommandId[] = ["file.new", "file.open", "file.save", "file.saveAs", "file.close", "file.exit"];
const HELP_IDS: CommandId[] = ["help.welcome", "help.about", "help.stkReference"];

let flow: FakeFlow;
let dispose: () => void;

const start = () => {
  dispose = registerFileCommands();
};

beforeEach(() => {
  resetAll();
  localStorage.clear();
  setUrl("?test");
  flow = fakeFlow();
  dispose = () => undefined;
});
afterEach(() => {
  dispose();
  vi.restoreAllMocks();
});

describe("registration", () => {
  test("registers every File and Help command", () => {
    start();
    for (const id of [...FILE_IDS, ...HELP_IDS]) expect(isRegistered(id), id).toBe(true);
  });

  test("the disposer removes them all", () => {
    start();
    recent.push("A");
    dispose();
    for (const id of [...FILE_IDS, ...HELP_IDS, "file.recent.1" as const]) expect(isRegistered(id), id).toBe(false);
  });

  test("the disposer leaves a command that someone else has registered since", async () => {
    const { registerCommand } = await import("../../src/commands");
    start();
    const other = registerCommand("help.about", { label: "help.about", run: vi.fn() });
    dispose();
    expect(isRegistered("help.about")).toBe(true);
    other();
  });
});

describe("which commands can be used", () => {
  test("with no scenario open: Save, Save As and Close are off, the rest are on", () => {
    start();
    expect(["file.save", "file.saveAs", "file.close"].map((id) => isEnabled(id as CommandId))).toEqual([false, false, false]);
    for (const id of ["file.new", "file.open", "file.exit", ...HELP_IDS] as CommandId[]) expect(isEnabled(id), id).toBe(true);
    expect(commandTooltip("file.save")).toBe(msg("tooltip.noScenario"));
  });

  test("with a scenario open everything is on", () => {
    start();
    openScenario();
    for (const id of [...FILE_IDS, ...HELP_IDS]) expect(isEnabled(id), id).toBe(true);
    expect(commandTooltip("file.save")).toBeUndefined();
  });

  test("while the workspace is not mounted nothing that opens a window works", () => {
    useLayout.setState({ api: null });
    start();
    openScenario();
    for (const id of ["file.new", "file.open", "file.exit", "file.close", "file.saveAs", ...HELP_IDS] as CommandId[]) expect(isEnabled(id), id).toBe(false);
  });

  test("menus and toolbars are told when a scenario opens or closes, and when the workspace mounts", () => {
    start();
    const listener = vi.fn();
    const off = subscribeCommands(listener);
    openScenario();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    useScenario.getState().close();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    useLayout.setState({ api: null });
    expect(listener).toHaveBeenCalled();
    off();
  });

  test("they stop listening once disposed", () => {
    start();
    dispose();
    const listener = vi.fn();
    const off = subscribeCommands(listener);
    openScenario();
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

describe("running", () => {
  test.each([
    ["file.new", "newScenarioWizard"],
    ["file.open", "welcome"],
    ["help.welcome", "welcome"],
    ["help.about", "about"],
    ["help.stkReference", "stkReference"],
  ] as const)("%s opens the %s window", (id, kind) => {
    start();
    runCommand(id);
    expect(flow.openPanel).toHaveBeenCalledWith(kind);
  });

  test("Save As opens the Save As dialog", () => {
    start();
    openScenario();
    runCommand("file.saveAs");
    expect(useSaveAs.getState().open).toBe(true);
  });

  test("Save writes the workbook and adds one Thai info message to the Message Viewer", async () => {
    const saveWorkbook = vi.fn(async () => undefined);
    useLayout.setState({ saveWorkbook } as never);
    start();
    openScenario();
    runCommand("file.save");
    await vi.waitFor(() => expect(useMessages.getState().items).toHaveLength(1));
    expect(saveWorkbook).toHaveBeenCalledTimes(1);
    const [m] = useMessages.getState().items;
    expect([m.level, m.text]).toEqual(["info", "บันทึก workbook แล้ว"]);
    expect(msg("workbook.saved")).toBe("บันทึก workbook แล้ว");
  });

  test("Save that fails adds nothing: saveWorkbook has reported its own error", async () => {
    const saveWorkbook = vi.fn(async () => {
      throw new Error("เขียนไม่ได้");
    });
    useLayout.setState({ saveWorkbook } as never);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    start();
    openScenario();
    runCommand("file.save");
    await vi.waitFor(() => expect(saveWorkbook).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(useMessages.getState().items).toEqual([]);
    expect(logged).not.toHaveBeenCalled(); // handled, not left for the command runner to log
  });

  test("Save with no scenario open does nothing", () => {
    const saveWorkbook = vi.fn(async () => undefined);
    useLayout.setState({ saveWorkbook } as never);
    start();
    runCommand("file.save");
    expect(saveWorkbook).not.toHaveBeenCalled();
  });
});

describe("recent scenarios", () => {
  test("one command per name, in order, named after the scenario, and none for the empty places", () => {
    recent.push("A");
    recent.push("B");
    start();
    expect(isRegistered("file.recent.1")).toBe(true);
    expect(isRegistered("file.recent.2")).toBe(true);
    expect(isRegistered("file.recent.3")).toBe(false);
    expect(isRegistered("file.recent.4")).toBe(false);
    expect([commandText("file.recent.1"), commandText("file.recent.2")]).toEqual(["B", "A"]);
  });

  test("follow the list as scenarios are opened", () => {
    start();
    expect(isRegistered("file.recent.1")).toBe(false);
    recent.push("A");
    expect(commandText("file.recent.1")).toBe("A");
    recent.push("B");
    recent.push("C");
    recent.push("D");
    recent.push("E");
    expect([1, 2, 3, 4].map((i) => commandText(`file.recent.${i}` as CommandId))).toEqual(["E", "D", "C", "B"]);
  });

  test("running one opens that scenario", async () => {
    recent.push("A");
    recent.push("B");
    start();
    runCommand("file.recent.2");
    await vi.waitFor(() => expect(flow.calls).toEqual(["load:A", "restore:A"]));
  });

  test("running one whose scenario is gone (404 NOT_FOUND) takes it out of the File menu, and the others close ranks", async () => {
    const real = useScenario.getInitialState().load;
    useScenario.setState({ load: real });
    const gone = { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario Gone" } };
    stubFetch({ "GET /api/scenarios/Gone": gone, "GET /api/scenarios/Gone/objects": gone });
    recent.push("Keep");
    recent.push("Gone");
    start();
    expect([commandText("file.recent.1"), commandText("file.recent.2")]).toEqual(["Gone", "Keep"]);
    runCommand("file.recent.1");
    await vi.waitFor(() => expect(isRegistered("file.recent.2")).toBe(false));
    expect(commandText("file.recent.1")).toBe("Keep");
    expect(recent.list()).toEqual(["Keep"]);
  });

  test("are off while the workspace is not mounted", () => {
    useLayout.setState({ api: null });
    recent.push("A");
    start();
    expect(isEnabled("file.recent.1")).toBe(false);
  });
});
