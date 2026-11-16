// สถานะของชั้น Cesium ion (src/cesium/ionState.ts): "shown" = สวิตช์ ion เปิด + มี asset + มี token และ ion ยังไม่ปฏิเสธ asset + token นี้
// ไฟล์นี้ไม่ import cesium (Globe Manager ใช้ใน bundle หลัก) ; imageryLayers.ts ยัง re-export ionStatus / onIonStatusChange ให้ผู้เรียกเดิม

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as layers from "../../src/cesium/imageryLayers";
import { getIonFailure, ionStatus, notifyIonListeners, onIonStatusChange, setIonFailure } from "../../src/cesium/ionState";
import { DEFAULT_GLOBE } from "../../src/layout/workbook";
import { useImagery } from "../../src/stores/imagery";
import { useLayout } from "../../src/stores/layout";
import { useSettings, type Settings } from "../../src/stores/settings";

const SETTINGS: Settings = {
  daily: { enabled: false, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: " tok-1 ",
  online_imagery: { enabled: false, eox: false, osm: false, ion: false },
};
const ASSET = 3830182;

function setup(over: { ion?: boolean; assetId?: number | null; settings?: Settings | null } = {}): void {
  useImagery.setState({ sources: { gibs: false, eox: false, osm: false, ion: over.ion ?? true } });
  useLayout.setState({ globe: { ...DEFAULT_GLOBE, ion: { assetId: over.assetId === undefined ? ASSET : over.assetId } } });
  useSettings.setState({ settings: over.settings === undefined ? SETTINGS : over.settings });
}

beforeEach(() => setIonFailure(null));
afterEach(() => setIonFailure(null));

describe("ionStatus", () => {
  test("off when the switch is off or no asset is picked", () => {
    setup({ ion: false });
    expect(ionStatus()).toEqual({ kind: "off" });
    setup({ assetId: null });
    expect(ionStatus()).toEqual({ kind: "off" });
  });

  test("waiting until the settings (and so the token) have been read", () => {
    setup({ settings: null });
    expect(ionStatus()).toEqual({ kind: "waiting" });
  });

  test("noToken when the token is empty or only spaces", () => {
    setup({ settings: { ...SETTINGS, cesium_ion_token: "" } });
    expect(ionStatus()).toEqual({ kind: "noToken", assetId: ASSET });
    setup({ settings: { ...SETTINGS, cesium_ion_token: "   " } });
    expect(ionStatus()).toEqual({ kind: "noToken", assetId: ASSET });
  });

  test("shown with a token, and the status never carries the token", () => {
    setup();
    expect(ionStatus()).toEqual({ kind: "shown", assetId: ASSET });
    expect(JSON.stringify(ionStatus())).not.toContain("tok-1");
  });

  test("failed only for the asset and (trimmed) token that ion refused; another asset or token is tried again", () => {
    setup();
    setIonFailure({ assetId: ASSET, token: "tok-1" });
    expect(ionStatus()).toEqual({ kind: "failed", assetId: ASSET });
    useLayout.getState().setGlobeIon(3830183);
    expect(ionStatus()).toEqual({ kind: "shown", assetId: 3830183 });
    useLayout.getState().setGlobeIon(ASSET);
    useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "tok-2" } });
    expect(ionStatus()).toEqual({ kind: "shown", assetId: ASSET });
    setIonFailure(null);
    expect(getIonFailure()).toBeNull();
  });

  test("a layout with no ion field (older workbook) is off", () => {
    setup();
    useLayout.setState({ globe: { layers: {} } as never });
    expect(ionStatus()).toEqual({ kind: "off" });
  });
});

describe("a refusal is forgotten as soon as the ion plan changes, with no viewer attached", () => {
  test.each([
    ["switch off", () => useImagery.setState({ sources: { gibs: false, eox: false, osm: false, ion: false } })],
    ["None", () => useLayout.getState().setGlobeIon(null)],
    ["another asset", () => useLayout.getState().setGlobeIon(3830183)],
    ["another token", () => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "tok-2" } })],
  ])("%s clears it and tells the listeners; going back to the same asset and token is shown (a real new attempt)", (_name, change) => {
    setup();
    setIonFailure({ assetId: ASSET, token: "tok-1" });
    expect(ionStatus()).toEqual({ kind: "failed", assetId: ASSET });
    const listener = vi.fn();
    const off = onIonStatusChange(listener);
    change();
    expect(getIonFailure()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setup();
    expect(ionStatus()).toEqual({ kind: "shown", assetId: ASSET });
  });

  test("a store change that keeps the plan (another source switch, the same token read again) keeps it", () => {
    setup();
    setIonFailure({ assetId: ASSET, token: "tok-1" });
    useImagery.setState({ sources: { gibs: true, eox: false, osm: false, ion: true } });
    useSettings.setState({ settings: { ...SETTINGS } });
    useLayout.setState((s) => ({ globe: { ...s.globe, layers: { osm: { show: true, translucency: 0 } } } }));
    expect(ionStatus()).toEqual({ kind: "failed", assetId: ASSET });
  });
});

describe("onIonStatusChange", () => {
  test("listeners are told by notifyIonListeners until they unsubscribe", () => {
    const listener = vi.fn();
    const off = onIonStatusChange(listener);
    notifyIonListeners();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    notifyIonListeners();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// import แบบ static (โหลด Cesium ตอนเก็บ test ไม่ใช่ในเวลาของ test: dynamic import เคยเกิน 5 วินาทีเมื่อเครื่องหนัก)
test("imageryLayers.ts re-exports the same functions", () => {
  expect(layers.ionStatus).toBe(ionStatus);
  expect(layers.onIonStatusChange).toBe(onIonStatusChange);
});
