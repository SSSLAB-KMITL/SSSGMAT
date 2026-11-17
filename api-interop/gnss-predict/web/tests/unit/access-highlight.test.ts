// Static Highlight และ Animate Highlight ของ Access ในหน้าต่าง 2D (spec §4, src/cesium/accessHighlight.ts)
// entity จริงของ Cesium ใน jsdom (CzmlDataSource ที่ process CZML ในหน่วยความจำ ไม่วาดภาพ ไม่ต่อเครือข่าย) ส่วนตัวดึงช่วงเวลาใช้ fetch ปลอม

import {
  Cartesian3, CallbackProperty, Cartographic, ColorMaterialProperty, ConstantProperty, CzmlDataSource, Entity, EntityCollection, JulianDate, Math as CMath,
  ReferenceFrame, SampledPositionProperty,
} from "cesium";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import {
  applyAccessHighlights, highlightOptions, highlightTimes, HighlightIntervals, STATIC_HIGHLIGHT_WIDTH,
} from "../../src/cesium/accessHighlight";
import type { ApplyCtx, ColorTokens } from "../../src/cesium/graphics";
import type { ResultsInfo } from "../../src/stores/results";
import type { ScenarioDoc } from "../../src/stores/scenario";
import { accessKey, type IntervalsByAccess } from "../../src/windows/TimelineView/rows";
import { makeDoc } from "./helpers/chrome";
import { deferred, stubFetch } from "./helpers/fake-fetch";

const TOKENS: ColorTokens = {
  gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b",
};
const T0S = Date.UTC(2026, 10, 11) / 1000;
const T0 = "2026-11-11T00:00:00Z";
const HOUR = 3600;
const iso = (sec: number): string => new Date(sec * 1000).toISOString();
const R = 26_560_000;
const prnByNorad = new Map([[62339, "G01"], [40128, "E05"], [37868, "R07"]]);
const FIXED = ReferenceFrame.FIXED;
type Entities = EntityCollection;

/** ดาววงกลมรัศมี R ตัวอย่างทุก 300 s หนึ่งวัน ตามรูปของ scene.czml (ไม่ข้ามเส้น 180° ในชั่วโมงแรก) */
function satPacket(prn: string, phase = 0): object {
  const cartesian: number[] = [];
  for (let s = 0; s <= 86_400; s += 300) {
    const a = phase + (2 * Math.PI * s) / 43_078;
    cartesian.push(s, R * Math.cos(a), R * Math.sin(a) * 0.5, R * Math.sin(a) * 0.866);
  }
  return {
    id: `sat/${prn}`,
    availability: `${T0}/2026-11-12T00:00:00Z`,
    position: { epoch: T0, cartesian, referenceFrame: "FIXED", interpolationAlgorithm: "LAGRANGE", interpolationDegree: 7 },
  };
}
const DOCUMENT = { id: "document", version: "1.0", clock: { interval: `${T0}/2026-11-12T00:00:00Z`, currentTime: T0 } };

const fac = (name: string): ScenarioDoc["objects"][number] =>
  ({ class: "Facility", name, position: { type: "Geodetic", lat_deg: 13.73, lon_deg: 100.78, alt_m: 6.4 } }) as never;
const sat = (name: string, norad: number, over: object = {}): ScenarioDoc["objects"][number] => ({ class: "Satellite", name, norad, ...over }) as never;
const con = (name: string, members: string[]): ScenarioDoc["objects"][number] =>
  ({ class: "Constellation", name, system: "G", assigned_objects: members.map((m) => `*/Satellite/${m}`) }) as never;

const access = (over: object = {}, graphics: object | null = {}) =>
  ({
    from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true, time_period: { mode: "object" },
    graphics: graphics === null ? null : { show: true, static_highlight: true, animate_highlight: true, animate_line: true, color_mode: "object", custom_color: null, inherit: false, ...graphics },
    ...over,
  }) as never;

const docOf = (accesses: object[], objects?: ScenarioDoc["objects"]): ScenarioDoc =>
  makeDoc({
    name: "S1",
    objects: objects ?? [fac("THBK"), con("GPS", ["G01", "E05"]), sat("G01", 62339), sat("E05", 40128)],
    accesses: accesses as never,
  });

const ctx: ApplyCtx = { mode: "2d", prnByNorad, isHidden: () => false, tokens: TOKENS };

