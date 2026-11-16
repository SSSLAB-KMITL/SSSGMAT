import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DetectionToolbar,
  DetectionOverlay,
  DetectionResults,
  useOpticalDetection,
} from "../src/OpticalDetection";

function result(id = "a", view = "detail") {
  return {
    sample_id: id,
    view,
    model: {
      name: "YOLO11s-OBB",
      source_url: "https://docs.ultralytics.com/models/yolo11/",
    },
    generated_utc: "2026-11-16T00:00:00Z",
    note: "ผลโมเดลยังไม่ตรวจยืนยัน",
    supported_classes: [],
    image: {
      width: 100,
      height: 100,
      width_m: 250,
      acquired_utc: "2025-03-26T04:22:44Z",
    },
    objects: [
      {
        id: 1,
        class_name: "plane",
        label: "เครื่องบิน",
        score: 0.9,
        polygon_px: [
          [10, 10],
          [30, 10],
          [30, 30],
          [10, 30],
        ],
        center_px: [20, 20],
        ground_point: { lat: 21, lon: 96 },
      },
      {
        id: 2,
        class_name: "small vehicle",
        label: "รถขนาดเล็ก",
        score: 0.15,
        polygon_px: [
          [40, 40],
          [50, 40],
          [50, 50],
          [40, 50],
        ],
        center_px: [45, 45],
        ground_point: { lat: 21.1, lon: 96.1 },
      },
    ],
  };
}
function Harness({ id = "a", view = "detail" }) {
  const d = useOpticalDetection(id, view, "version");
  return (
    <main>
      <DetectionToolbar d={d} ready />
      <DetectionOverlay d={d} />
      <DetectionResults d={d} />
    </main>
  );
}
const reply = (value: any) => ({ ok: true, json: async () => value });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("filters model predictions, toggles the aligned SVG and highlights the selected object", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply({ result: result(), job: null })),
  );
  const { container } = render(<Harness />);
  await screen.findByRole("region", { name: "Optical detection results" });
  expect(container.querySelectorAll(".detection-overlay polygon")).toHaveLength(
    1,
  );
  fireEvent.change(screen.getByLabelText("Detection score threshold"), {
    target: { value: ".10" },
  });
  expect(container.querySelectorAll(".detection-overlay polygon")).toHaveLength(
    2,
  );
  fireEvent.click(screen.getByRole("button", { name: "รถขนาดเล็ก 1" }));
  expect(container.querySelectorAll(".detection-overlay polygon")).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: /วัตถุ #2 รถขนาดเล็ก/ }));
  expect(
    container
      .querySelector(".detection-overlay polygon")
      ?.getAttribute("stroke-width"),
  ).toBe("4");
  fireEvent.click(screen.getByRole("checkbox", { name: "แสดงกรอบวัตถุ" }));
  expect(container.querySelector(".detection-overlay")).toBeNull();
  expect(
    screen.getByRole("link", { name: "ผลตรวจจับ JSON" }).getAttribute("href"),
  ).toContain("/a/files/detections-detail.json");
});

it("never shows stale boxes when image or crop changes while an old request is pending", async () => {
  let finish: (value: any) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((url: any) =>
      String(url).includes("/a/")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(reply({ result: result("b", "close"), job: null })),
    ),
  );
  const { rerender, container } = render(<Harness />);
  rerender(<Harness id="b" view="close" />);
  await screen.findByRole("link", { name: "ผลตรวจจับ JSON" });
  finish(reply({ result: result(), job: null }));
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "ผลตรวจจับ JSON" }).getAttribute("href"),
    ).toContain("/b/files/detections-close.json"),
  );
  expect(container.querySelectorAll(".detection-overlay polygon")).toHaveLength(
    1,
  );
});

it("queues a cancellable worker for the displayed crop without using the SAR detector", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options: any) => {
      if (String(url).endsWith("/detect"))
        return reply({
          id: "job-1",
          state: "queued",
          message: "Queued",
          progress: 0,
        });
      if (String(url).endsWith("/cancel"))
        return reply({ id: "job-1", state: "cancelled" });
      return reply({ result: null, job: null });
    }),
  );
  render(<Harness id="a" view="area" />);
  fireEvent.click(screen.getByRole("button", { name: "ตรวจจับวัตถุในภาพ" }));
  await screen.findByRole("button", { name: "ยกเลิก" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/eo/samples/a/detect",
    expect.objectContaining({ method: "POST", body: '{"view":"area"}' }),
  );
  fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "ยกเลิก" })).toBeNull(),
  );
  expect(
    (fetch as any).mock.calls.some(
      (c: any) => String(c[0]) === "/api/eo/jobs" && c[1]?.method === "POST",
    ),
  ).toBe(false);
});
