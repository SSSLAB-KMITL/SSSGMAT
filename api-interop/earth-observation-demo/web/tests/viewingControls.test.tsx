import React, { useState } from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Studio } from "../src/state";
import ViewingControls from "../src/ViewingControls";
import type { GroundTarget } from "../src/viewingGeometry";

afterEach(() => cleanup());
it("sets a coordinate, updates the sight graphic and hides below-horizon rays without processing imagery", () => {
  const run = vi.fn();
  function Harness() {
    const [groundTarget, setGroundTarget] = useState<GroundTarget | null>(null);
    const [sample, setSample] = useState(0);
    const state: any = {
      groundTarget,
      setGroundTarget,
      sample,
      setSample,
      run,
      imageMode: "grayscale",
      site: { lon: 0, lat: 0 },
      selected: {
        id: "a",
        platform: "TestSat",
        footprint: {
          coordinates: [
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
              [-1, -1],
            ],
          ],
        },
      },
      detail: {
        id: "a",
        preview: { roi: { lon: 0, lat: 0 } },
        geometry: {
          duration_s: 1,
          samples: [
            {
              ecef_m: [6878137, 0, 0],
              altitude_m: 500000,
              time: "2025-01-01T00:00:00Z",
              t_s: 0,
            },
            {
              ecef_m: [6878137, 10000, 0],
              altitude_m: 500000,
              time: "2025-01-01T00:00:01Z",
              t_s: 1,
            },
          ],
        },
      },
    };
    return (
      <Studio.Provider value={state}>
        <ViewingControls
          onFocus={vi.fn()}
          onPick={vi.fn()}
          picking={false}
          showBeam={true}
          setShowBeam={vi.fn()}
        />
      </Studio.Provider>
    );
  }
  render(<Harness />);
  expect(screen.getByText("จุดอยู่ในขอบเขตภาพ")).toBeTruthy();
  expect(screen.getByTestId("look-diagram-ray")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Viewing target latitude"), {
    target: { value: ".1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "แสดงพิกัด" }));
  expect(screen.getByText(/Lat 0.100000°/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Viewing collect time"), {
    target: { value: "1" },
  });
  expect(screen.getByText(/00:00:01 UTC/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Viewing target latitude"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Viewing target longitude"), {
    target: { value: "180" },
  });
  fireEvent.click(screen.getByRole("button", { name: "แสดงพิกัด" }));
  expect(screen.getByText("จุดอยู่นอกขอบเขตภาพ")).toBeTruthy();
  expect(screen.queryByTestId("look-diagram-ray")).toBeNull();
  expect(run).not.toHaveBeenCalled();
});