/** คำตอบของ access: ดาว → ช่วง (วินาทีนับจาก epoch) */
const reply = (bySat: Record<string, [number, number][]>): IntervalsByAccess[string] => ({
  status: "ok",
  bySat: Object.fromEntries(Object.entries(bySat).map(([name, list]) => [name, list.map(([a, b]) => ({ start: iso(a), stop: iso(b), duration_s: b - a, max_el_deg: 30 }))])),
});
const repliesFor = (a: object, bySat: Record<string, [number, number][]>): IntervalsByAccess => ({ [accessKey(a as never)]: reply(bySat) });

async function entitiesOf(): Promise<Entities> {
  const ds = await CzmlDataSource.load([DOCUMENT, satPacket("G01"), satPacket("E05", 1)]);
  return ds.entities;
}
const at = (sec: number): JulianDate => JulianDate.fromDate(new Date(sec * 1000));
const byId = (entities: Entities, id: string): Entity => {
  const e = entities.getById(id);
  if (e === undefined) throw new Error(`no entity ${id}`);
  return e;
};
const hlIds = (entities: Entities): string[] => entities.values.map((e) => e.id).filter((id) => id.startsWith("hl/")).sort();
const positionsOf = (e: Entity): Cartesian3[] => e.polyline?.positions?.getValue(at(T0S)) as Cartesian3[];
const GIVEN = [T0S + HOUR, T0S + HOUR + 600] as [number, number];

describe("highlightTimes", () => {
  test("highlight times cover each interval, samples every step and the stop edge", () => {
    expect(highlightTimes([{ start: 0, stop: 150 }], 60_000)).toEqual([[0, 60_000, 120_000, 150_000]]);
  });

  test("a stop that falls on a sample is not repeated; each interval is sampled on its own", () => {
    expect(highlightTimes([{ start: 0, stop: 120 }, { start: 1000, stop: 1030 }], 60_000)).toEqual([[0, 60_000, 120_000], [1_000_000, 1_030_000]]);
  });

  test("a zero length interval is one sample, a reversed or non finite one has none (the array stays aligned with the input)", () => {
    expect(highlightTimes([{ start: 5, stop: 5 }, { start: 9, stop: 3 }, { start: Number.NaN, stop: 4 }], 60_000)).toEqual([[5000], [], []]);
  });

  test("a step that is not positive samples the two edges only", () => {
    expect(highlightTimes([{ start: 0, stop: 150 }], 0)).toEqual([[0, 150_000]]);
    expect(highlightTimes([{ start: 0, stop: 150 }], -5)).toEqual([[0, 150_000]]);
  });
});

describe("highlightOptions: which accesses draw a highlight", () => {
  const opts = (a: object) => highlightOptions(a as never);

  test("a computed access with its own graphics and an option on draws it", () => {
    expect(opts(access({}, { static_highlight: true, animate_highlight: false }))).toEqual({ static: true, animate: false, color: null });
    expect(opts(access({}, { static_highlight: false, animate_highlight: true }))).toEqual({ static: false, animate: true, color: null });
  });

  test("inherit true, a missing inherit, no graphics at all: nothing is drawn (the scenario default)", () => {
    expect(opts(access({}, { inherit: true }))).toBeNull();
    expect(opts(access({}, { inherit: undefined }))).toBeNull();
    expect(opts(access({}, null))).toBeNull();
  });

  test("Show off, both options off, or an access that is not computed (cleared): nothing is drawn", () => {
    expect(opts(access({}, { show: false }))).toBeNull();
    expect(opts(access({}, { static_highlight: false, animate_highlight: false }))).toBeNull();
    expect(opts(access({ computed: false }))).toBeNull();
    expect(opts(access({ computed: undefined }))).toBeNull();
  });

  test("Use Custom Color gives its colour, a missing or unreadable one falls back to the object colour", () => {
    expect(opts(access({}, { color_mode: "custom", custom_color: "#12AB34" }))?.color).toBe("#12ab34");
    expect(opts(access({}, { color_mode: "custom", custom_color: null }))?.color).toBeNull();
    expect(opts(access({}, { color_mode: "custom", custom_color: "red" }))?.color).toBeNull();
    expect(opts(access({}, { color_mode: "object", custom_color: "#12ab34" }))?.color).toBeNull();
  });
});

