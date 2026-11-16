// Globe Manager (spec imagery §5.1, spec ภาพละเอียด §4.3): สี่กลุ่มตามแหล่ง (NASA GIBS, Sentinel-2 cloudless, OpenStreetMap, Cesium ion)
// แต่ละกลุ่มมีสวิตช์และกล่องยืนยันภาษาไทยของตัวเอง + รายการชั้นภาพ Show / % Translucency ; กลุ่ม Cesium ion มีช่อง token (ซ่อนตัวอักษร) และตัวเลือก asset
// - สวิตช์เป็นของ server (useImagery.setSource = GET แล้ว PUT /api/settings ทั้งเอกสาร) ชั้นที่แสดงอยู่และ asset ของ ion ใน workbook (useLayout.globe)
// - ไม่ต่อเครือข่ายจริง: fetch ปลอมทุกครั้ง

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { getIonFailure, ionStatus, notifyIonListeners, setIonFailure } from "../../src/cesium/ionState";
import { ION_PRESETS } from "../../src/cesium/ionAssets";
import { COMMAND_LABELS, isEnabled, isRegistered, runCommand } from "../../src/commands";
import { t, type LabelKey } from "../../src/labels/labels";
import { msg, type MsgKey } from "../../src/labels/messages.th";
import { getPanelDef, PANEL_KINDS } from "../../src/layout/panels";
import { DEFAULT_GLOBE } from "../../src/layout/workbook";
import { OSM_LAYER, useImagery, type ImageryLayerInfo, type ImagerySourceId } from "../../src/stores/imagery";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useSettings, type Settings } from "../../src/stores/settings";
import { GlobeManager, registerGlobeManagerPanel } from "../../src/windows/GlobeManager/GlobeManager";
import { registerCoreCommands } from "../../src/chrome/coreCommands";
import { resetAll } from "./helpers/chrome";
import { deferred, stubFetch } from "./helpers/fake-fetch";

const GIBS = "NASA GIBS / EOSDIS";
const LAYERS: ImageryLayerInfo[] = [
  { id: "BlueMarble_NextGeneration", title: "Blue Marble", period: "static", max_level: 8, format: "jpg", credit: GIBS, source: "gibs" },
  { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", title: "VIIRS NOAA-20 True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS, source: "gibs" },
  { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", title: "VIIRS Suomi NPP True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS, source: "gibs" },
  { id: "MODIS_Terra_CorrectedReflectance_TrueColor", title: "MODIS Terra True Color", period: "daily", max_level: 9, format: "jpg", credit: GIBS, source: "gibs" },
  { id: "Himawari_AHI_Band3_Red_Visible_1km", title: "Himawari-9 Red Visible", period: "10min", max_level: 7, format: "png", credit: `${GIBS}, JMA`, source: "gibs" },
  { id: "Himawari_AHI_Band13_Clean_Infrared", title: "Himawari-9 Clean Infrared", period: "10min", max_level: 6, format: "png", credit: `${GIBS}, JMA`, source: "gibs" },
  { id: "GOES-East_ABI_GeoColor", title: "GOES-East GeoColor", period: "10min", max_level: 7, format: "jpg", credit: `${GIBS}, NOAA`, source: "gibs" },
  { id: "GOES-West_ABI_GeoColor", title: "GOES-West GeoColor", period: "10min", max_level: 7, format: "jpg", credit: `${GIBS}, NOAA`, source: "gibs" },
];
const EOX: ImageryLayerInfo = {
  id: "s2cloudless-2024_3857", title: "Sentinel-2 cloudless 2024", period: "static", max_level: 15, format: "jpg", credit: "EOX", source: "eox",
};
/** ชั้นที่ server ส่ง (GIBS ทั้งแปดแล้ว EOX) */
const SERVER_LAYERS = [...LAYERS, EOX];
const TITLES = LAYERS.map((l) => l.title);
const OSM_TITLE = OSM_LAYER.title;
const SHOWN_BY_DEFAULT = ["Blue Marble", "VIIRS NOAA-20 True Color"];
const NATURAL_EARTH = "Natural Earth II";

