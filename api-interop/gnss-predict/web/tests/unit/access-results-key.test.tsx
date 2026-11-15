// กุญแจการดึงช่วงเวลา access มีที่เดียว: accessResultsKey (src/windows/TimelineView/rows.ts) ใช้ทั้ง Timeline (useAccessIntervals)
// และ highlight ของหน้าต่าง 2D (HighlightIntervals) จับการเรียกด้วย vi.mock ที่ห่อตัวจริงไว้

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HighlightIntervals } from "../../src/cesium/accessHighlight";
import type { ResultsInfo } from "../../src/stores/results";
import { useResults } from "../../src/stores/results";
import * as rows from "../../src/windows/TimelineView/rows";
import { useAccessIntervals } from "../../src/windows/TimelineView/useIntervals";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";

vi.mock("../../src/windows/TimelineView/rows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/windows/TimelineView/rows")>();
  return { ...actual, accessResultsKey: vi.fn(actual.accessResultsKey) };
});

const ROUTE = "GET /api/scenarios/S1/access/intervals";
const access = {
  from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true, time_period: { mode: "object" },
  graphics: { show: true, static_highlight: true, animate_highlight: false, animate_line: true, color_mode: "object", custom_color: null, inherit: false },
};
const doc = makeDoc({
  name: "S1",
  objects: [
    { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
    { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01"] },
    { class: "Satellite", name: "G01", norad: 40101 },
  ] as never,
  accesses: [access] as never,
});
const info = { ephem: { status: "current", hash: "e1", available: [] }, access: { THBK: { status: "current", hash: "t1", available: [] } }, error: null } as ResultsInfo;

describe("accessResultsKey is the one key rule of both callers", () => {
  beforeEach(() => {
    resetAll();
    vi.mocked(rows.accessResultsKey).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  test("HighlightIntervals.sync builds its key with accessResultsKey", async () => {
    stubFetch({ [ROUTE]: { json: { G01: [] } } });
    const source = new HighlightIntervals(() => undefined);
    source.sync("S1", doc, info);
    await source.idle();
    source.dispose();
    expect(rows.accessResultsKey).toHaveBeenCalledWith([access], info);
  });

  test("useAccessIntervals builds its key with accessResultsKey", async () => {
    const stub = stubFetch({ [ROUTE]: { json: { G01: [] } } });
    openScenario(doc);
    useResults.setState({ info });
    renderHook(() => useAccessIntervals());
    await waitFor(() => expect(stub.count(ROUTE)).toBe(1));
    expect(rows.accessResultsKey).toHaveBeenCalledWith([access], info);
  });
});
