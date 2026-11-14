// Globe Manager (spec imagery §5.1): สวิตช์ภาพพื้นโลกออนไลน์ NASA GIBS (ต้องยืนยันภาษาไทยก่อนเปิด) และรายการชั้นภาพ Show / % Translucency
// - สวิตช์เป็นของ server (useImagery.setEnabled = GET แล้ว PUT /api/settings ทั้งเอกสาร) ชั้นที่แสดงอยู่ใน workbook (useLayout.globe)
// - ไม่ต่อเครือข่ายจริง: fetch ปลอมทุกครั้ง

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { COMMAND_LABELS, isEnabled, isRegistered, runCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef, PANEL_KINDS } from "../../src/layout/panels";
import { DEFAULT_GLOBE } from "../../src/layout/workbook";
import { useImagery, type ImageryLayerInfo } from "../../src/stores/imagery";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useSettings, type Settings } from "../../src/stores/settings";
import { GlobeManager, registerGlobeManagerPanel } from "../../src/windows/GlobeManager/GlobeManager";
import { registerCoreCommands } from "../../src/chrome/coreCommands";
import { resetAll } from "./helpers/chrome";
import { deferred, stubFetch } from "./helpers/fake-fetch";

const GIBS = "NASA GIBS / EOSDIS";
const LAYERS: ImageryLayerInfo[] = [
  { id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: GIBS },
  { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS },
  { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", title: "VIIRS Suomi NPP True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS },
  { id: "MODIS_Terra_CorrectedReflectance_TrueColor", title: "MODIS Terra True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS },
  { id: "Himawari_AHI_Band3_Red_Visible_1km", title: "Himawari-9 Red Visible", period: "10min", max_level: 7, format: "png", credit: `${GIBS}, JMA` },
  { id: "Himawari_AHI_Band13_Clean_Infrared", title: "Himawari-9 Clean Infrared", period: "10min", max_level: 6, format: "png", credit: `${GIBS}, JMA` },
  { id: "GOES-East_ABI_GeoColor", title: "GOES-East GeoColor", period: "10min", max_level: 7, format: "jpg", credit: `${GIBS}, NOAA` },
  { id: "GOES-West_ABI_GeoColor", title: "GOES-West GeoColor", period: "10min", max_level: 7, format: "jpg", credit: `${GIBS}, NOAA` },
];
const TITLES = LAYERS.map((l) => l.title);
const SHOWN_BY_DEFAULT = ["Blue Marble", "VIIRS NOAA-20 True Color"];
const NATURAL_EARTH = "Natural Earth II";

const IMAGERY_OFF = { enabled: false, eox: false, osm: false, ion: false };
const SETTINGS: Settings = {
  daily: { enabled: false, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: "tok-abc",
  online_imagery: IMAGERY_OFF,
};
const GET_SETTINGS = "GET /api/settings";
const PUT = "PUT /api/settings";

let user: ReturnType<typeof userEvent.setup>;

function server(over: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({ [GET_SETTINGS]: { json: SETTINGS }, [PUT]: (call) => ({ json: call.body }), ...over });
}
const puts = (f: ReturnType<typeof stubFetch>) => f.calls.filter((c) => `${c.method} ${c.path}` === PUT);

function mount() {
  return render(
    <>
      <GlobeManager params={{}} panelId="globeManager" />
      <Dialogs />
    </>,
  );
}

/** hidden: true = หาเจอแม้กล่องยืนยันเปิดอยู่ (Radix ซ่อนส่วนที่เหลือของหน้าจาก accessibility tree) */
const online = (hidden = false) => screen.getByRole("checkbox", { name: t("field.onlineImagery"), hidden }) as HTMLInputElement;
const show = (title: string) => screen.getByRole("checkbox", { name: `${title} ${t("ob.show")}` }) as HTMLInputElement;
const translucency = (title: string) => screen.getByRole("textbox", { name: `${title} ${t("field.translucency")}` }) as HTMLInputElement;
const rowTitles = () => screen.getAllByRole("rowheader").map((r) => r.textContent);
const dialog = () => screen.getByRole("dialog");
const settle = () => waitFor(() => expect(useImagery.getState().enabled).toBe(true));
const shownTitles = () => TITLES.filter((title) => show(title).checked);

async function typeInto(input: HTMLInputElement, text: string) {
  await user.clear(input);
  if (text !== "") await user.type(input, text);
}

beforeEach(() => {
  resetAll();
  useImagery.setState(useImagery.getInitialState(), true);
  useImagery.setState({ loaded: true, layers: LAYERS, enabled: false });
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the layer list", () => {
  test("has nine rows: Natural Earth II first, then the eight catalog layers in the server's order", () => {
    mount();
    expect(rowTitles()).toEqual([NATURAL_EARTH, ...TITLES]);
    expect(rowTitles()).toHaveLength(9);
  });

  test("has the columns Layer, Show and % Translucency", () => {
    mount();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([t("field.globeLayer"), t("ob.show"), t("field.translucency")]);
    expect(t("field.translucency")).toBe("% Translucency");
  });

  test("Natural Earth II is the offline base: shown, not changeable", () => {
    mount();
    expect(show(NATURAL_EARTH).checked).toBe(true);
    expect(show(NATURAL_EARTH).disabled).toBe(true);
    expect(translucency(NATURAL_EARTH).disabled).toBe(true);
    expect(translucency(NATURAL_EARTH).value).toBe("0");
  });

  test("the layers' Show and % Translucency come from the workbook's globe settings (the default shows Blue Marble and VIIRS NOAA-20)", () => {
    mount();
    expect(shownTitles()).toEqual(SHOWN_BY_DEFAULT);
    for (const title of TITLES) expect(translucency(title).value, title).toBe("0");
    useLayout.setState({ globe: { layers: { GOES_nope: { show: true, translucency: 5 }, "GOES-East_ABI_GeoColor": { show: true, translucency: 35 } } } });
    return waitFor(() => {
      expect(shownTitles()).toEqual(["GOES-East GeoColor"]);
      expect(translucency("GOES-East GeoColor").value).toBe("35");
    });
  });
});

describe("while the online switch is off", () => {
  test("the switch is unchecked and every GIBS row is disabled, with a Thai hint", () => {
    mount();
    expect(online().checked).toBe(false);
    expect(online().disabled).toBe(false);
    for (const title of TITLES) {
      expect(show(title).disabled, title).toBe(true);
      expect(translucency(title).disabled, title).toBe(true);
    }
    expect(screen.getByText(msg("globe.offHint"))).toBeDefined();
    expect(msg("globe.offHint")).toMatch(/[฀-๿]/);
  });

  test("a disabled row cannot be changed by clicking", async () => {
    server();
    mount();
    await user.click(show("MODIS Terra True Color"));
    expect(useLayout.getState().globe).toBe(DEFAULT_GLOBE);
  });
});

describe("turning the switch on", () => {
  test("opens a Thai confirmation that names gibs.earthdata.nasa.gov, what is sent, data/imagery with its 2 GB cap, and that it can be turned off", async () => {
    const f = server();
    mount();
    await user.click(online());
    const box = dialog();
    const text = within(box).getByText(msg("globe.consent"));
    expect(text).toBeDefined();
    expect(msg("globe.consent")).toContain("gibs.earthdata.nasa.gov");
    expect(msg("globe.consent")).toMatch(/ชื่อชั้นภาพ/);
    expect(msg("globe.consent")).toMatch(/เวลา/);
    expect(msg("globe.consent")).toMatch(/พิกัด/);
    expect(msg("globe.consent")).toContain("data/imagery");
    expect(msg("globe.consent")).toContain("2 GB");
    expect(msg("globe.consent")).toMatch(/ปิดได้ทุกเมื่อ/);
    // ยังไม่เปลี่ยนอะไรจนกว่าจะยืนยัน
    expect(online(true).checked).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("Cancel changes nothing: no request at all, the switch stays off", async () => {
    const f = server();
    mount();
    await user.click(online());
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.calls).toEqual([]);
    expect(puts(f)).toHaveLength(0);
    expect(online().checked).toBe(false);
    expect(useImagery.getState().enabled).toBe(false);
    expect(show("Blue Marble").disabled).toBe(true);
  });

  test("Esc is a Cancel", async () => {
    const f = server();
    mount();
    await user.click(online());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.calls).toEqual([]);
    expect(online().checked).toBe(false);
  });

  test("Confirm makes exactly one PUT of the whole settings document with online_imagery.enabled true, then the rows are usable", async () => {
    const f = server();
    mount();
    await user.click(online());
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await settle();
    expect(puts(f)).toHaveLength(1);
    expect(puts(f)[0].body).toEqual({ ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } });
    expect(online().checked).toBe(true);
    for (const title of TITLES) {
      expect(show(title).disabled, title).toBe(false);
      expect(translucency(title).disabled, title).toBe(false);
    }
    expect(screen.queryByText(msg("globe.offHint"))).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the first enable with a fresh layout shows exactly Blue Marble and VIIRS NOAA-20 True Color (the default globe)", async () => {
    server();
    mount();
    expect(useLayout.getState().globe).toBe(DEFAULT_GLOBE);
    await user.click(online());
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await settle();
    expect(shownTitles()).toEqual(SHOWN_BY_DEFAULT);
    expect(Object.keys(useLayout.getState().globe.layers).sort()).toEqual(
      ["BlueMarble_NextGeneration", "VIIRS_NOAA20_CorrectedReflectance_TrueColor"].sort(),
    );
  });

  test("a selection the user already saved (e.g. in the workbook) is not overwritten by enabling", async () => {
    server();
    const saved = { layers: { "GOES-West_ABI_GeoColor": { show: true, translucency: 60 } } };
    useLayout.setState({ globe: saved });
    mount();
    await user.click(online());
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await settle();
    expect(useLayout.getState().globe).toEqual(saved);
    expect(shownTitles()).toEqual(["GOES-West GeoColor"]);
    expect(translucency("GOES-West GeoColor").value).toBe("60");
  });

  test("when the save fails the switch stays off and the store's Thai warning is the only report", async () => {
    server({ [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    await user.click(online());
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useMessages.getState().items.filter((m) => m.level === "warning")).toHaveLength(1));
    expect(online().checked).toBe(false);
    expect(useImagery.getState().enabled).toBe(false);
    expect(show("Blue Marble").disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the switch cannot be clicked again while the save is in flight", async () => {
    const gate = deferred<{ json: unknown }>();
    const f = server({ [PUT]: () => gate.promise });
    mount();
    await user.click(online());
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(online().disabled).toBe(true);
    await user.click(online());
    expect(screen.queryByRole("dialog")).toBeNull();
    gate.resolve({ json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } } });
    await settle();
    expect(online().disabled).toBe(false);
    expect(puts(f)).toHaveLength(1);
  });
});

describe("turning the switch off", () => {
  beforeEach(() => useImagery.setState({ enabled: true }));

  test("PUTs enabled false at once, with no confirmation, and disables the rows again", async () => {
    const f = server({ [GET_SETTINGS]: { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } } } });
    mount();
    expect(online().checked).toBe(true);
    await user.click(online());
    await waitFor(() => expect(useImagery.getState().enabled).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(puts(f)).toHaveLength(1);
    expect(puts(f)[0].body).toEqual({ ...SETTINGS, online_imagery: IMAGERY_OFF });
    expect(online().checked).toBe(false);
    for (const title of TITLES) expect(show(title).disabled, title).toBe(true);
  });

  test("keeps the user's Show and % Translucency choices for the next time", async () => {
    server({ [GET_SETTINGS]: { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } } } });
    mount();
    await user.click(show("GOES-East GeoColor"));
    await typeInto(translucency("GOES-East GeoColor"), "40");
    await user.tab();
    const before = useLayout.getState().globe;
    await user.click(online());
    await waitFor(() => expect(useImagery.getState().enabled).toBe(false));
    expect(useLayout.getState().globe).toBe(before);
    expect(show("GOES-East GeoColor").checked).toBe(true);
    expect(translucency("GOES-East GeoColor").value).toBe("40");
  });
});