const IMAGERY_OFF = { enabled: false, eox: false, osm: false, ion: false };
const SOURCES_OFF = { gibs: false, eox: false, osm: false, ion: false };
const SETTINGS: Settings = {
  daily: { enabled: false, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: "tok-abc",
  online_imagery: IMAGERY_OFF,
};
const SOURCES: { id: ImagerySourceId; field: keyof typeof IMAGERY_OFF; label: LabelKey; consent: MsgKey }[] = [
  { id: "gibs", field: "enabled", label: "field.onlineImagery", consent: "globe.consent" },
  { id: "eox", field: "eox", label: "field.onlineImageryEox", consent: "globe.consentEox" },
  { id: "osm", field: "osm", label: "field.onlineImageryOsm", consent: "globe.consentOsm" },
  { id: "ion", field: "ion", label: "field.onlineImageryIon", consent: "globe.consentIon" },
];
const OTHERS = (id: ImagerySourceId) => SOURCES.filter((s) => s.id !== id);
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
const settle = () => waitFor(() => expect(useImagery.getState().sources.gibs).toBe(true));
const sourceSwitch = (id: ImagerySourceId, hidden = false) =>
  screen.getByRole("checkbox", { name: t(SOURCES.find((s) => s.id === id)!.label), hidden }) as HTMLInputElement;
const groups = () => screen.getAllByRole("region");
const groupOf = (id: ImagerySourceId) => within(groups()[SOURCES.findIndex((s) => s.id === id)]);
const tokenInput = () => screen.getByLabelText(t("field.cesiumToken")) as HTMLInputElement;
const applyToken = () => groupOf("ion").getByRole("button", { name: t("dialog.apply") }) as HTMLButtonElement;
const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const assetIdBox = () => screen.getByRole("textbox", { name: t("field.ionAssetId") }) as HTMLInputElement;
const NONE = t("option.ionAsset.none");
const FIRST_PRESET = ION_PRESETS[0];
const SECOND_PRESET = ION_PRESETS[2];
const shownTitles = () => TITLES.filter((title) => show(title).checked);

async function typeInto(input: HTMLInputElement, text: string) {
  await user.clear(input);
  if (text !== "") await user.type(input, text);
}

beforeEach(() => {
  resetAll();
  useImagery.setState(useImagery.getInitialState(), true);
  useImagery.setState({ loaded: true, layers: SERVER_LAYERS, sources: SOURCES_OFF });
  // ค่าตั้งที่ store ถืออยู่แล้ว (เช่น เปิด Daily Forecast Settings มาก่อน): Globe Manager ไม่ต้องอ่านซ้ำตอนเปิด จึงไม่มีคำขอเองจนกว่าผู้ใช้สั่ง
  useSettings.setState({ settings: SETTINGS });
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setIonFailure(null);
});

describe("the layer list", () => {
  test("has eleven rows: Natural Earth II first, then the eight GIBS layers in the server's order, Sentinel-2 cloudless and OpenStreetMap", () => {
    mount();
    expect(rowTitles()).toEqual([NATURAL_EARTH, ...TITLES, EOX.title, OSM_TITLE]);
    expect(rowTitles()).toHaveLength(11);
  });

  test("each source's rows follow that source's own switch", () => {
    for (const { id, field } of SOURCES.filter((s) => s.id !== "ion")) {
      const own = id === "gibs" ? TITLES : id === "eox" ? [EOX.title] : [OSM_TITLE];
      const rest = [...TITLES, EOX.title, OSM_TITLE].filter((title) => !own.includes(title));
      useImagery.setState({ sources: { ...SOURCES_OFF, [id]: true } });
      const { unmount } = mount();
      for (const title of own) {
        expect(show(title).disabled, `${field}: ${title}`).toBe(false);
        expect(translucency(title).disabled, `${field}: ${title}`).toBe(false);
      }
      for (const title of rest) expect(show(title).disabled, `${field} on: ${title}`).toBe(true);
      unmount();
    }
  });

  test("has the columns Layer, Show and % Translucency in every table (Natural Earth II, GIBS, Sentinel-2 cloudless, OpenStreetMap)", () => {
    mount();
    const head = [t("field.globeLayer"), t("ob.show"), t("field.translucency")];
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([...head, ...head, ...head, ...head]);
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
    useLayout.setState({ globe: { layers: { GOES_nope: { show: true, translucency: 5 }, "GOES-East_ABI_GeoColor": { show: true, translucency: 35 } }, ion: { assetId: null } } });
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
    expect(useImagery.getState().sources.gibs).toBe(false);
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
    // ชั้นของแหล่งอื่น (Sentinel-2 cloudless, OpenStreetMap) อยู่ในค่าตั้งต้นด้วย แต่ไม่มีผลจนกว่าจะเปิดสวิตช์ของแหล่งนั้น
    expect(Object.keys(useLayout.getState().globe.layers).sort()).toEqual(
      ["BlueMarble_NextGeneration", "VIIRS_NOAA20_CorrectedReflectance_TrueColor", "osm", "s2cloudless-2024_3857"].sort(),
    );
  });

  test("a selection the user already saved (e.g. in the workbook) is not overwritten by enabling", async () => {
    server();
    const saved = { layers: { "GOES-West_ABI_GeoColor": { show: true, translucency: 60 } }, ion: { assetId: null } };
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
    expect(useImagery.getState().sources.gibs).toBe(false);
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
  beforeEach(() => useImagery.setState({ sources: { ...SOURCES_OFF, gibs: true } }));

  test("PUTs enabled false at once, with no confirmation, and disables the rows again", async () => {
    const f = server({ [GET_SETTINGS]: { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, enabled: true } } } });
    mount();
    expect(online().checked).toBe(true);
    await user.click(online());
    await waitFor(() => expect(useImagery.getState().sources.gibs).toBe(false));
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
    await waitFor(() => expect(useImagery.getState().sources.gibs).toBe(false));
    expect(useLayout.getState().globe).toBe(before);
    expect(show("GOES-East GeoColor").checked).toBe(true);
    expect(translucency("GOES-East GeoColor").value).toBe("40");
  });
});

describe("Show and % Translucency", () => {
  beforeEach(() => useImagery.setState({ sources: { ...SOURCES_OFF, gibs: true } }));

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

describe("the four source groups", () => {
  test("are NASA GIBS, Sentinel-2 cloudless, OpenStreetMap and Cesium ion, in that order, each with its own switch", () => {
    mount();
    expect(groups().map((g) => g.getAttribute("aria-label"))).toEqual(SOURCES.map((s) => t(s.label)));
    expect(groups()).toHaveLength(4);
    for (const { id } of SOURCES) {
      const own = groupOf(id).getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).getAttribute("aria-label") === null);
      expect(own, id).toHaveLength(1);
      expect(sourceSwitch(id).checked, id).toBe(false);
      expect(sourceSwitch(id).disabled, id).toBe(false);
    }
    expect(t("field.onlineImagery")).toBe("Online imagery (NASA GIBS)");
  });

  test("each group holds only its own rows; Natural Earth II belongs to no group", () => {
    mount();
    const titles = (id: ImagerySourceId) => groupOf(id).queryAllByRole("rowheader").map((r) => r.textContent);
    expect(titles("gibs")).toEqual(TITLES);
    expect(titles("eox")).toEqual([EOX.title]);
    expect(titles("osm")).toEqual([OSM_TITLE]);
    expect(titles("ion")).toEqual([]);
    expect(groups().flatMap((g) => within(g).queryAllByRole("rowheader").map((r) => r.textContent))).not.toContain(NATURAL_EARTH);
  });

  test.each(["eox", "osm", "ion"] as const)("while the %s switch is off its group has a Thai hint, the other groups do not show it", (id) => {
    mount();
    const key = { eox: "globe.offHintEox", osm: "globe.offHintOsm", ion: "globe.offHintIon" }[id] as MsgKey;
    expect(msg(key)).toMatch(/[฀-๿]/);
    expect(groupOf(id).getByText(msg(key))).toBeDefined();
    for (const other of OTHERS(id)) expect(groupOf(other.id).queryByText(msg(key)), `${other.id}`).toBeNull();
  });

  test("OpenStreetMap starts hidden (task 13c): its row is unticked with the switch on, and its group says so in Thai", () => {
    useImagery.setState({ sources: { ...SOURCES_OFF, osm: true } });
    useLayout.setState({ globe: DEFAULT_GLOBE });
    mount();
    expect(show(OSM_TITLE).checked).toBe(false);
    expect(show(OSM_TITLE).disabled).toBe(false); // ติ๊กเองได้ในการใช้งานครั้งนี้
    expect(msg("globe.osmStartsHidden")).toBe("แผนที่ถนนเริ่มแบบซ่อนทุกครั้งที่เปิด");
    expect(groupOf("osm").getByText(msg("globe.osmStartsHidden"))).toBeDefined();
    for (const other of OTHERS("osm")) expect(groupOf(other.id).queryByText(msg("globe.osmStartsHidden")), other.id).toBeNull();
  });

  test("a switch that is on loses its off hint", () => {
    useImagery.setState({ sources: { gibs: true, eox: true, osm: true, ion: true } });
    mount();
    for (const key of ["globe.offHint", "globe.offHintEox", "globe.offHintOsm", "globe.offHintIon"] as const) expect(screen.queryByText(msg(key)), key).toBeNull();
  });
});

describe.each(SOURCES)("turning on $id", ({ id, field, consent }) => {
  const others = OTHERS(id);

  test("opens that source's own Thai confirmation and changes nothing until it is confirmed", async () => {
    const f = server();
    mount();
    await user.click(sourceSwitch(id));
    expect(within(dialog()).getByText(msg(consent))).toBeDefined();
    for (const other of others) expect(within(dialog()).queryByText(msg(other.consent)), other.id).toBeNull();
    expect(sourceSwitch(id, true).checked).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("Cancel and Esc send no request and the switch stays off", async () => {
    const f = server();
    mount();
    await user.click(sourceSwitch(id));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(sourceSwitch(id));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.calls).toEqual([]);
    expect(sourceSwitch(id).checked).toBe(false);
    expect(useImagery.getState().sources[id]).toBe(false);
  });

  test("Confirm makes one PUT of the whole settings document that sets only its own flag, keeping the token and every other flag as the server has them", async () => {
    // อีกสามแหล่งเปิดอยู่ที่ server อยู่แล้ว (แหล่งที่เปิดอยู่ไม่ถูกแตะ) token และ daily คงเดิม
    const server_ = { ...SETTINGS, cesium_ion_token: "tok-xyz", online_imagery: { enabled: true, eox: true, osm: true, ion: true, [field]: false } };
    const f = server({ [GET_SETTINGS]: { json: server_ } });
    useImagery.setState({ sources: { gibs: true, eox: true, osm: true, ion: true, [id]: false } });
    mount();
    await user.click(sourceSwitch(id));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useImagery.getState().sources[id]).toBe(true));
    expect(puts(f)).toHaveLength(1);
    expect(puts(f)[0].body).toEqual({ ...server_, online_imagery: { enabled: true, eox: true, osm: true, ion: true } });
    expect(sourceSwitch(id).checked).toBe(true);
    for (const other of others) expect(useImagery.getState().sources[other.id], other.id).toBe(true);
  });

  test("from all off, turning it on changes no other source's flag", async () => {
    const f = server();
    mount();
    await user.click(sourceSwitch(id));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useImagery.getState().sources[id]).toBe(true));
    expect(puts(f)[0].body).toEqual({ ...SETTINGS, online_imagery: { ...IMAGERY_OFF, [field]: true } });
    expect(useImagery.getState().sources).toEqual({ ...SOURCES_OFF, [id]: true });
    for (const other of others) expect(sourceSwitch(other.id).checked, other.id).toBe(false);
  });

  test("turning it off again PUTs at once with no confirmation", async () => {
    const on = { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, [field]: true } };
    const f = server({ [GET_SETTINGS]: { json: on } });
    useSettings.setState({ settings: on });
    useImagery.setState({ sources: { ...SOURCES_OFF, [id]: true } });
    mount();
    expect(sourceSwitch(id).checked).toBe(true);
    await user.click(sourceSwitch(id));
    await waitFor(() => expect(useImagery.getState().sources[id]).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(puts(f)).toHaveLength(1);
    expect(puts(f)[0].body).toEqual({ ...SETTINGS, online_imagery: IMAGERY_OFF });
  });

  test("when the save fails the switch stays off and the store's Thai warning (naming the source) is the only report", async () => {
    server({ [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    await user.click(sourceSwitch(id));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useMessages.getState().items.filter((m) => m.level === "warning")).toHaveLength(1));
    expect(sourceSwitch(id).checked).toBe(false);
    expect(useImagery.getState().sources[id]).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("while it is being saved no switch can be used (the whole-document saves must not overlap)", async () => {
    const gate = deferred<{ json: unknown }>();
    const f = server({ [PUT]: () => gate.promise });
    mount();
    await user.click(sourceSwitch(id));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    for (const s of SOURCES) expect(sourceSwitch(s.id).disabled, s.id).toBe(true);
    gate.resolve({ json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, [field]: true } } });
    await waitFor(() => expect(useImagery.getState().sources[id]).toBe(true));
    await waitFor(() => expect(sourceSwitch(id).disabled).toBe(false));
    expect(puts(f)).toHaveLength(1);
  });
});

