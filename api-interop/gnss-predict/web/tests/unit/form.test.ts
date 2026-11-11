import { describe, expect, test } from "vitest";
import { ENUMS } from "../../src/api/enums.gen";
import { msg } from "../../src/labels/messages.th";
import {
  OBJECT_SPECS, SCENARIO_SPECS, applyValues, diffPages, fieldFromServer, isDirty, locateField, mergePatch, sectionsOf, valuesFrom,
  type Spec,
} from "../../src/windows/PropertiesBrowser/form";
import { makeDoc } from "./helpers/chrome";

const spec = (specs: readonly Spec[], key: string): Spec => {
  const hit = specs.find((s) => s.key === key);
  if (hit === undefined) throw new Error(`no spec for ${key}`);
  return hit;
};

describe("diffPages", () => {
  test("identical pages give nothing to send", () => {
    const pages = { basic: { description: "x" }, constraints: { elevation_angle_min_deg: 10 } };
    expect(diffPages(pages, structuredClone(pages))).toEqual({});
  });

  test("only the groups that changed are sent, and only the leaves that changed in them", () => {
    const original = { basic: { description: "x" }, constraints: { elevation_angle_min_deg: 10, elevation_angle_max_deg: null } };
    const edited = { basic: { description: "x" }, constraints: { elevation_angle_min_deg: 15, elevation_angle_max_deg: null } };
    expect(diffPages(original, edited)).toEqual({ constraints: { elevation_angle_min_deg: 15 } });
  });

  test("a nested section keeps its path so the server can deep-merge it", () => {
    const original = { graphics2d: { color: "#ffd23f", pass: { lead_type: "Time", lead_time_s: 600 }, swath: { elevation_deg: 10 } } };
    const edited = { graphics2d: { color: "#ffd23f", pass: { lead_type: "Percent", lead_time_s: 600 }, swath: { elevation_deg: 10 } } };
    expect(diffPages(original, edited)).toEqual({ graphics2d: { pass: { lead_type: "Percent" } } });
  });

  test("a value cleared to null is sent as null", () => {
    expect(diffPages({ constraints: { elevation_angle_max_deg: 30 } }, { constraints: { elevation_angle_max_deg: null } })).toEqual({
      constraints: { elevation_angle_max_deg: null },
    });
  });

  test("a list is replaced as a whole, in the order given", () => {
    const original = { basic: { assigned_objects: ["*/Satellite/G01", "*/Satellite/G02"] } };
    const edited = { basic: { assigned_objects: ["*/Satellite/G02", "*/Satellite/G01"] } };
    expect(diffPages(original, edited)).toEqual({ basic: { assigned_objects: ["*/Satellite/G02", "*/Satellite/G01"] } });
  });

  test("a section that was missing is sent whole", () => {
    expect(diffPages({ graphics2d: { color: "#fff000" } }, { graphics2d: { color: "#fff000", pass: { lead_type: "All" } } })).toEqual({
      graphics2d: { pass: { lead_type: "All" } },
    });
  });

  test("does not modify its arguments", () => {
    const original = { basic: { description: "a" } };
    const edited = { basic: { description: "b" } };
    diffPages(original, edited);
    expect(original).toEqual({ basic: { description: "a" } });
    expect(edited).toEqual({ basic: { description: "b" } });
  });
});

describe("fieldFromServer", () => {
  test("a page-relative path is the key of the field", () => {
    expect(fieldFromServer("constraints.elevation_angle_min_deg")).toBe("constraints.elevation_angle_min_deg");
    expect(fieldFromServer("basic.position.lat_deg")).toBe("basic.position.lat_deg");
    expect(fieldFromServer("graphics2d.pass.lead_type")).toBe("graphics2d.pass.lead_type");
  });

  test("a list index points at the list itself", () => {
    expect(fieldFromServer("basic.assigned_objects[0]")).toBe("basic.assigned_objects");
    expect(fieldFromServer("basic.assigned_objects[12]")).toBe("basic.assigned_objects");
  });

  test("a whole-period error from the engine points at Stop", () => {
    expect(fieldFromServer("analysis_period")).toBe("analysis_period.stop");
    expect(fieldFromServer("analysis_period.start")).toBe("analysis_period.start");
  });

  test("an empty or missing path stays empty", () => {
    expect(fieldFromServer("")).toBe("");
  });
});

