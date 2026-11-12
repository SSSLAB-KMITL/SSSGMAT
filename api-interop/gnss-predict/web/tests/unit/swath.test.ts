// Swath แบบ Ground Elevation ของหน้าต่าง 2D (src/cesium/swath.ts) และพื้นที่วงบนทรงกลมแบบเป็นแถบตามลองจิจูด (src/cesium/lonlat.ts)
// ค่าที่คาดเป็นสูตรปิด: มุมศูนย์กลางของวงรอยเท้า θ = acos(Re·cos ε / (Re + h)) − ε (ตัวเลขของบรีฟงาน 12 ตามตัว)

import { describe, expect, test } from "vitest";
import { capColumns, columnsMesh, type Column } from "../../src/cesium/lonlat";
import { EARTH_RADIUS_KM, footprintCentralAngleRad, footprintRing } from "../../src/cesium/swath";

const RAD = Math.PI / 180;

/** มุมระหว่างสองจุดบนทรงกลม (เรเดียน) จากเวกเตอร์หนึ่งหน่วย: atan2(|a×b|, a·b) แม่นทุกช่วงมุม */
function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const v = (lat: number, lon: number) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const [a, b] = [v(lat1, lon1), v(lat2, lon2)];
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(cross[0], cross[1], cross[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

test("GNSS footprint at 10° ground elevation", () => {
  expect(footprintCentralAngleRad(20200, 10) * 180 / Math.PI).toBeCloseTo(66.341744, 5);
  expect(EARTH_RADIUS_KM * footprintCentralAngleRad(20200, 10)).toBeCloseTo(7376.876, 2);
  expect(footprintCentralAngleRad(35786, 10) * 180 / Math.PI).toBeCloseTo(71.440883, 5);
  expect(footprintCentralAngleRad(20200, 0) * 180 / Math.PI).toBeCloseTo(76.126861, 5);
});

test("footprint ring points lie at the central angle", () => {
  // ทุกจุดของ footprintRing(13.729779, 100.781151, 20200, 10) ห่างจากศูนย์กลางตามวงกลมใหญ่ = มุมข้างบนภายใน 1e-9 rad และมี 72 จุด
  const ring = footprintRing(13.729779, 100.781151, 20200, 10);
  expect(ring).toHaveLength(72);
  const angle = footprintCentralAngleRad(20200, 10);
  for (const [lon, lat] of ring) expect(Math.abs(greatCircle(13.729779, 100.781151, lat, lon) - angle)).toBeLessThan(1e-9);
});

describe("footprintRing", () => {
  test("starts due north of the centre and keeps longitudes in [-180, 180)", () => {
    const ring = footprintRing(0, 170, 20200, 10, 8);
    expect(ring).toHaveLength(8);
    expect(ring[0][0]).toBeCloseTo(170, 9);
    expect(ring[0][1]).toBeCloseTo(66.341744, 5);
    for (const [lon] of ring) expect(lon >= -180 && lon < 180).toBe(true);
    expect(ring.some(([lon]) => lon < 0)).toBe(true); // วงข้ามเส้น 180° ไปฝั่งตะวันตก
  });

  test("a footprint that contains the pole goes all the way round in longitude", () => {
    const ring = footprintRing(55, 20, 20200, 10);
    let turned = 0;
    for (let i = 0; i < ring.length; i++) {
      let d = ring[(i + 1) % ring.length][0] - ring[i][0];
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      turned += d;
    }
    expect(Math.abs(Math.abs(turned) - 360)).toBeLessThan(1e-9);
  });
});

describe("capColumns: the cap as one latitude interval per longitude", () => {
  const each = (cols: Column[]) => cols.filter((c): c is Column & { lo: number; hi: number } => c.lo !== null && c.hi !== null);

  test("every interval end lies on the circle, longitudes cover [-180, 180] in order", () => {
    const rho = footprintCentralAngleRad(20200, 10);
    const cols = capColumns(13.729779, 100.781151, rho, 2);
    expect(cols[0].lon).toBe(-180);
    expect(cols.at(-1)!.lon).toBe(180);
    for (let i = 1; i < cols.length; i++) expect(cols[i].lon).toBeGreaterThan(cols[i - 1].lon);
    const inside = each(cols);
    expect(inside.length).toBeGreaterThan(50);
    for (const c of inside) {
      for (const lat of [c.lo, c.hi]) {
        if (Math.abs(lat) === 90) continue;
        expect(Math.abs(greatCircle(13.729779, 100.781151, lat, c.lon) - rho)).toBeLessThan(1e-9);
      }
      expect(c.lo).toBeLessThanOrEqual(c.hi);
    }
  });

  test("the east and west tips are columns of their own (one point on the circle)", () => {
    const rho = 30 * RAD;
    const cols = capColumns(0, 0, rho, 8); // ±30 ไม่ตรงกับจุดของตาราง (−180 + 8k)
    const tips = each(cols).filter((c) => Math.abs(c.hi - c.lo) < 1e-4);
    expect(tips.map((c) => c.lon).sort((a, b) => a - b)).toEqual([expect.closeTo(-30, 9), expect.closeTo(30, 9)]);
    // นอกปลายทั้งสองไม่มีช่วง
    for (const c of cols) if (Math.abs(c.lon) > 30 + 1e-9) expect(c.lo).toBeNull();
  });

  test("a cap containing the north pole reaches 90° in every column", () => {
    const cols = capColumns(55, 20, footprintCentralAngleRad(20200, 10), 2);
    for (const c of cols) {
      expect(c.hi).toBe(90);
      expect(c.lo!).toBeGreaterThan(-90);
    }
    // ฝั่งตรงข้าม (ลองจิจูด 200° = -160°) ขอบล่างคือ 90 − (ρ − (90 − 55))
    const far = cols.find((c) => c.lon === -160)!;
    expect(far.lo).toBeCloseTo(90 - (66.341744 - 35), 5);
  });

  test("a cap across the antimeridian has columns at both ends of the map and none in between", () => {
    const cols = capColumns(0, 180, 20 * RAD, 2);
    expect(cols.find((c) => c.lon === 178)?.lo).not.toBeNull();
    expect(cols.find((c) => c.lon === -178)?.lo).not.toBeNull();
    expect(cols.find((c) => c.lon === 0)?.lo).toBeNull();
  });

  test("a hemisphere (90°) around the antisolar point is half the map at the equator", () => {
    const cols = capColumns(0, 180, Math.PI / 2, 2);
    expect(cols.find((c) => c.lon === 120)).toMatchObject({ lo: -90, hi: 90 });
    expect(cols.find((c) => c.lon === 60)?.lo).toBeNull();
  });
});

describe("columnsMesh", () => {
  test("two triangles between neighbouring columns that both have an interval, never across a gap", () => {
    const cols: Column[] = [
      { lon: -180, lo: 0, hi: 10 },
      { lon: -178, lo: 1, hi: 9 },
      { lon: -176, lo: null, hi: null },
      { lon: 178, lo: 2, hi: 8 },
      { lon: 180, lo: 0, hi: 10 },
    ];
    const mesh = columnsMesh(cols);
    expect(mesh.indices.length / 3).toBe(4);
    // ทุกสามเหลี่ยมกว้างไม่เกินระยะห่างของคอลัมน์ (ไม่มีสามเหลี่ยมพาดข้ามแผนที่)
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const lons = [0, 1, 2].map((k) => mesh.lonLat[mesh.indices[i + k]][0]);
      expect(Math.max(...lons) - Math.min(...lons)).toBeLessThanOrEqual(2);
    }
  });

  test("an empty or single column gives nothing to draw", () => {
    expect(columnsMesh([]).indices).toEqual([]);
    expect(columnsMesh([{ lon: 0, lo: 0, hi: 1 }]).indices).toEqual([]);
  });
});