describe("Cesium ion: switching on", () => {
  const confirmOn = async () => {
    await user.click(sourceSwitch("ion"));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useImagery.getState().sources.ion).toBe(true));
  };

  test("with no asset picked it selects the first preset (and only then)", async () => {
    server();
    mount();
    expect(useLayout.getState().globe.ion.assetId).toBeNull();
    await confirmOn();
    await waitFor(() => expect(useLayout.getState().globe.ion.assetId).toBe(FIRST_PRESET.id));
    expect(radio(FIRST_PRESET.title).checked).toBe(true);
    expect(radio(NONE).checked).toBe(false);
  });

  test("an asset the user already picked stays", async () => {
    server();
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: SECOND_PRESET.id } } });
    mount();
    await confirmOn();
    expect(useLayout.getState().globe.ion.assetId).toBe(SECOND_PRESET.id);
  });

  test("a custom Asset ID the user already entered stays", async () => {
    server();
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: 777001 } } });
    mount();
    await confirmOn();
    expect(useLayout.getState().globe.ion.assetId).toBe(777001);
  });

  test("Cancel, and a failed save, leave the asset unselected", async () => {
    server({ [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    await user.click(sourceSwitch("ion"));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useLayout.getState().globe.ion.assetId).toBeNull();
    await user.click(sourceSwitch("ion"));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useMessages.getState().items.filter((m) => m.level === "warning")).toHaveLength(1));
    expect(useLayout.getState().globe.ion.assetId).toBeNull();
  });

  test("turning ion off forgets that ion refused the asset and token, so turning it on again tries again (even with no 3D window open)", async () => {
    const on = { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, ion: true } };
    const f = server({ [GET_SETTINGS]: { json: on } });
    useImagery.setState({ sources: { ...SOURCES_OFF, ion: true } });
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: FIRST_PRESET.id } } });
    setIonFailure({ assetId: FIRST_PRESET.id, token: "tok-abc" });
    mount();
    expect(ionStatus()).toEqual({ kind: "failed", assetId: FIRST_PRESET.id });
    expect(groupOf("ion").getByText(msg("globe.ionRejected"))).toBeDefined();
    await user.click(sourceSwitch("ion"));
    await waitFor(() => expect(useImagery.getState().sources.ion).toBe(false));
    expect(getIonFailure()).toBeNull();
    // เปิดอีกครั้ง (ยืนยัน) : ion ไม่ใช่ "ถูกปฏิเสธ" แล้ว = ลองแสดงใหม่ (shown) และคำอธิบายการปฏิเสธหายไป
    server({ [GET_SETTINGS]: { json: { ...on, online_imagery: IMAGERY_OFF } } });
    await user.click(sourceSwitch("ion"));
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useImagery.getState().sources.ion).toBe(true));
    expect(ionStatus()).toEqual({ kind: "shown", assetId: FIRST_PRESET.id });
    expect(screen.queryByText(msg("globe.ionRejected"))).toBeNull();
    expect(puts(f)).toHaveLength(1);
  });

  test("a failed save of turning ion off keeps the refusal (ion is still on)", async () => {
    const on = { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, ion: true } };
    server({ [GET_SETTINGS]: { json: on }, [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    useImagery.setState({ sources: { ...SOURCES_OFF, ion: true } });
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: FIRST_PRESET.id } } });
    setIonFailure({ assetId: FIRST_PRESET.id, token: "tok-abc" });
    mount();
    await user.click(sourceSwitch("ion"));
    await waitFor(() => expect(useMessages.getState().items.filter((m) => m.level === "warning")).toHaveLength(1));
    expect(useImagery.getState().sources.ion).toBe(true);
    expect(getIonFailure()).toEqual({ assetId: FIRST_PRESET.id, token: "tok-abc" });
  });

  test("turning another source off does not touch the ion refusal", async () => {
    const on = { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, eox: true, ion: true } };
    server({ [GET_SETTINGS]: { json: on } });
    useImagery.setState({ sources: { ...SOURCES_OFF, eox: true, ion: true } });
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: FIRST_PRESET.id } } });
    setIonFailure({ assetId: FIRST_PRESET.id, token: "tok-abc" });
    mount();
    await user.click(sourceSwitch("eox"));
    await waitFor(() => expect(useImagery.getState().sources.eox).toBe(false));
    expect(getIonFailure()).not.toBeNull();
  });

  test("turning ion off keeps the chosen asset for the next time", async () => {
    const on = { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, ion: true } };
    server({ [GET_SETTINGS]: { json: on } });
    useImagery.setState({ sources: { ...SOURCES_OFF, ion: true } });
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: SECOND_PRESET.id } } });
    mount();
    await user.click(sourceSwitch("ion"));
    await waitFor(() => expect(useImagery.getState().sources.ion).toBe(false));
    expect(useLayout.getState().globe.ion.assetId).toBe(SECOND_PRESET.id);
  });
});