describe("valuesFrom and applyValues for an object page", () => {
  const facility = {
    basic: { description: "", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 6.4 } },
    graphics2d: { show: true, color: "#ff79e6", marker_style: "Triangle", inherit: true },
    graphics3d: { show: true },
    constraints: { elevation_angle_min_deg: 10 },
  };
  const specs = OBJECT_SPECS.Facility;

  test("numbers become text, a missing optional number becomes empty text, defaults fill missing fields", () => {
    const v = valuesFrom(facility, specs);
    expect(v["basic.position.lat_deg"]).toBe("13.7");
    expect(v["constraints.elevation_angle_min_deg"]).toBe("10");
    expect(v["constraints.elevation_angle_max_deg"]).toBe("");
    expect(v["basic.long_description"]).toBe("");
    expect(v["graphics2d.inherit"]).toBe(true);
    expect(v["graphics2d.color"]).toBe("#ff79e6");
  });

  test("nothing edited: nothing is dirty and the edited pages equal the base", () => {
    const initial = valuesFrom(facility, specs);
    expect(isDirty(initial, structuredClone(initial))).toBe(false);
    const { edited, errors } = applyValues(facility, structuredClone(initial), specs);
    expect(errors).toEqual({});
    expect(diffPages(facility, edited)).toEqual({});
  });

  test("an edited number is parsed and shows up as the only difference", () => {
    const values = { ...valuesFrom(facility, specs), "constraints.elevation_angle_min_deg": "15" };
    const { edited, errors } = applyValues(facility, values, specs);
    expect(errors).toEqual({});
    expect(diffPages(facility, edited)).toEqual({ constraints: { elevation_angle_min_deg: 15 } });
  });

  test("a number is only accepted as plain decimal text", () => {
    for (const bad of ["", "abc", "1,5", "0x10", "1 2", "--3", "Infinity", "NaN", "1e999"]) {
      const values = { ...valuesFrom(facility, specs), "basic.position.lat_deg": bad };
      const { errors } = applyValues(facility, values, specs);
      expect(errors["basic.position.lat_deg"], JSON.stringify(bad)).toBeTruthy();
    }
    for (const good of ["0", "-0.5", "+7", ".5", "5.", "1e1", " 12 "]) {
      const values = { ...valuesFrom(facility, specs), "basic.position.lat_deg": good };
      expect(applyValues(facility, values, specs).errors, JSON.stringify(good)).toEqual({});
    }
  });

  test("a number outside the bounds of the server schema is refused with the range in Thai", () => {
    const v = valuesFrom(facility, specs);
    const lat = applyValues(facility, { ...v, "basic.position.lat_deg": "90.1" }, specs).errors["basic.position.lat_deg"];
    expect(lat).toBe(msg("props.rangeBetween", { min: -90, max: 90 }));
    expect(applyValues(facility, { ...v, "basic.position.lat_deg": "90" }, specs).errors).toEqual({});
    expect(applyValues(facility, { ...v, "basic.position.lon_deg": "-180.5" }, specs).errors["basic.position.lon_deg"]).toBeTruthy();
    expect(applyValues(facility, { ...v, "constraints.elevation_angle_min_deg": "-91" }, specs).errors["constraints.elevation_angle_min_deg"]).toBeTruthy();
    expect(applyValues(facility, { ...v, "constraints.elevation_angle_max_deg": "91" }, specs).errors["constraints.elevation_angle_max_deg"]).toBeTruthy();
  });

  test("Max left blank is null; clearing a Max that was set sends null; a blank Max that was never set sends nothing", () => {
    const withMax = { ...facility, constraints: { elevation_angle_min_deg: 10, elevation_angle_max_deg: 60 } };
    const cleared = { ...valuesFrom(withMax, specs), "constraints.elevation_angle_max_deg": "" };
    expect(diffPages(withMax, applyValues(withMax, cleared, specs).edited)).toEqual({ constraints: { elevation_angle_max_deg: null } });
    expect(diffPages(facility, applyValues(facility, valuesFrom(facility, specs), specs).edited)).toEqual({});
  });

  test("Max must not be below Min, whichever of the two the user changed; a blank Max has no such limit", () => {
    const withMax = { ...facility, constraints: { elevation_angle_min_deg: 10, elevation_angle_max_deg: 60 } };
    const v = valuesFrom(withMax, specs);
    const msgMax = msg("props.maxBelowMin");
    expect(applyValues(withMax, { ...v, "constraints.elevation_angle_max_deg": "9.5" }, specs).errors["constraints.elevation_angle_max_deg"]).toBe(msgMax);
    expect(applyValues(withMax, { ...v, "constraints.elevation_angle_min_deg": "61" }, specs).errors["constraints.elevation_angle_max_deg"]).toBe(msgMax);
    expect(applyValues(withMax, { ...v, "constraints.elevation_angle_max_deg": "10" }, specs).errors).toEqual({});
    expect(applyValues(withMax, { ...v, "constraints.elevation_angle_min_deg": "-5", "constraints.elevation_angle_max_deg": "-5" }, specs).errors).toEqual({});
    expect(applyValues(withMax, { ...v, "constraints.elevation_angle_min_deg": "80", "constraints.elevation_angle_max_deg": "" }, specs).errors).toEqual({});
    // a Max that is itself out of range is reported as that, not as below Min
    expect(applyValues(withMax, { ...v, "constraints.elevation_angle_max_deg": "95" }, specs).errors["constraints.elevation_angle_max_deg"]).toBe(msg("props.rangeBetween", { min: -90, max: 90 }));
  });

  test("a field that was not touched is not checked, so a value the server already holds never blocks Apply", () => {
    const odd = { ...facility, basic: { ...facility.basic, position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 1e300 } } };
    const values = { ...valuesFrom(odd, specs), "basic.description": "x" };
    expect(applyValues(odd, values, specs).errors).toEqual({});
  });

  test("the base is never modified", () => {
    const before = structuredClone(facility);
    applyValues(facility, { ...valuesFrom(facility, specs), "constraints.elevation_angle_min_deg": "15" }, specs);
    expect(facility).toEqual(before);
  });
});