describe("static highlight", () => {
  test("static highlight draws a thick track only in access", async () => {
    const entities = await entitiesOf();
    const a = access({}, { animate_highlight: false });
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx);

    expect(hlIds(entities)).toEqual(["hl/static/G01"]);
    const line = byId(entities, "hl/static/G01").polyline!;
    expect(line.positions).toBeInstanceOf(ConstantProperty);
    const points = positionsOf(byId(entities, "hl/static/G01"));
    const times = highlightTimes([{ start: GIVEN[0], stop: GIVEN[1] }], 60_000)[0];
    expect(points).toHaveLength(times.length);
    expect(points).toHaveLength(11);
    expect(line.width?.getValue(at(T0S))).toBe(STATIC_HIGHLIGHT_WIDTH);
    expect(STATIC_HIGHLIGHT_WIDTH).toBe(4);
    expect(byId(entities, "hl/static/G01").show).toBe(true);

    // จุดคือจุดใต้ดาว ณ เวลาตัวอย่าง บนผิวทรงรี (ความสูง 0: polyline ที่ความสูงของดาวไม่ถูกวาดในโหมด 2D ของ Cesium)
    const g01 = byId(entities, "sat/G01");
    const subPoint = (sec: number): Cartesian3 => {
      const c = Cartographic.fromCartesian(g01.position!.getValueInReferenceFrame(at(sec), FIXED, new Cartesian3())!);
      return Cartesian3.fromRadians(c.longitude, c.latitude, 0);
    };
    times.forEach((ms, i) => {
      expect(Cartesian3.distance(points[i], subPoint(ms / 1000))).toBeLessThan(1e-3);
      expect(Math.abs(Cartographic.fromCartesian(points[i]).height)).toBeLessThan(1e-3);
    });
    // ขอบแรกและขอบสุดท้ายคือขอบของช่วง access พอดี ไม่มีจุดนอกช่วง
    expect(Cartesian3.distance(points[0], subPoint(GIVEN[0]))).toBeLessThan(1e-3);
    expect(Cartesian3.distance(points[10], subPoint(GIVEN[1]))).toBeLessThan(1e-3);
    expect(Cartesian3.distance(points[0], points[10])).toBeGreaterThan(400_000); // ไล่ตามวงโคจรจริง 10 นาที (ราว 560 กม.) ไม่ใช่จุดซ้ำ
  });

  test("the track is not tied to time: no CallbackProperty anywhere and it shows at any clock time", async () => {
    const entities = await entitiesOf();
    const a = access();
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN], E05: [GIVEN] }), ctx);
    for (const entity of entities.values.filter((e) => e.id.startsWith("hl/"))) {
      for (const key of ["position", "polyline", "billboard"] as const) {
        const value = entity[key] as unknown as Record<string, unknown> | undefined;
        if (value === undefined) continue;
        expect(value).not.toBeInstanceOf(CallbackProperty);
        for (const inner of Object.values(value)) expect(inner).not.toBeInstanceOf(CallbackProperty);
      }
    }
    const line = byId(entities, "hl/static/G01");
    expect(line.availability).toBeUndefined();
    for (const hour of [0, 1, 12, 23]) expect(line.isAvailable(at(T0S + hour * HOUR))).toBe(true);
  });

  test("the colour is the satellite colour with Use Object Colors and the custom colour with Use Custom Color", async () => {
    const entities = await entitiesOf();
    const a = access({}, { animate_highlight: false });
    const doc = docOf([a]);
    const replies = repliesFor(a, { G01: [GIVEN], E05: [GIVEN] });
    applyAccessHighlights(entities, doc, replies, ctx);
    const color = (id: string): string | undefined => (byId(entities, id).polyline?.material as ColorMaterialProperty).color?.getValue(at(T0S)).toCssHexString();
    expect(color("hl/static/G01")).toBe(TOKENS.gps);

    const custom = access({}, { animate_highlight: false, color_mode: "custom", custom_color: "#12ab34" });
    applyAccessHighlights(entities, docOf([custom]), repliesFor(custom, { G01: [GIVEN], E05: [GIVEN] }), ctx);
    expect(color("hl/static/G01")).toBe("#12ab34");
    expect(color("hl/static/E05")).toBe("#12ab34");
  });

  test("two intervals of one satellite are two separate lines, never joined across the gap", async () => {
    const entities = await entitiesOf();
    const a = access({}, { animate_highlight: false });
    const second: [number, number] = [T0S + 2 * HOUR, T0S + 2 * HOUR + 300];
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN, second] }), ctx);
    expect(hlIds(entities)).toEqual(["hl/static/G01", "hl/static/G01/1"]);
    expect(positionsOf(byId(entities, "hl/static/G01"))).toHaveLength(11);
    expect(positionsOf(byId(entities, "hl/static/G01/1"))).toHaveLength(6);
  });

  test("overlapping intervals of the same satellite (two accesses) are drawn once", async () => {
    const entities = await entitiesOf();
    const a = access({}, { animate_highlight: false });
    const b = access({ from: "*/Facility/OTHER" }, { animate_highlight: false });
    const doc = docOf([a, b], [fac("THBK"), fac("OTHER"), con("GPS", ["G01", "E05"]), sat("G01", 62339), sat("E05", 40128)]);
    const replies = { ...repliesFor(a, { G01: [[GIVEN[0], GIVEN[0] + 300]] }), ...repliesFor(b, { G01: [[GIVEN[0] + 120, GIVEN[1]]] }) };
    applyAccessHighlights(entities, doc, replies, ctx);
    expect(hlIds(entities)).toEqual(["hl/static/G01"]);
    expect(positionsOf(byId(entities, "hl/static/G01"))).toHaveLength(11); // GIVEN[0]..GIVEN[1] ครั้งเดียว
  });

  test("two facilities with different colours on one satellite give one entity each, in each facility's own colour", async () => {
    const entities = await entitiesOf();
    const a = access({}, { animate_highlight: true, color_mode: "custom", custom_color: "#aa0000" });
    const b = access({ from: "*/Facility/OTHER", to: ["*/Satellite/G01"] }, { animate_highlight: true, color_mode: "custom", custom_color: "#0000bb" });
    const doc = docOf([a, b], [fac("THBK"), fac("OTHER"), con("GPS", ["G01", "E05"]), sat("G01", 62339), sat("E05", 40128)]);
    const second: [number, number] = [T0S + 2 * HOUR, T0S + 2 * HOUR + 300];
    const replies = { ...repliesFor(a, { G01: [GIVEN] }), ...repliesFor(b, { G01: [second] }) };
    applyAccessHighlights(entities, doc, replies, ctx);
    const ids = hlIds(entities);
    expect(ids.filter((id) => id.startsWith("hl/static/"))).toHaveLength(2);
    expect(ids.filter((id) => id.startsWith("hl/box/"))).toHaveLength(2);
    const lineColor = (e: Entity): string => (e.polyline!.material as ColorMaterialProperty).color!.getValue(at(T0S)).toCssHexString();
    const boxColor = (e: Entity): string => e.billboard!.color!.getValue(at(T0S)).toCssHexString();
    const lines = entities.values.filter((e) => e.id.startsWith("hl/static/"));
    const boxes = entities.values.filter((e) => e.id.startsWith("hl/box/"));
    // เส้นของ THBK อยู่ที่ช่วงแรก (11 จุด) สีแดง ของ OTHER อยู่ที่ช่วงที่สอง (6 จุด) สีน้ำเงิน: ไม่รวมช่วงข้ามสีกัน
    expect(lines.map((e) => [positionsOf(e).length, lineColor(e)]).sort()).toEqual([[11, "#aa0000"], [6, "#0000bb"]].sort());
    const boxOf = (color: string) => boxes.find((e) => boxColor(e) === color)!;
    expect(boxOf("#aa0000").availability!.contains(at(GIVEN[0] + 10))).toBe(true);
    expect(boxOf("#aa0000").availability!.contains(at(second[0] + 10))).toBe(false);
    expect(boxOf("#0000bb").availability!.contains(at(second[0] + 10))).toBe(true);
    expect(boxOf("#0000bb").availability!.contains(at(GIVEN[0] + 10))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("of two computed accesses of one facility covering a satellite, the explicit Satellite one decides its highlight", async () => {
    const entities = await entitiesOf();
    const viaCon = access({}, { animate_highlight: false, color_mode: "custom", custom_color: "#aa0000" });
    const viaSat = access({ to: ["*/Satellite/G01"] }, { animate_highlight: false, color_mode: "custom", custom_color: "#0000bb" });
    const replies = { ...repliesFor(viaCon, { G01: [GIVEN], E05: [GIVEN] }), ...repliesFor(viaSat, { G01: [GIVEN] }) };
    applyAccessHighlights(entities, docOf([viaSat, viaCon]), replies, ctx);
    const color = (id: string): string => (byId(entities, id).polyline!.material as ColorMaterialProperty).color!.getValue(at(T0S)).toCssHexString();
    expect(hlIds(entities)).toEqual(["hl/static/E05", "hl/static/G01"]);
    expect(color("hl/static/G01")).toBe("#0000bb");
    expect(color("hl/static/E05")).toBe("#aa0000");
  });

  test("a track that crosses the 180° meridian stays one line through the same samples (Cesium cuts geometry polylines at the meridian in 2D itself)", () => {
    const entities = new EntityCollection();
    const position = new SampledPositionProperty(FIXED);
    const times: JulianDate[] = [];
    const cartesians: Cartesian3[] = [];
    for (let i = 0; i <= 10; i++) {
      const lon = 179 + 0.4 * i;
      times.push(at(T0S + i * 30));
      cartesians.push(Cartesian3.fromDegrees(lon > 180 ? lon - 360 : lon, 10, 20_000_000));
    }
    position.addSamples(times, cartesians);
    entities.add(new Entity({ id: "sat/G01", position }));
    const a = access({}, { animate_highlight: false });
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [[T0S, T0S + 300]] }), ctx);

    expect(hlIds(entities)).toEqual(["hl/static/G01"]);
    const points = positionsOf(byId(entities, "hl/static/G01"));
    expect(points).toHaveLength(6);
    const lon = (p: Cartesian3): number => CMath.toDegrees(Cartographic.fromCartesian(p).longitude);
    expect(points.map(lon).map((x) => Math.round(x * 10) / 10)).toEqual([179, 179.8, -179.4, -178.6, -177.8, -177]); // ข้ามเส้น 180° ระหว่างจุดที่สองกับสาม
  });

  test("an interval where the satellite has no position yet gives no line (an interval of one point cannot be drawn)", async () => {
    const entities = await entitiesOf();
    const a = access({}, { animate_highlight: false });
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [[T0S - 7200, T0S - 7200], [T0S - 7200, T0S - 3600]] }), ctx); // ก่อนตัวอย่างแรก
    expect(hlIds(entities)).toEqual([]);
  });
});