describe("Cesium ion: token", () => {
  const SECRET = "tok-abc";

  test("the field is a password field that starts empty; only whether a token is set is shown, never the token", () => {
    mount();
    expect(tokenInput().type).toBe("password");
    expect(tokenInput().value).toBe("");
    expect(tokenInput().autocomplete).toBe("off");
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(groupOf("ion").getByText(msg("globe.ionTokenSet"))).toBeDefined();
  });

  test("with no token saved it says so", () => {
    useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "" } });
    mount();
    expect(groupOf("ion").getByText(msg("globe.ionTokenUnset"))).toBeDefined();
    expect(screen.queryByText(msg("globe.ionTokenSet"))).toBeNull();
  });

  test("a token of spaces only counts as not set", () => {
    useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "   " } });
    mount();
    expect(groupOf("ion").getByText(msg("globe.ionTokenUnset"))).toBeDefined();
  });

  test("Apply is disabled until something is typed, and spaces alone do not enable it", async () => {
    mount();
    expect(applyToken().disabled).toBe(true);
    await user.type(tokenInput(), "   ");
    expect(applyToken().disabled).toBe(true);
    await user.type(tokenInput(), "x");
    expect(applyToken().disabled).toBe(false);
  });

  test("Apply reads the settings, then PUTs the whole document with the new token and every flag as the server has them; the field is emptied", async () => {
    const onServer = { ...SETTINGS, online_imagery: { enabled: true, eox: false, osm: true, ion: false } };
    const f = server({ [GET_SETTINGS]: { json: onServer } });
    mount();
    await user.type(tokenInput(), "  new-token-1 ");
    await user.click(applyToken());
    await waitFor(() => expect(useSettings.getState().settings?.cesium_ion_token).toBe("new-token-1"));
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([GET_SETTINGS, PUT]);
    expect(puts(f)[0].body).toEqual({ ...onServer, cesium_ion_token: "new-token-1" });
    expect(tokenInput().value).toBe("");
    expect(document.body.innerHTML).not.toContain("new-token-1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("Enter in the field applies too", async () => {
    const f = server();
    mount();
    await user.type(tokenInput(), "via-enter{Enter}");
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as Settings).cesium_ion_token).toBe("via-enter");
  });

  test("after the save the switches are taken from the document the server answered, as for a switch (a flag changed elsewhere is not shown stale)", async () => {
    const onServer = { ...SETTINGS, online_imagery: { enabled: false, eox: true, osm: false, ion: false } };
    const f = server({ [GET_SETTINGS]: { json: onServer } });
    mount();
    expect(sourceSwitch("eox").checked).toBe(false);
    await user.type(tokenInput(), "resync");
    await user.click(applyToken());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(puts(f)[0].body).toEqual({ ...onServer, cesium_ion_token: "resync" });
    await waitFor(() => expect(sourceSwitch("eox").checked).toBe(true));
    expect(useImagery.getState().sources).toEqual({ ...SOURCES_OFF, eox: true });
    expect(sourceSwitch("gibs").checked).toBe(false);
  });

  test("a failed token save does not change the switches", async () => {
    server({
      [GET_SETTINGS]: { json: { ...SETTINGS, online_imagery: { ...IMAGERY_OFF, eox: true } } },
      [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } },
    });
    mount();
    await user.type(tokenInput(), "nope");
    await user.click(applyToken());
    await screen.findByRole("alert");
    expect(useImagery.getState().sources).toEqual(SOURCES_OFF);
    expect(sourceSwitch("eox").checked).toBe(false);
  });

  test("saving the token does not turn any source on or off", async () => {
    const f = server();
    mount();
    await user.type(tokenInput(), "t-1");
    await user.click(applyToken());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as Settings).online_imagery).toEqual(IMAGERY_OFF);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the token is never written to the console or the Message Viewer, on success or failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const f = server();
    mount();
    await user.type(tokenInput(), "top-secret-1");
    await user.click(applyToken());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    const gate = server({ [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    await user.type(tokenInput(), "top-secret-2");
    await user.click(applyToken());
    await waitFor(() => expect(gate.calls.some((c) => c.method === "PUT")).toBe(true));
    await screen.findByRole("alert");
    const seen = JSON.stringify([...spies.flatMap((s) => s.mock.calls), useMessages.getState().items]);
    expect(seen).not.toContain("top-secret");
    expect(screen.getByRole("alert").textContent).not.toContain("top-secret");
    // ไม่มีคำขอใดมี token ใน URL (query) : token ไปกับ body ของ PUT /settings เท่านั้น
    for (const c of [...f.calls, ...gate.calls]) expect(c.query.toString()).toBe("");
  });

  test("when the save fails a Thai alert appears, the token is kept in the field to retry, and the stored token is unchanged", async () => {
    server({ [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    await user.type(tokenInput(), "retry-me");
    await user.click(applyToken());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(msg("globe.ionTokenSaveFailed", { message: "พัง" }));
    expect(tokenInput().value).toBe("retry-me");
    expect(useSettings.getState().settings?.cesium_ion_token).toBe(SECRET);
    // พิมพ์ต่อ = ข้อความเตือนหาย
    await user.type(tokenInput(), "2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("while it is being saved Apply and all the switches are disabled", async () => {
    const gate = deferred<{ json: unknown }>();
    const f = server({ [PUT]: () => gate.promise });
    mount();
    await user.type(tokenInput(), "slow");
    await user.click(applyToken());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(applyToken().disabled).toBe(true);
    for (const s of SOURCES) expect(sourceSwitch(s.id).disabled, s.id).toBe(true);
    gate.resolve({ json: { ...SETTINGS, cesium_ion_token: "slow" } });
    await waitFor(() => expect(sourceSwitch("ion").disabled).toBe(false));
  });

  test("a token can be saved while the ion switch is off (it is entered before turning ion on)", async () => {
    const f = server();
    mount();
    expect(sourceSwitch("ion").checked).toBe(false);
    expect(tokenInput().disabled).toBe(false);
    await user.type(tokenInput(), "early");
    await user.click(applyToken());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
  });

  test("when the store has no settings yet it reads them once on open and then shows whether a token is set", async () => {
    useSettings.setState({ settings: null });
    const f = server();
    mount();
    expect(groupOf("ion").getByText(msg("globe.ionTokenUnknown"))).toBeDefined();
    await waitFor(() => expect(groupOf("ion").getByText(msg("globe.ionTokenSet"))).toBeDefined());
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([GET_SETTINGS]);
  });

  test("when that read fails the status says it is unknown, and saving still works through its own read", async () => {
    useSettings.setState({ settings: null });
    let first = true;
    const f = server({
      [GET_SETTINGS]: () => {
        if (first) {
          first = false;
          return { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } };
        }
        return { json: SETTINGS };
      },
    });
    mount();
    await waitFor(() => expect(first).toBe(false));
    expect(groupOf("ion").getByText(msg("globe.ionTokenUnknown"))).toBeDefined();
    await user.type(tokenInput(), "after-fail");
    await user.click(applyToken());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(useSettings.getState().settings?.cesium_ion_token).toBe("after-fail");
  });
});

describe("Cesium ion: asset", () => {
  beforeEach(() => useImagery.setState({ sources: { ...SOURCES_OFF, ion: true } }));
  const assetId = () => useLayout.getState().globe.ion.assetId;
  const customBox = async (text: string) => {
    await typeInto(assetIdBox(), text);
    await user.keyboard("{Enter}");
  };

  test("is a radio group: None, then the presets, then a custom Asset ID", () => {
    mount();
    const names = within(screen.getByRole("radiogroup", { name: t("field.ionAsset") }))
      .getAllByRole("radio")
      .map((r) => r.getAttribute("aria-label") ?? r.closest("label")?.textContent);
    expect(names).toEqual([NONE, ...ION_PRESETS.map((p) => p.title), t("field.ionAssetId")]);
    expect(ION_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  test("shows the layout's asset: None when null, the preset, or Asset ID with the number", () => {
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: null } } });
    const first = mount();
    expect(radio(NONE).checked).toBe(true);
    expect(assetIdBox().value).toBe("");
    first.unmount();
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: SECOND_PRESET.id } } });
    const second = mount();
    expect(radio(SECOND_PRESET.title).checked).toBe(true);
    expect(radio(NONE).checked).toBe(false);
    expect(assetIdBox().value).toBe("");
    second.unmount();
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: 424242 } } });
    mount();
    expect(radio(t("field.ionAssetId")).checked).toBe(true);
    expect(assetIdBox().value).toBe("424242");
    expect(radio(NONE).checked).toBe(false);
  });

  test("choosing a preset or None updates the layout's globe (and nothing else in it)", async () => {
    mount();
    await user.click(radio(SECOND_PRESET.title));
    expect(assetId()).toBe(SECOND_PRESET.id);
    expect(useLayout.getState().globe.layers).toBe(DEFAULT_GLOBE.layers);
    await user.click(radio(FIRST_PRESET.title));
    expect(assetId()).toBe(FIRST_PRESET.id);
    await user.click(radio(NONE));
    expect(assetId()).toBeNull();
  });

  test("a custom Asset ID (integer > 0) is stored on Enter and on leaving the field", async () => {
    mount();
    await customBox("4096");
    expect(assetId()).toBe(4096);
    expect(radio(t("field.ionAssetId")).checked).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    await typeInto(assetIdBox(), " 1234567 ");
    await user.tab();
    expect(assetId()).toBe(1234567);
    expect(assetIdBox().value).toBe("1234567");
  });

  test("typing a preset's Asset ID selects that preset", async () => {
    mount();
    await customBox(String(SECOND_PRESET.id));
    expect(assetId()).toBe(SECOND_PRESET.id);
    expect(radio(SECOND_PRESET.title).checked).toBe(true);
    expect(assetIdBox().value).toBe("");
  });

  test.each(["0", "-5", "1.5", "1e3", "abc", "12 3", "٣", "9007199254740993", "0x10", "+7"])("%j is refused with a Thai alert and nothing is stored", async (bad) => {
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: FIRST_PRESET.id } } });
    const before = useLayout.getState().globe;
    mount();
    await customBox(bad);
    expect(useLayout.getState().globe).toBe(before);
    expect(screen.getByRole("alert").textContent).toBe(msg("globe.ionAssetInvalid"));
    expect(msg("globe.ionAssetInvalid")).toMatch(/[฀-๿]/);
    expect(radio(FIRST_PRESET.title).checked).toBe(true);
  });

  test("an empty box and Escape store nothing and show no alert; fixing a refused entry clears the alert", async () => {
    mount();
    await customBox("0");
    expect(screen.getByRole("alert")).toBeDefined();
    await typeInto(assetIdBox(), "");
    await user.tab();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(assetId()).toBeNull();
    await typeInto(assetIdBox(), "55");
    await user.keyboard("{Escape}");
    expect(assetIdBox().value).toBe("");
    expect(assetId()).toBeNull();
    await customBox("0");
    await customBox("55");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(assetId()).toBe(55);
  });

  test("the Asset ID radio moves focus to the box instead of selecting nothing", async () => {
    mount();
    await user.click(radio(t("field.ionAssetId")));
    expect(document.activeElement).toBe(assetIdBox());
    expect(assetId()).toBeNull();
  });

  test("the radios and the box are disabled while the ion switch is off, the layout's choice is kept", () => {
    useImagery.setState({ sources: SOURCES_OFF });
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: SECOND_PRESET.id } } });
    mount();
    for (const name of [NONE, ...ION_PRESETS.map((p) => p.title), t("field.ionAssetId")]) expect(radio(name).disabled, name).toBe(true);
    expect(assetIdBox().disabled).toBe(true);
    expect(radio(SECOND_PRESET.title).checked).toBe(true);
  });

  test("tells why ion shows nothing: no asset picked, no token, or ion refused the asset and token", async () => {
    const { unmount } = mount();
    expect(groupOf("ion").getByText(msg("globe.ionNoAsset"))).toBeDefined();
    unmount();
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: FIRST_PRESET.id } } });
    useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "" } });
    const second = mount();
    expect(groupOf("ion").getByText(msg("globe.ionNoToken"))).toBeDefined();
    expect(screen.queryByText(msg("globe.ionNoAsset"))).toBeNull();
    second.unmount();
    useSettings.setState({ settings: SETTINGS });
    mount();
    expect(screen.queryByText(msg("globe.ionNoToken"))).toBeNull();
    expect(screen.queryByText(msg("globe.ionRejected"))).toBeNull();
    act(() => {
      setIonFailure({ assetId: FIRST_PRESET.id, token: "tok-abc" });
      notifyIonListeners();
    });
    expect(groupOf("ion").getByText(msg("globe.ionRejected"))).toBeDefined();
  });
});