describe("the field tables follow the server schema", () => {
  const sat = OBJECT_SPECS.Satellite;

  test("choices offer exactly the enumerated values of the server", () => {
    const options = (key: string) => (spec(sat, key) as Extract<Spec, { kind: "choice" }>).options;
    expect(options("graphics2d.pass.lead_type")).toEqual(ENUMS.LeadType);
    expect(options("graphics2d.pass.trail_type")).toEqual(ENUMS.TrailType);
    expect(options("graphics2d.pass.visible_sides")).toEqual(ENUMS.VisibleSides);
    expect(options("graphics2d.swath.options")).toEqual(ENUMS.SwathOptions);
    expect(options("graphics3d.orbit_system")).toEqual(ENUMS.OrbitSystem);
    expect(options("graphics2d.line_style")).toEqual(ENUMS.LineStyle);
    expect(options("graphics2d.marker_style")).toEqual(ENUMS.MarkerStyle);
    expect(options("graphics2d.swath.type")).toEqual(["Ground Elevation"]);
  });

  test("Line Width must be greater than 0; lead and trail time at least 0; percent 0 to 100; swath elevation 0 to 90", () => {
    const base = { graphics2d: { pass: {}, swath: {} }, graphics3d: {}, basic: {}, constraints: {} };
    const run = (key: string, text: string) => applyValues(base, { ...valuesFrom(base, sat), [key]: text }, sat).errors[key];
    expect(run("graphics2d.line_width", "0")).toBe(msg("props.rangeGreater", { min: 0 }));
    expect(run("graphics2d.line_width", "-1")).toBeTruthy();
    expect(run("graphics2d.line_width", "1.5")).toBeUndefined();
    expect(run("graphics2d.pass.lead_time_s", "-1")).toBe(msg("props.rangeAtLeast", { min: 0 }));
    expect(run("graphics2d.pass.lead_time_s", "0")).toBeUndefined();
    expect(run("graphics2d.pass.trail_percent", "100.5")).toBe(msg("props.rangeBetween", { min: 0, max: 100 }));
    expect(run("graphics2d.swath.elevation_deg", "91")).toBeTruthy();
    expect(run("graphics2d.swath.elevation_deg", "90")).toBeUndefined();
  });

  test("a Satellite pass that the server has not stored yet gets the schema defaults", () => {
    const v = valuesFrom({ graphics2d: {}, graphics3d: {}, basic: {}, constraints: {} }, sat);
    expect(v["graphics2d.pass.lead_type"]).toBe("Time");
    expect(v["graphics2d.pass.trail_type"]).toBe("Time");
    expect(v["graphics2d.pass.visible_sides"]).toBe("Both");
    expect(v["graphics2d.pass.show_pass_labels"]).toBe(false);
    expect(v["graphics2d.swath.elevation_deg"]).toBe("10");
    expect(v["graphics2d.swath.options"]).toBe("No Graphics");
    expect(v["graphics3d.orbit_system"]).toBe("Fixed by Window");
  });

  test("a Satellite page never writes NORAD", () => {
    expect(sat.find((s) => s.key.includes("norad"))).toBeUndefined();
  });

  test("the pass page can be edited into a stored pass section", () => {
    const base = { graphics2d: { color: "#ffd23f" }, graphics3d: {}, basic: {}, constraints: {} };
    const values = { ...valuesFrom(base, sat), "graphics2d.pass.lead_type": "Percent", "graphics2d.pass.lead_percent": "50" };
    const { edited, errors } = applyValues(base, values, sat);
    expect(errors).toEqual({});
    expect(diffPages(base, edited)).toEqual({ graphics2d: { pass: { lead_type: "Percent", lead_percent: 50 } } });
  });

  test("a Constellation keeps its member list in the order the user gave", () => {
    const con = OBJECT_SPECS.Constellation;
    const base = { basic: { description: "", system: "G", color: "#ffd23f", assigned_objects: ["*/Satellite/G01"] }, graphics2d: {}, graphics3d: {}, constraints: {} };
    const values = { ...valuesFrom(base, con), "basic.assigned_objects": ["*/Satellite/G01", "*/Satellite/G03", "*/Satellite/G02"] };
    expect(diffPages(base, applyValues(base, values, con).edited)).toEqual({
      basic: { assigned_objects: ["*/Satellite/G01", "*/Satellite/G03", "*/Satellite/G02"] },
    });
  });

  test("a Constellation colour can be cleared to null", () => {
    const con = OBJECT_SPECS.Constellation;
    const base = { basic: { description: "", system: "G", color: "#ffd23f", assigned_objects: [] }, graphics2d: {}, graphics3d: {}, constraints: {} };
    const values = { ...valuesFrom(base, con), "basic.color": "" };
    expect(diffPages(base, applyValues(base, values, con).edited)).toEqual({ basic: { color: null } });
  });
});

