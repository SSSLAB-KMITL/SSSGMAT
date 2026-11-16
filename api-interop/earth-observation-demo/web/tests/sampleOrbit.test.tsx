import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import SampleOrbit from "../src/SampleOrbit";
import { Studio, useStudio } from "../src/state";

vi.mock("../src/Globe", () => ({ default: () => {
  const s = useStudio();
  return <div data-testid="sample-globe">{s.selected?.platform} · {s.detail.geometry.samples[0]?.lat ?? "no satellite"} · {s.detail.preview.preview.url}</div>;
} }));
const solution = (time = "2025-02-14T04:02:16Z", lat = 12.6, basis = "image_metadata") => ({
  time_basis: basis, estimated: true, norad_id: 40115, tle_age_hours: 5.6,
  tle_epoch_utc: "2025-02-13T22:26:11Z", source_url: "https://satchecker.cps.iau.org/",
  position: { lat, lon: 97.9, altitude_m: 611000, time },
  geometry: { samples: [{ lat }], estimated: true },
});
const row = (id = "bangkok-wv03", dayOnly = false) => ({
  id, platform: dayOnly ? "WorldView-2" : "WorldView-3", title: id,
  acquired_utc: dayOnly ? "2019-08-31" : "2025-02-14T04:02:16Z",
  date_precision: dayOnly ? "day" : "second", lat: 13.8, lon: 100.5,
  orbit_solution: dayOnly ? { position: null } : solution(),
  product: { views: { area: { url: `/${id}-area.png`, bbox: [100, 13, 101, 14] } } },
} as any);
const wrap = (r: any) => <Studio.Provider value={{ selected: { platform: "UMBRA" }, detail: { geometry: { samples: [{ lat: 99 }] } } } as any}>
  <SampleOrbit key={r.id} row={r} />
</Studio.Provider>;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps free sample platform, coordinates and RGB together; date-only sample has no invented position", async () => {
  const { rerender } = render(wrap(row()));
  expect(screen.getByTestId("sample-satellite-lat").textContent).toBe("12.600000°");
  await waitFor(() => expect(screen.getByTestId("sample-globe").textContent).toContain("WorldView-3 · 12.6 · /bangkok-wv03-area.png"));
  rerender(wrap(row("rotterdam-wv2", true)));
  expect(screen.queryByTestId("sample-satellite-lat")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("sample-globe").textContent).toContain("WorldView-2 · no satellite · /rotterdam-wv2-area.png"));
});

it("calculates selected UTC in this free page and ignores a stale response after sample switch", async () => {
  let finish: (v: any) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const { rerender } = render(wrap(row("rotterdam-wv2", true)));
  fireEvent.change(screen.getByLabelText("Sample orbit UTC time"), { target: { value: "12:00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "คำนวณพิกัดดาวเทียม" }));
  expect(fetch).toHaveBeenCalledWith("/api/eo/samples/rotterdam-wv2/orbit?at_utc=2019-08-31T12%3A00%3A00Z", undefined);
  finish({ ok: true, json: async () => solution("2019-08-31T12:00:00Z", 51, "selected_time") });
  await screen.findByText("เวลาที่เลือก · ยังไม่ยืนยันว่าเป็นเวลาถ่ายภาพ");
  expect(screen.getByTestId("sample-satellite-lat").textContent).toBe("51.000000°");
  fireEvent.change(screen.getByLabelText("Sample orbit UTC time"), { target: { value: "13:00:00" } });
  expect(screen.queryByTestId("sample-satellite-lat")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "คำนวณพิกัดดาวเทียม" }));
  rerender(wrap(row()));
  finish({ ok: true, json: async () => solution("2019-08-31T13:00:00Z", -40, "selected_time") });
  await waitFor(() => expect(screen.getByTestId("sample-satellite-lat").textContent).toBe("12.600000°"));
});