describe("while Cesium ion is shown", () => {
  const ionShown = () => {
    useImagery.setState({ sources: { ...SOURCES_OFF, ion: true } });
    useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: FIRST_PRESET.id } } });
  };
  const notes = () => screen.queryAllByText(msg("globe.hiddenByIon"));

  test("every row of the other sources (and Natural Earth II) says it is hidden because Cesium ion is on", () => {
    expect(msg("globe.hiddenByIon")).toBe("ถูกซ่อนเพราะเปิด Cesium ion อยู่");
    ionShown();
    mount();
    expect(notes()).toHaveLength(11);
    for (const id of ["gibs", "eox", "osm"] as const) {
      const rows = groupOf(id).getAllByRole("rowheader");
      for (const row of rows) expect(row.textContent, id).toContain(msg("globe.hiddenByIon"));
    }
    expect(groupOf("ion").queryByText(msg("globe.hiddenByIon"))).toBeNull();
    // ค่า Show / % Translucency ยังแก้ได้และคงไว้ (กลับมาแสดงเมื่อปิด ion)
    expect(show("Blue Marble").checked).toBe(true);
  });

  test.each([
    ["the ion switch is off", () => useImagery.setState({ sources: SOURCES_OFF })],
    ["no asset is picked", () => useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: null } } })],
    ["there is no token", () => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "" } })],
    ["the token is spaces", () => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "  " } })],
  ])("no note when %s (ion is not shown, so the other layers are)", (_name, change) => {
    ionShown();
    change();
    mount();
    expect(notes()).toHaveLength(0);
  });

  test("the notes follow the stores live: they go away when ion is turned off and come back when it is on", async () => {
    ionShown();
    mount();
    expect(notes()).toHaveLength(11);
    act(() => useImagery.setState({ sources: SOURCES_OFF }));
    expect(notes()).toHaveLength(0);
    act(() => useImagery.setState({ sources: { ...SOURCES_OFF, ion: true } }));
    expect(notes()).toHaveLength(11);
    act(() => useLayout.getState().setGlobeIon(null));
    expect(notes()).toHaveLength(0);
  });

  test("when ion refuses the asset and token the other layers come back, so the notes go away", () => {
    ionShown();
    mount();
    expect(notes()).toHaveLength(11);
    act(() => {
      setIonFailure({ assetId: FIRST_PRESET.id, token: "tok-abc" });
      notifyIonListeners();
    });
    expect(notes()).toHaveLength(0);
  });
});

describe("when the layer list could not be read", () => {
  test("the online part is shown as unavailable with a Thai message, every switch is disabled and only Natural Earth II remains", () => {
    useImagery.setState({ loaded: false, layers: [], sources: SOURCES_OFF });
    mount();
    expect(screen.getByText(msg("globe.unavailable"))).toBeDefined();
    expect(msg("globe.unavailable")).toMatch(/[฀-๿]/);
    for (const { id } of SOURCES) expect(sourceSwitch(id).disabled, id).toBe(true);
    expect(online().disabled).toBe(true);
    expect(rowTitles()).toEqual([NATURAL_EARTH]);
    for (const key of ["globe.offHint", "globe.offHintEox", "globe.offHintOsm", "globe.offHintIon"] as const) expect(screen.queryByText(msg(key)), key).toBeNull();
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