describe("the Scenario page", () => {
  const doc = makeDoc({
    description: "d",
    ionosphere: { shell_km: 400 },
    graphics2d_global: { show_labels: true },
    units: { date_format: "UTCG", ltz_offset: "+07:00", distance: "km", angle: "deg" },
  });
  const sections = sectionsOf(doc);
  const ctx = { format: "UTCG" as const, offset: "+07:00" };

  test("sectionsOf keeps only what the Properties pages edit", () => {
    expect(Object.keys(sections).sort()).toEqual(["analysis_period", "animation", "description", "graphics2d_global", "ionosphere", "units"]);
    expect(sections.analysis_period).toEqual(doc.analysis_period);
  });

  test("times are shown in the DateFormat of the scenario", () => {
    expect(valuesFrom(sections, SCENARIO_SPECS, ctx)["analysis_period.start"]).toBe("12 Nov 2026 00:00:00.000 UTCG");
    const ltz = { format: "LTZG" as const, offset: "+07:00" };
    expect(valuesFrom(sections, SCENARIO_SPECS, ltz)["analysis_period.start"]).toBe("12 Nov 2026 07:00:00.000 LTZG+07:00");
  });

  test("Start Time of the animation falls back to the start of the analysis period", () => {
    expect(valuesFrom(sections, SCENARIO_SPECS, ctx)["animation.start"]).toBe("12 Nov 2026 00:00:00.000 UTCG");
  });

  test("a changed Stop is written as an ISO time ending in Z and nothing else changes", () => {
    const values = { ...valuesFrom(sections, SCENARIO_SPECS, ctx), "analysis_period.stop": "14 Nov 2026 00:00:00.000 UTCG" };
    const { edited, errors } = applyValues(sections, values, SCENARIO_SPECS, ctx);
    expect(errors).toEqual({});
    expect(diffPages(sections as never, edited as never)).toEqual({ analysis_period: { stop: "2026-11-14T00:00:00Z" } });
  });

  test("a time that does not parse in the DateFormat is refused", () => {
    const values = { ...valuesFrom(sections, SCENARIO_SPECS, ctx), "analysis_period.stop": "2026-11-14" };
    // the example in the message is a time in the format that is accepted
    expect(applyValues(sections, values, SCENARIO_SPECS, ctx).errors["analysis_period.stop"]).toBe(
      msg("time.invalid", { example: "13 Nov 2026 00:00:00.000 UTCG" }),
    );
  });

  test("Stop must be after Start", () => {
    const base = valuesFrom(sections, SCENARIO_SPECS, ctx);
    const same = applyValues(sections, { ...base, "analysis_period.stop": base["analysis_period.start"] }, SCENARIO_SPECS, ctx);
    expect(same.errors["analysis_period.stop"]).toBe(msg("wizard.stopBeforeStart"));
    const before = applyValues(sections, { ...base, "analysis_period.start": "14 Nov 2026 00:00:00.000 UTCG" }, SCENARIO_SPECS, ctx);
    expect(before.errors["analysis_period.stop"]).toBe(msg("wizard.stopBeforeStart"));
  });

  test("LTZG times are read with the offset of the units, and with an offset typed in the text", () => {
    const ltz = { format: "LTZG" as const, offset: "+07:00" };
    const base = valuesFrom(sections, SCENARIO_SPECS, ltz);
    const a = applyValues(sections, { ...base, "analysis_period.stop": "14 Nov 2026 07:00:00.000 LTZG" }, SCENARIO_SPECS, ltz);
    expect(diffPages(sections as never, a.edited as never)).toEqual({ analysis_period: { stop: "2026-11-14T00:00:00Z" } });
    const b = applyValues(sections, { ...base, "analysis_period.stop": "14 Nov 2026 07:00:00.000 LTZG+07:00" }, SCENARIO_SPECS, ltz);
    expect(diffPages(sections as never, b.edited as never)).toEqual({ analysis_period: { stop: "2026-11-14T00:00:00Z" } });
  });

  test("the LTZG offset must pass parseOffset, including offsets the server would accept", () => {
    const base = valuesFrom(sections, SCENARIO_SPECS, ctx);
    for (const bad of ["+24:00", "+07:60", "07:00", "+7:00", "", "+07:00 "])
      expect(applyValues(sections, { ...base, "units.ltz_offset": bad }, SCENARIO_SPECS, ctx).errors["units.ltz_offset"], JSON.stringify(bad)).toBe(
        msg("props.offsetInvalid"),
      );
    for (const good of ["+07:00", "-03:30", "+00:00", "+23:59"])
      expect(applyValues(sections, { ...base, "units.ltz_offset": good }, SCENARIO_SPECS, ctx).errors["units.ltz_offset"], good).toBeUndefined();
  });

  test("Time Step, X Real Time Multiplier and Shell height must be greater than 0", () => {
    const base = valuesFrom(sections, SCENARIO_SPECS, ctx);
    for (const key of ["animation.time_step_s", "animation.x_real_time_multiplier", "ionosphere.shell_km"]) {
      expect(applyValues(sections, { ...base, [key]: "0" }, SCENARIO_SPECS, ctx).errors[key], key).toBe(msg("props.rangeGreater", { min: 0 }));
      expect(applyValues(sections, { ...base, [key]: "-5" }, SCENARIO_SPECS, ctx).errors[key], key).toBeTruthy();
      expect(applyValues(sections, { ...base, [key]: "30" }, SCENARIO_SPECS, ctx).errors[key], key).toBeUndefined();
    }
  });

  test("Time Update Mode and Animation Cycle keep their codes", () => {
    const base = valuesFrom(sections, SCENARIO_SPECS, ctx);
    expect((spec(SCENARIO_SPECS, "animation.update_mode") as Extract<Spec, { kind: "choice" }>).options).toEqual(ENUMS.UpdateMode);
    expect((spec(SCENARIO_SPECS, "animation.cycle") as Extract<Spec, { kind: "choice" }>).options).toEqual(ENUMS.Cycle);
    const { edited } = applyValues(sections, { ...base, "animation.update_mode": "x_real_time", "animation.cycle": "stop" }, SCENARIO_SPECS, ctx);
    expect(diffPages(sections as never, edited as never)).toEqual({ animation: { update_mode: "x_real_time", cycle: "stop" } });
  });

  test("a section the document does not hold yet is created by the first edit", () => {
    const bare = sectionsOf(makeDoc({ units: undefined, ionosphere: undefined, graphics2d_global: undefined }));
    const base = valuesFrom(bare, SCENARIO_SPECS, ctx);
    expect(base["ionosphere.shell_km"]).toBe("400");
    expect(base["graphics2d_global.show_labels"]).toBe(true);
    const { edited } = applyValues(bare, { ...base, "ionosphere.shell_km": "450", "graphics2d_global.show_labels": false }, SCENARIO_SPECS, ctx);
    expect(diffPages(bare as never, edited as never)).toEqual({ ionosphere: { shell_km: 450 }, graphics2d_global: { show_labels: false } });
  });

  test("mergePatch writes a patch into a document and leaves everything else", () => {
    const draft = structuredClone(doc) as Record<string, unknown>;
    mergePatch(draft, { analysis_period: { stop: "2026-11-14T00:00:00Z" }, ionosphere: { shell_km: 450 }, description: "new" });
    expect(draft.analysis_period).toEqual({ start: "2026-11-12T00:00:00Z", stop: "2026-11-14T00:00:00Z" });
    expect(draft.ionosphere).toEqual({ shell_km: 450 });
    expect(draft.description).toBe("new");
    expect(draft.objects).toEqual(doc.objects);
  });
});

