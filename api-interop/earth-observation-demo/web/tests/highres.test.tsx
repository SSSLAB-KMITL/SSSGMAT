import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import HighResolution from "../src/HighResolution";
import { Studio } from "../src/state";
import axe from "axe-core";

vi.mock("../src/Globe", () => ({ default: () => <div>Sample globe</div> }));

const fixture = (id: string, platform: string, gsd: number, date: string) => ({
  id,
  title: id,
  description: "รายละเอียดพื้นที่ " + id,
  platform,
  gsd_m: gsd,
  acquired_utc: date,
  date_precision: date.length === 10 ? "day" : "second",
  license: "CC BY-SA 4.0",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  license_note: "อ้างอิง SpaceNet Partners",
  attribution: "Maxar / SpaceNet",
  source_url: "https://spacenet-dataset.s3.amazonaws.com/example.tif",
  source_page: "https://spacenet.ai/las-vegas/",
  lon: 4,
  lat: 51,
  ready: true,
  product: {
    generated_utc: "2026-11-15",
    views: Object.fromEntries(
      [
        ["area", 500],
        ["detail", 250],
        ["close", 100],
      ].map(([key, width]) => [
        key,
        {
          url: `/${id}-${key}.png`,
          width_m: width,
          size: 500,
          grid_m: 0.5,
          valid_fraction: 1,
        },
      ]),
    ),
  },
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("switches the actual high resolution sample, date and exported image together", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        samples: [
          fixture("vegas", "WorldView-3", 0.3, "2015-10-22T18:36:56Z"),
          fixture("rotterdam", "WorldView-2", 0.5, "2019-08-31"),
        ],
      }),
    })),
  );
  render(
    <Studio.Provider value={{ setView: vi.fn() } as any}>
      <HighResolution />
    </Studio.Provider>,
  );
  await screen.findByRole("button", { name: "Open sample vegas" });
  expect(
    screen
      .getByRole("img", { name: /WorldView-3 vegas, 250 m wide/ })
      .getAttribute("src"),
  ).toContain("/vegas-detail.png");
  fireEvent.click(screen.getByRole("button", { name: "ดูระยะใกล้ 100 ม." }));
  expect(
    screen.getByRole("link", { name: "บันทึกภาพ" }).getAttribute("href"),
  ).toBe("/vegas-close.png");
  fireEvent.click(
    screen.getByRole("button", { name: "Open sample rotterdam" }),
  );
  expect(
    screen
      .getByRole("img", { name: /WorldView-2 rotterdam, 100 m wide/ })
      .getAttribute("src"),
  ).toContain("/rotterdam-close.png");
  expect(screen.getByText("2019-08-31 · ไม่ระบุเวลาถ่าย")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "ข้อมูลภาพและสิทธิ์ใช้" })
      .getAttribute("href"),
  ).toContain("/rotterdam/");
  expect(
    (fetch as any).mock.calls.every(
      (c: any) => !String(c[0]).endsWith("/jobs"),
    ),
  ).toBe(true);
  const result = await axe.run(
    screen.getByRole("region", {
      name: "High-resolution satellite coordinates",
    }),
    { rules: { "color-contrast": { enabled: false } } },
  );
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.html),
    })),
  ).toEqual([]);
});
it("returns to the satellite workspace", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        samples: [fixture("vegas", "WorldView-3", 0.3, "2015-10-22T18:36:56Z")],
      }),
    })),
  );
  const setView = vi.fn();
  render(
    <Studio.Provider value={{ setView } as any}>
      <HighResolution />
    </Studio.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "กลับไปดูภาพเรดาร์" }));
  expect(setView).toHaveBeenCalledWith("overview");
});

it("recovers from a failed sample catalog request without reloading the whole app", async () => {
  const load = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ result: null, job: null }),
    })
    .mockResolvedValueOnce({
      ok: false,
      text: async () => "Temporary sample error",
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        samples: [fixture("vegas", "WorldView-3", 0.3, "2015-10-22T18:36:56Z")],
      }),
    });
  vi.stubGlobal("fetch", load);
  render(
    <Studio.Provider value={{ setView: vi.fn() } as any}>
      <HighResolution />
    </Studio.Provider>,
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "ลองโหลดอีกครั้ง" }));
  await screen.findByRole("button", { name: "Open sample vegas" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    load.mock.calls.filter((c) => c[0] === "/api/eo/samples"),
  ).toHaveLength(2);
});