describe("animate highlight", () => {
  test("animate highlight is available only in access", async () => {
    const entities = await entitiesOf();
    const a = access({}, { static_highlight: false });
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx);
    expect(hlIds(entities)).toEqual(["hl/box/G01"]);
    const box = byId(entities, "hl/box/G01");
    expect(box.availability!.contains(at(GIVEN[0] + 300))).toBe(true);
    expect(box.availability!.contains(at(GIVEN[0] - 1))).toBe(false);
    expect(box.availability!.contains(at(GIVEN[1] + 1))).toBe(false);
    expect(box.availability!.contains(at(T0S))).toBe(false);
    expect(box.availability!.contains(at(GIVEN[0]))).toBe(true); // ขอบแรกและขอบสุดท้ายอยู่ในช่วง
    expect(box.availability!.contains(at(GIVEN[1]))).toBe(true);
    expect(box.isAvailable(at(GIVEN[0] + 300))).toBe(true);
    expect(box.isAvailable(at(GIVEN[1] + 600))).toBe(false);
  });

  test("the box follows the satellite through the very same position property (no CallbackProperty) and is a frame, not a fill", async () => {
    const entities = await entitiesOf();
    const a = access({}, { static_highlight: false });
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx);
    const box = byId(entities, "hl/box/G01");
    expect(box.position).toBe(byId(entities, "sat/G01").position);
    expect(box.billboard).toBeDefined();
    const image = box.billboard!.image!.getValue(at(GIVEN[0])) as string;
    expect(image).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(image)).toContain('fill="none"'); // กรอบ ไม่ทึบ
    expect(box.billboard!.color!.getValue(at(GIVEN[0])).toCssHexString()).toBe(TOKENS.gps);
    expect(box.polyline).toBeUndefined();
  });

  test("one box per satellite even with several intervals: its availability holds all of them", async () => {
    const entities = await entitiesOf();
    const a = access({}, { static_highlight: false });
    const second: [number, number] = [T0S + 2 * HOUR, T0S + 2 * HOUR + 300];
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN, second], E05: [second] }), ctx);
    expect(hlIds(entities)).toEqual(["hl/box/E05", "hl/box/G01"]);
    const box = byId(entities, "hl/box/G01");
    expect(box.availability!.contains(at(GIVEN[0] + 10))).toBe(true);
    expect(box.availability!.contains(at(second[0] + 10))).toBe(true);
    expect(box.availability!.contains(at(T0S + 90 * 60))).toBe(false); // ระหว่างสองช่วง
  });

  test("the custom colour tints the box", async () => {
    const entities = await entitiesOf();
    const a = access({}, { static_highlight: false, color_mode: "custom", custom_color: "#12ab34" });
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx);
    expect(byId(entities, "hl/box/G01").billboard!.color!.getValue(at(GIVEN[0])).toCssHexString()).toBe("#12ab34");
  });
});

