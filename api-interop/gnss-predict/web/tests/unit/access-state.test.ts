// สถานะของ Access tool (src/windows/AccessTool/state.ts): ต้นไม้ Associated Objects, ชุดปลายทาง (P8), ตัวหนา และชุดที่ส่งให้ server

import { describe, expect, test } from "vitest";
import {
  allSelections, associatedTree, computedSatellites, leavesOf, reportObjects, selections, targetsOf,
} from "../../src/windows/AccessTool/state";
import { makeDoc, type ScenarioDoc } from "./helpers/chrome";

const THBK = "*/Facility/THBK";
const KMIT = "*/Facility/KMIT";
const GPS = "*/Constellation/GPS";
const GAL = "*/Constellation/GAL";
const G01 = "*/Satellite/G01";
const G02 = "*/Satellite/G02";
const E11 = "*/Satellite/E11";
const C20 = "*/Satellite/C20";

function doc(accesses: unknown[] = []): ScenarioDoc {
  return makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK" },
      { class: "Facility", name: "KMIT" },
      { class: "Constellation", name: "GPS", assigned_objects: [G01, G02, "*/Satellite/GONE"] },
      { class: "Constellation", name: "GAL", assigned_objects: [E11] },
      { class: "Constellation", name: "EMPTY", assigned_objects: [] },
      { class: "Satellite", name: "G01" },
      { class: "Satellite", name: "G02" },
      { class: "Satellite", name: "E11" },
      { class: "Satellite", name: "C20" },
    ] as never,
    accesses: accesses as never,
  });
}

describe("targetsOf", () => {
  test("whole constellation collapses to its path", () => {
    expect(targetsOf(new Set([G01, G02]), doc())).toEqual([GPS]);
    expect(targetsOf(new Set([G01, G02, E11, C20]), doc())).toEqual([GPS, GAL, C20]);
  });

  test("partial constellation lists satellites", () => {
    expect(targetsOf(new Set([G02]), doc())).toEqual([G02]);
    expect(targetsOf(new Set([C20, G01, E11]), doc())).toEqual([GAL, G01, C20]);
  });

  test("an empty constellation is never implied, and nothing ticked is nothing", () => {
    expect(targetsOf(new Set(), doc())).toEqual([]);
    expect(targetsOf(new Set([C20]), doc())).toEqual([C20]);
    expect(targetsOf(new Set([G01]), null)).toEqual([]);
  });
});

describe("computedSatellites", () => {
  test("bold means computed and current", () => {
    const d = doc([
      { from: THBK, to: [GPS], computed: true },
      { from: THBK, to: [C20], computed: false },
      { from: KMIT, to: [E11], computed: true },
    ]);
    expect(computedSatellites(d, { THBK: "current", KMIT: "current" })).toEqual(new Set([`${THBK} ${G01}`, `${THBK} ${G02}`, `${KMIT} ${E11}`]));
    // stale (หรือ missing / ยังไม่รู้) = ไม่หนา แม้ computed
    expect(computedSatellites(d, { THBK: "stale", KMIT: "current" })).toEqual(new Set([`${KMIT} ${E11}`]));
    expect(computedSatellites(d, {})).toEqual(new Set());
    expect(computedSatellites(null, { THBK: "current" })).toEqual(new Set());
  });
});

describe("associatedTree", () => {
  test("facility access-for lists constellations with their satellites, then the ungrouped satellites", () => {
    const tree = associatedTree(doc(), THBK);
    expect(tree.map((n) => [n.cls, n.name, n.children?.map((c) => c.name)])).toEqual([
      ["Constellation", "GPS", ["G01", "G02"]],
      ["Constellation", "GAL", ["E11"]],
      ["Constellation", "EMPTY", []],
      ["Satellite", "C20", undefined],
    ]);
    expect(leavesOf(tree)).toEqual([G01, G02, E11, C20]);
  });

  test("satellite access-for lists facilities", () => {
    const tree = associatedTree(doc(), G01);
    expect(tree).toEqual([
      { path: THBK, name: "THBK", cls: "Facility" },
      { path: KMIT, name: "KMIT", cls: "Facility" },
    ]);
    expect(leavesOf(tree)).toEqual([THBK, KMIT]);
  });

  test("no access-for, a constellation or a missing object has no associated objects", () => {
    expect(associatedTree(doc(), null)).toEqual([]);
    expect(associatedTree(doc(), GPS)).toEqual([]);
    expect(associatedTree(doc(), "*/Facility/GONE")).toEqual([]);
    expect(associatedTree(null, THBK)).toEqual([]);
  });
});

describe("what is sent", () => {
  test("a facility sends one selection with the collapsed targets", () => {
    expect(selections(doc(), THBK, new Set([G01, G02, C20]))).toEqual([{ from: THBK, to: [GPS, C20] }]);
    expect(selections(doc(), THBK, new Set())).toEqual([]);
    expect(allSelections(doc(), THBK)).toEqual([{ from: THBK, to: "all" }]);
  });

  test("a satellite sends one facility-to-satellite selection per ticked facility", () => {
    expect(selections(doc(), G01, new Set([KMIT, THBK]))).toEqual([{ from: THBK, to: [G01] }, { from: KMIT, to: [G01] }]);
  });

  test("clear all of a satellite takes only the accesses whose single target is that satellite", () => {
    const d = doc([
      { from: THBK, to: [G01], computed: true },
      { from: KMIT, to: [GPS], computed: true },
      { from: KMIT, to: [G01, G02], computed: true },
    ]);
    expect(allSelections(d, G01)).toEqual([{ from: THBK, to: [G01] }]);
    expect(allSelections(d, G02)).toEqual([]);
  });

  test("report objects are P1 pairs with the facility first", () => {
    expect(reportObjects(doc(), THBK, new Set([E11, G01]))).toEqual([`${THBK} ${G01}`, `${THBK} ${E11}`]);
    expect(reportObjects(doc(), G01, new Set([KMIT]))).toEqual([`${KMIT} ${G01}`]);
    expect(reportObjects(doc(), null, new Set([G01]))).toEqual([]);
  });
});