describe("locateField", () => {
  const pages = [
    { id: "position", fields: ["basic.position.lat_deg", "basic.position.lon_deg", "basic.position.alt_m"] },
    { id: "constraints", fields: ["constraints.elevation_angle_min_deg", "constraints.elevation_angle_max_deg"] },
    { id: "pass", fields: ["graphics2d.pass.lead_type", "graphics2d.pass.lead_time_s"] },
  ];

  test("finds the page and the field", () => {
    expect(locateField(pages, "constraints.elevation_angle_min_deg")).toEqual({ page: "constraints", field: "constraints.elevation_angle_min_deg" });
    expect(locateField(pages, "basic.position.lon_deg")).toEqual({ page: "position", field: "basic.position.lon_deg" });
  });

  test("a field that names a whole section finds the first field inside it", () => {
    expect(locateField(pages, "graphics2d.pass")).toEqual({ page: "pass", field: "graphics2d.pass.lead_type" });
    expect(locateField(pages, "basic.position")).toEqual({ page: "position", field: "basic.position.lat_deg" });
  });

  test("a field deeper than any field of a page finds that field", () => {
    expect(locateField(pages, "constraints.elevation_angle_min_deg.extra")).toEqual({ page: "constraints", field: "constraints.elevation_angle_min_deg" });
  });

  test("a field no page shows has no page", () => {
    expect(locateField(pages, "basic.norad")).toBeNull();
    expect(locateField(pages, "")).toBeNull();
  });
});
