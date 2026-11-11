import { describe, expect, it } from "vitest";
import {
  EARTH_RADIUS_KM,
  footprintRings,
  fromXY,
  GRID_LATITUDES,
  gridLongitudes,
  labelPos,
  lonToX,
  nightPolygon,
  projectLine,
  terminatorDue,
  toXY,
} from "./mapGeom";

const W = 1024;
const H = 512;

/** Ray casting with x = longitude and y = latitude (the polygons of this module live on that plane). */
function inside(poly: [number, number][], lat: number, lon: number): boolean {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) in_ = !in_;
  }
  return in_;
}

const lons = (ring: [number, number][]) => ring.map((p) => p[1]);
const lats = (ring: [number, number][]) => ring.map((p) => p[0]);

describe("toXY", () => {
  it("puts the centre longitude on the horizontal middle and the equator on the vertical middle", () => {
    expect(toXY(0, 0, W, H, 0)).toEqual([512, 256]);
    expect(toXY(0, 75, W, H, 75)[0]).toBe(512);
    expect(toXY(0, -120, W, H, -120)[0]).toBe(512);
  });

  it("puts centre + 180 on an edge of the map", () => {
    for (const center of [0, 75, -120, 180]) {
      const x = toXY(0, center + 180, W, H, center)[0];
      expect([0, W]).toContain(x);
    }
  });

  it("maps the corners with centre longitude 0", () => {
    expect(toXY(90, -180, W, H, 0)).toEqual([0, 0]);
    expect(toXY(-90, 180, W, H, 0)).toEqual([W, H]);
    expect(toXY(45, -90, W, H, 0)).toEqual([256, 128]);
  });

  it("shifts the map with the centre longitude: the left edge is centre - 180", () => {
    expect(toXY(0, -90, W, H, 90)[0]).toBe(0); // 90 - 180
    expect(toXY(0, 0, W, H, 90)[0]).toBe(256);
    expect(toXY(0, 180, W, H, 90)[0]).toBe(768);
    // east of the seam: 100 degrees east of the centre 90 is -170 as written
    expect(toXY(0, -170, W, H, 90)[0]).toBeCloseTo(((100 + 180) / 360) * W, 9);
  });

  it("treats longitudes that differ by 360 as the same place", () => {
    expect(toXY(10, 270, W, H, 0)).toEqual(toXY(10, -90, W, H, 0));
    expect(toXY(10, -450, W, H, 30)[0]).toBeCloseTo(toXY(10, -90, W, H, 30)[0], 9);
  });
});

describe("fromXY", () => {
  it("is the inverse of toXY", () => {
    for (const center of [0, 75, -120]) {
      const [x, y] = toXY(-33, 120, W, H, center);
      const [lat, lon] = fromXY(x, y, W, H, center);
      expect(lat).toBeCloseTo(-33, 9);
      expect(lon).toBeCloseTo(120, 9);
    }
  });

  it("gives longitudes in -180..180 whatever the centre", () => {
    const [, lon] = fromXY(W - 1, 0, W, H, 150); // far right of a map centred at 150: 150 + ~180 = 330 -> -30
    expect(lon).toBeGreaterThanOrEqual(-180);
    expect(lon).toBeLessThanOrEqual(180);
    expect(lon).toBeCloseTo(-30, 0);
  });
});

describe("lonToX", () => {
  it("is not wrapped: a longitude outside the window lands outside the map", () => {
    expect(lonToX(0, W, 0)).toBe(512);
    expect(lonToX(-360, W, 0)).toBe(-512);
    expect(lonToX(360, W, 0)).toBe(1536);
  });
});