describe("Show and % Translucency", () => {
  beforeEach(() => useImagery.setState({ enabled: true }));

  test("Show writes the layer's show into the layout's globe settings, keeping its translucency", async () => {
    mount();
    await user.click(show("MODIS Terra True Color"));
    expect(useLayout.getState().globe.layers.MODIS_Terra_CorrectedReflectance_TrueColor).toEqual({ show: true, translucency: 0 });
    expect(show("MODIS Terra True Color").checked).toBe(true);
    await user.click(show("Blue Marble"));
    expect(useLayout.getState().globe.layers.BlueMarble_NextGeneration).toEqual({ show: false, translucency: 0 });
    expect(show("Blue Marble").checked).toBe(false);
    // ชั้นอื่นไม่ถูกแตะ
    expect(useLayout.getState().globe.layers.VIIRS_NOAA20_CorrectedReflectance_TrueColor).toEqual({ show: true, translucency: 0 });
  });

  test("a whole number from 0 to 100 is stored when the field is left", async () => {
    mount();
    await typeInto(translucency("VIIRS NOAA-20 True Color"), "35");
    expect(useLayout.getState().globe.layers.VIIRS_NOAA20_CorrectedReflectance_TrueColor.translucency).toBe(0); // ยังพิมพ์อยู่
    await user.tab();
    expect(useLayout.getState().globe.layers.VIIRS_NOAA20_CorrectedReflectance_TrueColor).toEqual({ show: true, translucency: 35 });
    expect(translucency("VIIRS NOAA-20 True Color").value).toBe("35");
  });

  test("Enter stores it too, and 0 and 100 are valid", async () => {
    mount();
    const box = translucency("Blue Marble");
    await typeInto(box, "100");
    await user.keyboard("{Enter}");
    expect(useLayout.getState().globe.layers.BlueMarble_NextGeneration.translucency).toBe(100);
    await typeInto(box, "0");
    await user.keyboard("{Enter}");
    expect(useLayout.getState().globe.layers.BlueMarble_NextGeneration.translucency).toBe(0);
  });

  test("150 reverts to the stored value and nothing is stored", async () => {
    mount();
    await typeInto(translucency("Blue Marble"), "20");
    await user.tab();
    const before = useLayout.getState().globe;
    await typeInto(translucency("Blue Marble"), "150");
    await user.tab();
    expect(translucency("Blue Marble").value).toBe("20");
    expect(useLayout.getState().globe).toBe(before);
  });

  test.each(["101", "-5", "1.5", "1e1", "abc", "", "  ", "5 0", "٣"])("%j reverts and is not stored", async (bad) => {
    mount();
    await typeInto(translucency("Blue Marble"), "20");
    await user.tab();
    const before = useLayout.getState().globe;
    await typeInto(translucency("Blue Marble"), bad);
    await user.tab();
    expect(translucency("Blue Marble").value).toBe("20");
    expect(useLayout.getState().globe).toBe(before);
  });

  test("an invalid entry on a layer that was never touched reverts to 0 and does not create an entry", async () => {
    mount();
    await typeInto(translucency("GOES-West GeoColor"), "150");
    await user.tab();
    expect(translucency("GOES-West GeoColor").value).toBe("0");
    expect(useLayout.getState().globe.layers["GOES-West_ABI_GeoColor"]).toBeUndefined();
  });

  test("leaving a field unchanged does not touch the globe settings", async () => {
    mount();
    const before = useLayout.getState().globe;
    await user.click(translucency("GOES-West GeoColor"));
    await user.tab();
    expect(useLayout.getState().globe).toBe(before);
    await typeInto(translucency("GOES-West GeoColor"), "0"); // พิมพ์ค่าเดิม (ชั้นที่ยังไม่มีรายการ = 0) ก็ไม่สร้างรายการ
    await user.tab();
    expect(useLayout.getState().globe).toBe(before);
  });

  test("Escape puts the stored value back", async () => {
    mount();
    await typeInto(translucency("Blue Marble"), "77");
    await user.keyboard("{Escape}");
    expect(translucency("Blue Marble").value).toBe("0");
    await user.tab();
    expect(useLayout.getState().globe.layers.BlueMarble_NextGeneration.translucency).toBe(0);
  });

  test("the values stored are always integers from 0 to 100", async () => {
    mount();
    for (const text of ["007", " 42 ", "100", "0"]) {
      await typeInto(translucency("Blue Marble"), text);
      await user.tab();
      const n = useLayout.getState().globe.layers.BlueMarble_NextGeneration.translucency;
      expect(Number.isInteger(n) && n >= 0 && n <= 100, text).toBe(true);
    }
    expect(useLayout.getState().globe.layers.BlueMarble_NextGeneration.translucency).toBe(0);
  });
});

