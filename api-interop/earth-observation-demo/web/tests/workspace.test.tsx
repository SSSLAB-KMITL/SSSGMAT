import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import axe from "axe-core";
vi.mock("../src/Globe", () => ({ default: () => <div>Geometry canvas</div> }));
import { App, AppBoundary } from "../src/main";

const sites = [
  {
    id: "suvarnabhumi",
    name: "Suvarnabhumi",
    timezone: "Asia/Bangkok",
    lon: 100.75,
    lat: 13.69,
  },
  {
    id: "rotterdam",
    name: "Rotterdam",
    timezone: "Europe/Amsterdam",
    lon: 4.28,
    lat: 51.88,
  },
  {
    id: "singapore",
    name: "Singapore",
    timezone: "Asia/Singapore",
    lon: 103.83,
    lat: 1.26,
  },
];
const scenes = sites.map((s, i) => ({
  id: "scene-" + i,
  site_id: s.id,
  platform: "Umbra-08",
  center_utc: "2025-02-04T15:30:56Z",
  incidence_deg: 35,
  polarization: "VV",
  duration_s: 10,
  range_resolution_m: 0.35,
  products: ["GEC", "SICD"],
  ready: true,
  footprint: { coordinates: [] },
  stac_url: "https://example.test/stac",
}));
const detail = (id: string) => ({
  ...scenes.find((s) => s.id === id),
  geometry: null,
  preview: {
    generated_utc: "2026-11-15T00:00:00Z",
    source_dtype: "uint8",
    source_shape: [32000, 32000],
    preview: { url: "/scene.png", bbox: [100.7, 13.6, 100.8, 13.7] },
    roi: {
      url: "/roi.png",
      lon: 100.75,
      lat: 13.65,
      width_m: 250,
      pixel_m: 0.25,
      size: 1000,
      bbox: [100.74, 13.64, 100.76, 13.66],
    },
  },
  detections: null,
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options: any) => {
      const path = String(url);
      let result: any = {};
      if (path.endsWith("/catalog")) result = { sites, scenes };
      else if (path.includes("/scenes/"))
        result = detail(path.split("/scenes/")[1]);
      else if (path.endsWith("/summary"))
        result = {
          sites: sites.map((s) => ({
            ...s,
            total: 1,
            prepared: 0,
            first_utc: scenes[0].center_utc,
            last_utc: scenes[0].center_utc,
            incidence_range: [30, 40],
            samples: [],
          })),
          note: "Research baseline",
        };
      else if (path.endsWith("/jobs"))
        result = options?.method === "POST" ? { id: "job-1" } : [];
      return {
        ok: true,
        json: async () => result,
        text: async () => JSON.stringify(result),
      };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Scrollable EO workspace", () => {
  it("mounts all panels and shows loaded real-image metadata without crashing", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByText(
      "uint8 GEC display intensity · uncalibrated · 32000 × 32000 source pixels",
    );
    expect(screen.queryByText(/Workspace error:/)).toBeNull();
    expect(screen.getByText("Acquisition Catalog")).toBeTruthy();
    expect(screen.getByText("3D Geometry View")).toBeTruthy();
    expect(screen.getByText("Geometry canvas")).toBeTruthy();
  });
  it("switches the selected site and requests that sites acquisition", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByText(
      "uint8 GEC display intensity · uncalibrated · 32000 × 32000 source pixels",
    );
    fireEvent.click(screen.getByRole("button", { name: /Rotterdam/ }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/eo/scenes/scene-1", undefined),
    );
    expect(screen.queryByText(/Workspace error:/)).toBeNull();
  });
  it("opens three-site summary and can return to a site", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByRole("button", { name: "ภาพรวม 3 พื้นที่" });
    fireEvent.click(screen.getByRole("button", { name: "ภาพรวม 3 พื้นที่" }));
    await screen.findByText("Three sites, one observation workspace");
    fireEvent.click(screen.getByRole("button", { name: "Open Singapore" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/eo/scenes/scene-2", undefined),
    );
  });
  it("submits a bounded ROI job using the selected acquisition", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByText(
      "uint8 GEC display intensity · uncalibrated · 32000 × 32000 source pixels",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply ROI" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/eo/jobs",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"scene_id":"scene-0"'),
        }),
      ),
    );
  });
  it("switches SAR palette without starting a new analysis job", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByText(
      "uint8 GEC display intensity · uncalibrated · 32000 × 32000 source pixels",
    );
    fireEvent.change(screen.getByLabelText("Image style"), {
      target: { value: "viridis" },
    });
    const image = document.querySelector(
      'svg[aria-label="SAR image with overlays"] image',
    );
    expect(image?.getAttribute("href")).toContain("palette=viridis&v=");
    expect(screen.getByText(/สีแทนความสว่าง/)).toBeTruthy();
    expect(
      (fetch as any).mock.calls.filter(
        (call: any) => call[0].endsWith("/jobs") && call[1]?.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("requests a dated optical product and shows pending state rather than old SAR", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByText(
      "uint8 GEC display intensity · uncalibrated · 32000 × 32000 source pixels",
    );
    fireEvent.change(screen.getByLabelText("Image style"), {
      target: { value: "optical" },
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/eo/jobs",
        expect.objectContaining({
          body: expect.stringContaining('"kind":"optical"'),
        }),
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Sentinel-2 natural color" }),
    ).toBeTruthy();
    expect(
      document.querySelector('svg[aria-label="SAR image with overlays"]'),
    ).toBeNull();
  });
  it("explains unavailable CSI and lets the user choose a CSI acquisition", async () => {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByText(
      "uint8 GEC display intensity · uncalibrated · 32000 × 32000 source pixels",
    );
    fireEvent.change(screen.getByLabelText("Image style"), {
      target: { value: "csi" },
    });
    expect(screen.getByLabelText("CSI acquisition")).toBeTruthy();
    expect(
      (fetch as any).mock.calls.filter(
        (call: any) => call[0].endsWith("/jobs") && call[1]?.method === "POST",
      ),
    ).toHaveLength(0);
  });
});

it("shows satellite coordinates only for the selected acquisition while the next detail loads", async () => {
  const baseFetch = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options: any) => {
      const path = String(url);
      if (path.endsWith("/scenes/scene-0")) {
        return {
          ok: true,
          json: async () => ({
            ...detail("scene-0"),
            geometry: {
              samples: [
                {
                  time: "2025-02-04T15:30:56Z",
                  t_s: 0,
                  lat: 12.345678,
                  lon: 103.456789,
                  altitude_m: 500000,
                  slant_range_m: 600000,
                  azimuth_deg: 90,
                  elevation_deg: 60,
                  ecef_m: [1, 2, 3],
                },
              ],
            },
          }),
        };
      }
      if (path.endsWith("/scenes/scene-1")) return new Promise(() => {});
      return baseFetch(url, options);
    }),
  );
  render(
    <AppBoundary>
      <App />
    </AppBoundary>,
  );
  await screen.findByText("12.345678°");
  expect(screen.getByText("103.456789°")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Rotterdam/ }));
  await waitFor(() => expect(screen.queryByText("12.345678°")).toBeNull());
});