describe("turning things off", () => {
  test("turning options off removes the entities", async () => {
    const entities = await entitiesOf();
    const a = access();
    const replies = repliesFor(a, { G01: [GIVEN], E05: [GIVEN] });
    applyAccessHighlights(entities, docOf([a]), replies, ctx);
    expect(hlIds(entities)).toEqual(["hl/box/E05", "hl/box/G01", "hl/static/E05", "hl/static/G01"]);

    const staticOff = access({}, { static_highlight: false });
    applyAccessHighlights(entities, docOf([staticOff]), repliesFor(staticOff, { G01: [GIVEN], E05: [GIVEN] }), ctx);
    expect(hlIds(entities)).toEqual(["hl/box/E05", "hl/box/G01"]);

    const animateOff = access({}, { animate_highlight: false });
    applyAccessHighlights(entities, docOf([animateOff]), repliesFor(animateOff, { G01: [GIVEN], E05: [GIVEN] }), ctx);
    expect(hlIds(entities)).toEqual(["hl/static/E05", "hl/static/G01"]);

    const bothOff = access({}, { static_highlight: false, animate_highlight: false });
    applyAccessHighlights(entities, docOf([bothOff]), repliesFor(bothOff, { G01: [GIVEN] }), ctx);
    expect(hlIds(entities)).toEqual([]);
  });

  test("inherit true draws nothing and removes what was drawn; so does Show off, Clear (computed false) and removing the access", async () => {
    const entities = await entitiesOf();
    const a = access();
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx);
    expect(hlIds(entities)).not.toEqual([]);

    for (const [name, changed] of [
      ["inherit", access({}, { inherit: true })],
      ["show", access({}, { show: false })],
      ["clear", access({ computed: false })],
    ] as const) {
      applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx); // วาดก่อน
      expect(hlIds(entities), name).not.toEqual([]);
      applyAccessHighlights(entities, docOf([changed]), repliesFor(changed, { G01: [GIVEN] }), ctx);
      expect(hlIds(entities), name).toEqual([]);
    }
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN] }), ctx);
    applyAccessHighlights(entities, docOf([]), {}, ctx);
    expect(hlIds(entities)).toEqual([]);
    applyAccessHighlights(entities, null, {}, ctx);
    expect(hlIds(entities)).toEqual([]);
  });

  test("hidden satellite gets no highlight, nor one that is off in the 2D window or missing from the scene", async () => {
    const entities = await entitiesOf();
    const a = access();
    const replies = repliesFor(a, { G01: [GIVEN], E05: [GIVEN], R07: [GIVEN] });
    const doc = docOf([a], [fac("THBK"), con("GPS", ["G01", "E05", "R07"]), sat("G01", 62339), sat("E05", 40128), sat("R07", 37868)]);
    applyAccessHighlights(entities, doc, replies, { ...ctx, isHidden: (norad) => norad === 62339 });
    expect(hlIds(entities).join()).toBe("hl/box/E05,hl/static/E05"); // G01 ซ่อน, R07 ไม่มี entity ในภาพ

    const off2d = docOf([a], [fac("THBK"), con("GPS", ["G01", "E05"]), sat("G01", 62339), sat("E05", 40128, { graphics2d: { show: false } })]);
    applyAccessHighlights(entities, off2d, replies, ctx);
    expect(hlIds(entities).join()).toBe("hl/box/G01,hl/static/G01");

    byId(entities, "sat/G01").show = false; // ถูกซ่อนในภาพ (applyGraphics)
    applyAccessHighlights(entities, off2d, replies, ctx);
    expect(hlIds(entities)).toEqual([]);
  });

  test("a reply that is not ok, a missing reply and an unknown satellite draw nothing", async () => {
    const entities = await entitiesOf();
    const a = access();
    const doc = docOf([a]);
    applyAccessHighlights(entities, doc, { [accessKey(a)]: { status: "notCurrent" } }, ctx);
    expect(hlIds(entities)).toEqual([]);
    applyAccessHighlights(entities, doc, { [accessKey(a)]: { status: "error", message: "x" } }, ctx);
    expect(hlIds(entities)).toEqual([]);
    applyAccessHighlights(entities, doc, {}, ctx);
    expect(hlIds(entities)).toEqual([]);
    applyAccessHighlights(entities, doc, repliesFor(a, { NOPE: [GIVEN] }), ctx);
    expect(hlIds(entities)).toEqual([]);
  });

  test("applying again replaces the highlights (no duplicates) and leaves every other entity alone", async () => {
    const entities = await entitiesOf();
    const before = entities.values.map((e) => e.id).sort();
    const a = access();
    const replies = repliesFor(a, { G01: [GIVEN] });
    applyAccessHighlights(entities, docOf([a]), replies, ctx);
    applyAccessHighlights(entities, docOf([a]), replies, ctx);
    expect(hlIds(entities)).toEqual(["hl/box/G01", "hl/static/G01"]);
    applyAccessHighlights(entities, docOf([]), {}, ctx);
    expect(entities.values.map((e) => e.id).sort()).toEqual(before);
  });

  test("the whole change is one collectionChanged (so the idle display wakes once)", async () => {
    const entities = await entitiesOf();
    const a = access();
    const seen = vi.fn();
    entities.collectionChanged.addEventListener(seen);
    applyAccessHighlights(entities, docOf([a]), repliesFor(a, { G01: [GIVEN], E05: [GIVEN] }), ctx);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("HighlightIntervals: fetching the access intervals the highlights need", () => {
  const ROUTE = "GET /api/scenarios/S1/access/intervals";
  const INTERVALS = { G01: [{ start: iso(T0S + HOUR), stop: iso(T0S + HOUR + 600), duration_s: 600, max_el_deg: 40 }] };
  const info = (hash: string, ephem = "current"): ResultsInfo =>
    ({ ephem: { status: ephem, hash: "e1" }, access: { THBK: { status: "current", hash } }, error: null }) as unknown as ResultsInfo;

  let changes: Mock<() => void>;
  let source: HighlightIntervals;
  beforeEach(() => {
    changes = vi.fn();
    source = new HighlightIntervals(() => changes());
  });
  afterEach(() => {
    source.dispose();
    vi.unstubAllGlobals();
  });

  test("nothing is fetched while no access wants a highlight (inherit, options off, not computed, no scenario)", async () => {
    const stub = stubFetch({});
    for (const a of [access({}, { inherit: true }), access({}, { static_highlight: false, animate_highlight: false }), access({ computed: false })]) {
      source.sync("S1", docOf([a]), info("h1"));
    }
    source.sync(null, docOf([access()]), info("h1"));
    source.sync("S1", null, info("h1"));
    await source.idle();
    expect(stub.calls).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
    expect(source.replies).toEqual({});
  });

  test("a wanted access is fetched once with its from and to; the reply is kept by access key and onChange fires", async () => {
    const stub = stubFetch({ [ROUTE]: { json: INTERVALS } });
    const a = access();
    const doc = docOf([a]);
    source.sync("S1", doc, info("h1"));
    source.sync("S1", doc, info("h1")); // เหมือนเดิม: ไม่ดึงซ้ำ
    await source.idle();
    expect(stub.count(ROUTE)).toBe(1);
    expect(stub.calls[0].query.get("from")).toBe("*/Facility/THBK");
    expect(stub.calls[0].query.getAll("to")).toEqual(["*/Constellation/GPS"]);
    expect(source.replies[accessKey(a)]).toMatchObject({ status: "ok", bySat: INTERVALS });
    expect(changes).toHaveBeenCalledTimes(1);
  });

  test("it fetches the same accesses again when the result hash of the facility or the stored time period changes", async () => {
    const stub = stubFetch({ [ROUTE]: { json: INTERVALS } });
    const doc = docOf([access()]);
    source.sync("S1", doc, info("h1"));
    await source.idle();
    source.sync("S1", doc, info("h2")); // Compute ใหม่
    await source.idle();
    expect(stub.count(ROUTE)).toBe(2);
    const specify = { mode: "specify", start: "2026-11-11T00:00:00Z", stop: "2026-11-11T06:00:00Z" };
    source.sync("S1", docOf([access({ time_period: specify })]), info("h2"));
    await source.idle();
    expect(stub.count(ROUTE)).toBe(3);
    source.sync("S1", docOf([access({ time_period: specify }, { color_mode: "custom", custom_color: "#12ab34" })]), info("h2")); // สีไม่ต้องดึงใหม่
    await source.idle();
    expect(stub.count(ROUTE)).toBe(3);
  });

  test("an answer that arrives after a newer request is dropped", async () => {
    const slow = deferred<{ json: unknown }>();
    let n = 0;
    const stub = stubFetch({ [ROUTE]: () => (++n === 1 ? slow.promise : { json: { G01: [] } }) });
    const doc = docOf([access()]);
    source.sync("S1", doc, info("h1"));
    source.sync("S1", doc, info("h2"));
    await source.idle();
    expect(stub.count(ROUTE)).toBe(2);
    slow.resolve({ json: INTERVALS });
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.values(source.replies)[0]).toMatchObject({ status: "ok", bySat: { G01: [] } });
    expect(changes).toHaveBeenCalledTimes(1);
  });

  test("replies of scenario X are not handed out (nor drawn) after switching to scenario Y with the same access", async () => {
    const slow = deferred<{ json: unknown }>();
    const stub = stubFetch({
      [ROUTE]: { json: INTERVALS },
      "GET /api/scenarios/S2/access/intervals": () => slow.promise,
    });
    const a = access();
    source.sync("S1", docOf([a]), info("h1"));
    await source.idle();
    expect(source.replies[accessKey(a)]).toMatchObject({ status: "ok" });

    source.sync("S2", docOf([a]), info("h1")); // กุญแจ access เดียวกัน คำตอบของ S2 ยังไม่มา
    expect(stub.count("GET /api/scenarios/S2/access/intervals")).toBe(1);
    expect(source.replies).toEqual({});
    const entities = await entitiesOf();
    applyAccessHighlights(entities, docOf([a]), source.replies, ctx);
    expect(hlIds(entities)).toEqual([]);

    slow.resolve({ json: { E05: INTERVALS.G01 } });
    await source.idle();
    expect(Object.keys((source.replies[accessKey(a)] as { bySat: object }).bySat)).toEqual(["E05"]);
  });

  test("an error thrown by onChange is logged, not left as an unhandled rejection", async () => {
    stubFetch({ [ROUTE]: { json: INTERVALS } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const throwing = new HighlightIntervals(() => {
      throw new Error("boom");
    });
    throwing.sync("S1", docOf([access()]), info("h1"));
    await expect(throwing.idle()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0].at(-1))).toContain("boom");
    throwing.dispose();
    errors.mockRestore();
  });

  test("409 RESULTS_NOT_CURRENT is a notCurrent reply (no highlight until the results are current again)", async () => {
    stubFetch({ [ROUTE]: { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "stale" } } });
    const a = access();
    source.sync("S1", docOf([a]), info("h1"));
    await source.idle();
    expect(source.replies[accessKey(a)]).toEqual({ status: "notCurrent" });
  });

  test("when no access wants a highlight any more the replies are dropped and a running request is abandoned", async () => {
    const slow = deferred<{ json: unknown }>();
    stubFetch({ [ROUTE]: () => slow.promise });
    source.sync("S1", docOf([access()]), info("h1"));
    source.sync("S1", docOf([access({}, { static_highlight: false, animate_highlight: false })]), info("h1"));
    slow.resolve({ json: INTERVALS });
    await source.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(source.replies).toEqual({});
    expect(changes).not.toHaveBeenCalled();
  });

  test("dispose abandons the request and never calls onChange again", async () => {
    const slow = deferred<{ json: unknown }>();
    stubFetch({ [ROUTE]: () => slow.promise });
    source.sync("S1", docOf([access()]), info("h1"));
    source.dispose();
    slow.resolve({ json: INTERVALS });
    await new Promise((r) => setTimeout(r, 0));
    expect(changes).not.toHaveBeenCalled();
  });
});
