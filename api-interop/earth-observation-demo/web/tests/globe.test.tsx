import React, { useState } from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import type { GroundTarget } from "../src/viewingGeometry";
import { Cartographic } from "cesium";

const captures = vi.hoisted(() => ({
  layers: [] as any[],
  imageRequests: vi.fn(),
  viewer: null as any,
}));
vi.mock("cesium", async () => {
  const c: any = await vi.importActual("cesium");
  class FakeViewer {
    dataSources = {
      add: (layer: any) => {
        captures.layers.push(layer);
        return Promise.resolve(layer);
      },
    };
    imageryLayers = {
      length: 1,
      get: vi.fn(),
      remove: vi.fn(),
      addImageryProvider: vi.fn(),
    };
    scene = {
      backgroundColor: null,
      globe: { baseColor: null, ellipsoid: c.Ellipsoid.WGS84 },
      requestRender: vi.fn(),
    };
    camera = {
      lookAt: vi.fn(),
      lookAtTransform: vi.fn(),
      flyToBoundingSphere: vi.fn(),
      flyTo: vi.fn(),
      pickEllipsoid: vi.fn(),
    };
    clock: any = {};
    canvas = document.createElement("canvas");
    destroyed = false;
    constructor() {
      captures.viewer = this;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    ...c,
    Viewer: FakeViewer,
    ImageryLayer: { fromProviderAsync: () => ({}) },
    TileMapServiceImageryProvider: { fromUrl: () => Promise.resolve({}) },
    SingleTileImageryProvider: {
      fromUrl: captures.imageRequests.mockResolvedValue({}),
    },
    ScreenSpaceEventHandler: class {
      setInputAction() {}
      destroy() {}
    },
  };
});
import Globe from "../src/Globe";
import { Studio } from "../src/state";
afterEach(() => {
  cleanup();
  captures.layers = [];
  captures.imageRequests.mockClear();
});

it("connects the provider satellite position to image corners and the selected coordinate without reloading imagery on time changes", async () => {
  const positions = [
    [6878137, 0, 0],
    [6878137, 10000, 0],
  ];
  function Harness() {
    const [groundTarget, setGroundTarget] = useState<GroundTarget | null>(null),
      [sample, setSample] = useState(0);
    // Keep the acquisition object stable while only time/ground selection changes.
    const [detail] = useState({
      id: "a",
      preview: {
        generated_utc: "2025",
        roi: { lon: 0, lat: 0, width_m: 250 },
        preview: { bbox: [-0.1, -0.1, 0.1, 0.1], url: "/actual-sar.png" },
      },
      geometry: {
        duration_s: 1,
        samples: positions.map((ecef_m, i) => ({
          ecef_m,
          lon: 0,
          lat: 0,
          altitude_m: 500000,
          time: `2025-01-01T00:00:0${i}Z`,
          t_s: i,
        })),
      },
    });
    const s: any = {
      groundTarget,
      setGroundTarget,
      sample,
      setSample,
      detail,
      imageMode: "grayscale",
      site: { lat: 0, lon: 0 },
      selected: {
        id: "a",
        platform: "TestSat",
        footprint: {
          coordinates: [
            [
              [-0.1, -0.1],
              [0.1, -0.1],
              [0.1, 0.1],
              [-0.1, 0.1],
              [-0.1, -0.1],
            ],
          ],
        },
      },
    };
    return (
      <Studio.Provider value={s}>
        <Globe />
      </Studio.Provider>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(captures.imageRequests).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", {name: "ดูโลกทั้งใบ"}));
  const camera = captures.viewer.camera.flyTo.mock.calls[0][0];
  expect(Cartographic.fromCartesian(camera.destination).height).toBeCloseTo(20000000, 3);
  expect(camera.orientation.pitch).toBe(-Math.PI/2);
  const entities = captures.layers[1].entities;
  let satellite = entities.getById("satellite-position").position.getValue();
  expect([satellite.x, satellite.y, satellite.z]).toEqual(positions[0]);
  expect(
    entities.values.filter((e: any) => e.id.startsWith("coverage-face-")),
  ).toHaveLength(4);
  const ray = entities.getById("selected-ground-line-of-sight").polyline;
  const end = ray.positions.getValue()[1];
  expect([end.x, end.y, end.z]).toEqual([6378137, 0, 0]);
  expect(ray.arcType.getValue()).toBe(0);
  fireEvent.change(screen.getByLabelText("Viewing collect time"), {
    target: { value: "1" },
  });
  satellite = entities.getById("satellite-position").position.getValue();
  expect([satellite.x, satellite.y, satellite.z]).toEqual(positions[1]);
  expect(captures.imageRequests).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Viewing target longitude"), {
    target: { value: "180" },
  });
  fireEvent.click(screen.getByRole("button", { name: "แสดงพิกัด" }));
  expect(entities.getById("selected-ground-line-of-sight")).toBeUndefined();
  expect(captures.imageRequests).toHaveBeenCalledTimes(1);
});