describe("when the layer list could not be read", () => {
  test("the GIBS part is shown as unavailable with a Thai message, the switch is disabled and only Natural Earth II remains", () => {
    useImagery.setState({ loaded: false, layers: [], enabled: false });
    mount();
    expect(screen.getByText(msg("globe.unavailable"))).toBeDefined();
    expect(msg("globe.unavailable")).toMatch(/[฀-๿]/);
    expect(online().disabled).toBe(true);
    expect(rowTitles()).toEqual([NATURAL_EARTH]);
    expect(screen.queryByText(msg("globe.offHint"))).toBeNull();
  });
});

describe("the window and its command", () => {
  test("registerGlobeManagerPanel makes it a floating, non-persistent, singleton window titled Globe Manager that does not depend on a scenario", () => {
    registerGlobeManagerPanel();
    const def = getPanelDef("globeManager")!;
    expect(def.component).toBe(GlobeManager);
    expect(def.type).toBe("floating");
    expect(def.persist).toBe(false);
    expect(def.scenarioBound).toBe(false);
    expect(def.singleton).toBe(true);
    expect(def.title(undefined)).toBe("Globe Manager");
    expect(t("window.globeManager")).toBe("Globe Manager");
    expect(PANEL_KINDS).toContain("globeManager");
  });

  test("registering twice keeps the same definition", () => {
    registerGlobeManagerPanel();
    registerGlobeManagerPanel();
    expect(getPanelDef("globeManager")?.component).toBe(GlobeManager);
  });

  test("view.globeManager is a core command named Globe Manager that opens the window once it can be opened", () => {
    expect(COMMAND_LABELS["view.globeManager"]).toBe("menu.view.globeManager");
    expect(t("menu.view.globeManager")).toBe("Globe Manager");
    const off = registerCoreCommands();
    try {
      expect(isRegistered("view.globeManager")).toBe(true);
      expect(isEnabled("view.globeManager")).toBe(false); // พื้นที่ทำงานยังไม่ mount
      const openPanel = vi.fn();
      useLayout.setState({ api: {} as never, openPanel });
      expect(isEnabled("view.globeManager")).toBe(true);
      runCommand("view.globeManager");
      expect(openPanel).toHaveBeenCalledWith("globeManager");
    } finally {
      off();
    }
  });
});

test("it uses the settings the store holds, so a Daily Forecast Settings save afterwards would send the switch back unchanged", async () => {
  server();
  mount();
  await user.click(online());
  await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
  await settle();
  expect(useSettings.getState().settings?.online_imagery.enabled).toBe(true);
});