describe("footprintRings", () => {
  it("(0, 0) 4000 km is one closed ring around the point, radius 2000 km", () => {
    const rings = footprintRings(0, 0, 4000);
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring.length).toBeGreaterThan(60);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    const radiusDeg = (2000 / EARTH_RADIUS_KM) * (180 / Math.PI); // 17.97
    expect(Math.max(...lats(ring))).toBeCloseTo(radiusDeg, 1);
    expect(Math.min(...lats(ring))).toBeCloseTo(-radiusDeg, 1);
    expect(Math.max(...lons(ring))).toBeCloseTo(radiusDeg, 1);
    expect(Math.min(...lons(ring))).toBeCloseTo(-radiusDeg, 1);
    expect(inside(ring, 0, 0)).toBe(true);
    expect(inside(ring, 0, 30)).toBe(false);
  });

  it("(85, 0) 4000 km covers the north pole: the ring has the top edge of the map", () => {
    const rings = footprintRings(85, 0, 4000);
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(Math.max(...lats(ring))).toBe(90);
    expect(Math.min(...lons(ring))).toBe(-180);
    expect(Math.max(...lons(ring))).toBe(180);
    // the cap reaches latitude 85 - 17.97 = 67.03 on the side facing the equator (at longitude 0), 90 - (17.97 - 5) beyond the pole
    expect(inside(ring, 89, 0)).toBe(true);
    expect(inside(ring, 89, 179)).toBe(true); // 180 itself is the edge of the polygon
    expect(inside(ring, 80, 0)).toBe(true);
    expect(inside(ring, 60, 0)).toBe(false);
    expect(inside(ring, 60, 179)).toBe(false);
    // on the far side of the pole the cap reaches latitude 90 - (17.97 - 5) = 77.03
    expect(inside(ring, 75, 179)).toBe(false);
    expect(inside(ring, 80, 179)).toBe(true);
  });

  it("(-85, 90) 4000 km covers the south pole: the ring has the bottom edge of the map", () => {
    const rings = footprintRings(-85, 90, 4000);
    expect(rings).toHaveLength(1);
    expect(Math.min(...lats(rings[0]!))).toBe(-90);
    expect(inside(rings[0]!, -89, 0)).toBe(true);
    expect(inside(rings[0]!, -60, 0)).toBe(false);
  });

  it("(0, 179) 4000 km is split into two rings, one on each side of the 180 degree line", () => {
    const rings = footprintRings(0, 179, 4000);
    expect(rings).toHaveLength(2);
    const east = rings.find((r) => Math.min(...lons(r)) > 0)!;
    const west = rings.find((r) => Math.max(...lons(r)) < 0)!;
    expect(east).toBeDefined();
    expect(west).toBeDefined();
    expect(Math.max(...lons(east))).toBe(180);
    expect(Math.min(...lons(west))).toBe(-180);
    expect(Math.min(...lons(east))).toBeCloseTo(179 - 17.97, 1);
    expect(Math.max(...lons(west))).toBeCloseTo(179 + 17.97 - 360, 1);
    for (const r of rings) expect(r[0]).toEqual(r[r.length - 1]);
    expect(inside(east, 0, 179)).toBe(true);
    expect(inside(west, 0, -179)).toBe(true);
  });

  it("splits where the map's own edge is, not at 180, when the map is centred elsewhere", () => {
    // centred at 180 the window is 0..360: a footprint at (0, 179) is whole, one at (0, 0) is cut at the seam (longitude 0)
    const whole = footprintRings(0, 179, 4000, 180);
    expect(whole).toHaveLength(1);
    expect(Math.min(...lons(whole[0]!))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lons(whole[0]!))).toBeLessThanOrEqual(360);
    const cut = footprintRings(0, 0, 4000, 180);
    expect(cut).toHaveLength(2);
    // every ring point lies inside the window 0..360 (the west part is written as 360 - something)
    for (const r of cut) {
      expect(Math.min(...lons(r))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...lons(r))).toBeLessThanOrEqual(360);
    }
    const [x0, x1] = [Math.min(...cut.flatMap((r) => lons(r))), Math.max(...cut.flatMap((r) => lons(r)))];
    expect([x0, x1]).toEqual([0, 360]);
  });

  it("projects every ring point inside the picture for any centre longitude", () => {
    for (const center of [-180, -90, 0, 33, 180]) {
      for (const [lat, lon] of [[0, 0], [60, 170], [-30, -175], [88, 20], [0, 180]] as const) {
        for (const ring of footprintRings(lat, lon, 6000, center)) {
          for (const [la, lo] of ring) {
            const [x, y] = toXY(la, lo, W, H, center);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(W);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(H);
          }
        }
      }
    }
  });

  it("a GEO-sized footprint (diameter 18107 km, over the equator) stays one ring", () => {
    const rings = footprintRings(0, 0, 18107);
    expect(rings).toHaveLength(1);
    expect(Math.max(...lats(rings[0]!))).toBeCloseTo((9053.5 / EARTH_RADIUS_KM) * (180 / Math.PI), 1);
  });

  it("gives nothing for a footprint that is not a positive number", () => {
    expect(footprintRings(0, 0, 0)).toEqual([]);
    expect(footprintRings(0, 0, -5)).toEqual([]);
    expect(footprintRings(0, 0, Number.NaN)).toEqual([]);
  });
});