it("opens the dedicated Satellite to Ground page and preserves it when switching sites", async () => {
  window.history.replaceState(null, "", "/?view=geometry");
  try {
    render(
      <AppBoundary>
        <App />
      </AppBoundary>,
    );
    await screen.findByRole("heading", {
      name: "Satellite → Ground / 3D Geometry",
    });
    expect(screen.queryByRole("heading", { name: "2D Image View" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Rotterdam/ }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/eo/scenes/scene-1", undefined),
    );
    expect(
      screen.getByRole("heading", { name: "Satellite → Ground / 3D Geometry" }),
    ).toBeTruthy();
  } finally {
    window.history.replaceState(null, "", "/");
  }
});

it("exposes standard landmarks and closes the tools menu with Escape and restores focus", async () => {
  document.documentElement.lang = "th";
  render(
    <AppBoundary>
      <App />
    </AppBoundary>,
  );
  await screen.findByRole("heading", {
    level: 1,
    name: "Suvarnabhumi observations",
  });
  expect(
    screen.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "ข้ามไปเนื้อหาหลัก" })
      .getAttribute("href"),
  ).toBe("#main-content");
  const menu = document.querySelector<HTMLDetailsElement>(".workspace-tools")!;
  menu.open = true;
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector("summary"));
  // JSDOM cannot measure rendered color contrast; palette contrast and real
  // responsive layout are checked separately, not suppressed as passed here.
  const result = await axe.run(document, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.html),
    })),
  ).toEqual([]);
});

it("navigates between workspace and free samples without SAR controls leaking into the optical page", async () => {
  document.documentElement.lang = "th";
  const fallback = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options: any) => {
      if (String(url).endsWith("/samples"))
        return { ok: true, json: async () => ({ samples: [] }) };
      return fallback(url, options);
    }),
  );
  render(
    <AppBoundary>
      <App />
    </AppBoundary>,
  );
  await screen.findByRole("heading", { name: "2D Image View" });
  fireEvent.click(screen.getByRole("button", { name: "ภาพสีละเอียดสูง" }));
  await screen.findByRole("heading", {
    level: 1,
    name: "ภาพสีดาวเทียมละเอียดสูง",
  });
  expect(
    screen
      .getByRole("button", { name: "ภาพสีละเอียดสูง" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.queryByRole("region", { name: "Observation area" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Imagery actions" })).toBeNull();
  expect(window.location.search).toBe("?view=samples");
  expect(document.title).toContain("ภาพสีละเอียดสูง");
  const result = await axe.run(document, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "ดูภาพดาวเทียม" }));
  await screen.findByRole("heading", { name: "2D Image View" });
  expect(screen.getByRole("region", { name: "Observation area" })).toBeTruthy();
  expect(window.location.search).toBe("");
});