describe("nightPolygon", () => {
  it("(sun at 0, 0): the point (0, 180) is inside and the point (0, 0) is not", () => {
    const night = nightPolygon(0, 0);
    expect(inside(night, 0, 180)).toBe(true);
    expect(inside(night, 0, -180)).toBe(true);
    expect(inside(night, 0, 0)).toBe(false);
    expect(inside(night, 60, 0)).toBe(false);
    expect(inside(night, -60, 0)).toBe(false);
    expect(inside(night, 60, 170)).toBe(true);
  });

  it("covers longitudes -360..360 so that a map centred anywhere has its night side", () => {
    const night = nightPolygon(10, 30);
    expect(Math.min(...lons(night))).toBe(-360);
    expect(Math.max(...lons(night))).toBe(360);
    // the same place one turn east or west is night, too
    expect(inside(night, 0, 30 + 180)).toBe(true);
    expect(inside(night, 0, 30 + 180 - 360)).toBe(true);
    expect(inside(night, 0, 30)).toBe(false);
    expect(inside(night, 0, 30 - 360)).toBe(false);
  });

  it("northern summer (sun at 23.4 N, 0): night holds the south pole, the north pole is in daylight", () => {
    const night = nightPolygon(23.4, 0);
    expect(inside(night, -80, 0)).toBe(true); // south of -66.6 at the sun's meridian
    expect(inside(night, -50, 0)).toBe(false);
    expect(inside(night, 80, 180)).toBe(false); // midnight sun
    expect(inside(night, 50, 180)).toBe(true);
    expect(inside(night, 80, 90)).toBe(false); // the terminator at lon +-90 is on the equator, the pole side is day
  });

  it("northern winter (sun at 23.4 S, 0): night holds the north pole", () => {
    const night = nightPolygon(-23.4, 0);
    expect(inside(night, 80, 0)).toBe(true);
    expect(inside(night, 50, 0)).toBe(false);
    expect(inside(night, -80, 180)).toBe(false);
  });

  it("the terminator itself is 90 degrees from the sun", () => {
    const sun = { lat: 20, lon: -40 };
    const night = nightPolygon(sun.lat, sun.lon);
    // all points but the two that close the polygon on the pole line are on the terminator
    for (const [la, lo] of night.slice(0, -2)) {
      const r = Math.PI / 180;
      const cosD = Math.sin(la * r) * Math.sin(sun.lat * r) + Math.cos(la * r) * Math.cos(sun.lat * r) * Math.cos((lo - sun.lon) * r);
      expect(Math.abs(cosD)).toBeLessThan(1e-9);
    }
    // the two closing points are on the south pole line (the sun is north of the equator)
    expect(night.slice(-2).map((p) => p[0])).toEqual([-90, -90]);
  });
});

describe("projectLine", () => {
  it("projects [lat, lon] points and keeps one polyline when there is no jump", () => {
    const lines = projectLine([[0, 0], [10, 10], [20, 20]], W, H, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(3);
    expect(lines[0]![0]).toEqual(toXY(0, 0, W, H, 0));
  });

  it("starts a new polyline where the line crosses the edge of the map (the server only splits at 180)", () => {
    // map centred at 90: its edge is at -90 / 270; a track going west to east across longitude -90
    const lines = projectLine([[0, -80], [1, -85], [2, -95], [3, -100]], W, H, 90);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(2);
    expect(lines[1]).toHaveLength(2);
  });

  it("drops lines with fewer than two points and gives nothing for no line", () => {
    expect(projectLine([[0, 0]], W, H, 0)).toEqual([]);
    expect(projectLine([], W, H, 0)).toEqual([]);
  });
});

describe("labelPos", () => {
  const [tw, th] = [60, 14];

  it("normally puts the label below the marker, centred on it", () => {
    const p = labelPos(500, 200, tw, th, W, H);
    expect(p.x).toBe(500 - tw / 2);
    expect(p.y).toBeGreaterThanOrEqual(200 + 3); // under the marker (half size 3)
    expect(p.y).toBeLessThan(200 + 3 + 6);
  });

  it("near the left edge moves the label to the right side of the marker", () => {
    const p = labelPos(10, 200, tw, th, W, H);
    expect(p.x).toBeGreaterThan(10 + 3);
    expect(p.x).toBeLessThan(10 + 3 + 6);
    expect(p.y).toBeLessThan(200); // beside the marker: vertically around it
    expect(p.y + th).toBeGreaterThan(200);
  });

  it("near the right edge moves the label to the left side of the marker", () => {
    const p = labelPos(W - 10, 200, tw, th, W, H);
    expect(p.x + tw).toBeLessThan(W - 10 - 3 + 1);
    expect(p.x + tw).toBeGreaterThan(W - 10 - 3 - 6);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });

  it("near the bottom edge moves the label above the marker", () => {
    const p = labelPos(500, H - 5, tw, th, W, H);
    expect(p.x).toBe(500 - tw / 2);
    expect(p.y + th).toBeLessThanOrEqual(H - 5 - 3);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it("keeps a label that fits just fitting where it is", () => {
    // 30 px from each edge the label centred below still fits
    expect(labelPos(30, 100, tw, th, W, H).x).toBe(0);
    expect(labelPos(W - 30, 100, tw, th, W, H).x).toBe(W - 60);
    expect(labelPos(500, H - 3 - 2 - th, tw, th, W, H).y).toBeGreaterThan(H - 3 - 2 - th);
  });

  it("in the bottom-left corner the label is beside the marker and stays inside the map", () => {
    const p = labelPos(8, H - 4, tw, th, W, H);
    expect(p.x).toBeGreaterThan(8);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y + th).toBeLessThanOrEqual(H);
  });
});

describe("grid", () => {
  it("has 5 horizontal lines every 30 degrees", () => {
    expect(GRID_LATITUDES).toEqual([-60, -30, 0, 30, 60]);
  });

  it("has 11 vertical lines every 30 degrees when the map is centred on 0", () => {
    expect(gridLongitudes(0)).toEqual([-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]);
  });

  it("follows the centre longitude: lines of the meridians in the window", () => {
    expect(gridLongitudes(90)).toEqual([-60, -30, 0, 30, 60, 90, 120, 150, 180, 210, 240]);
    // a window that is not a multiple of 30 away has a line at each end
    expect(gridLongitudes(15)).toEqual([-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180]);
  });
});

describe("terminatorDue", () => {
  const t0 = Date.parse("2026-11-12T07:00:00Z");

  it("is due at once when there is none yet", () => {
    expect(terminatorDue(null, t0)).toBe(true);
  });

  it("is due when module time has moved 15 s or more, either way, and not before", () => {
    expect(terminatorDue(t0, t0 + 14_999)).toBe(false);
    expect(terminatorDue(t0, t0 + 15_000)).toBe(true);
    expect(terminatorDue(t0, t0 - 14_999)).toBe(false);
    expect(terminatorDue(t0, t0 - 15_000)).toBe(true);
    expect(terminatorDue(t0, t0 + 3 * 86_400_000)).toBe(true);
  });
});
