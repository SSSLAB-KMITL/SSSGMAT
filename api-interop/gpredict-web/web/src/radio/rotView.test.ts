import { describe, expect, it } from "vitest";
import { POLAR_ORIENTATIONS } from "../views/polarGeom";
import { crosshair, ROT_TOOLTIPS, rotEnabled, rotMarkers, rotTitle, SETPOINT_RADIUS, targetRect, TARGET_SIZE } from "./rotView";
import type { RotatorState } from "./types";

/** A canvas of 200 x 200 px: centre (100, 100), radius 200/2 - 20 = 80 (ref-R §5.6). */
const SIZE = { width: 200, height: 200 };
const [CX, CY, R] = [100, 100, 80];

/** An Antenna Control state before Engage: the knobs at their start values, nothing read, nothing tracked. */
function rotState(over: Partial<RotatorState> = {}): RotatorState {
  return {
    devices: ["ROTOR-1"],
    device: "ROTOR-1",
    engaged: false,
    track: false,
    monitor: false,
    monitor_enabled: true,
    knobs_enabled: true,
    cycle_ms: 1000,
    threshold_deg: 5,
    sats: [{ norad: 25544, name: "ISS (ZARYA)" }],
    norad: 25544,
    knob: { az: 180, el: 45 },
    limits: { min_az: 0, max_az: 360, min_el: 0, max_el: 90, az_type: 0 },
    target: null,
    countdown: "00:00:00",
    read: { az: " --- ", el: " --- " },
    setpoint: { az: 180, el: 45 },
    rotor: null,
    pass: null,
    status: null,
    ...over,
  };
}

const LIMITS_180 = { min_az: -180, max_az: 180, min_el: 0, max_el: 90, az_type: 1 };

describe("rotMarkers", () => {
  it("markers on the plot", () => {
    // the set-point (90, 0) is on the rim, to the right: the east end of the horizontal axis, r = 80 from the centre
    const m = rotMarkers(rotState({ setpoint: { az: 90, el: 0 }, target: { az: 0, el: 90 } }), SIZE, "N/E/S/W");
    expect(m.setpoint!.x).toBeCloseTo(CX + R, 9);
    expect(m.setpoint!.y).toBeCloseTo(CY, 9);
    // the target (0, 90) is the zenith: the centre
    expect(m.target!.x).toBeCloseTo(CX, 9);
    expect(m.target!.y).toBeCloseTo(CY, 9);
    // El 1 is one ninetieth of the radius inside the rim
    const up = rotMarkers(rotState({ target: { az: 0, el: 1 } }), SIZE, "N/E/S/W");
    expect(up.target!.x).toBeCloseTo(CX, 9);
    expect(up.target!.y).toBeCloseTo(CY - (R * 89) / 90, 9);
  });

  it("the target is hidden below the horizon and while there is none", () => {
    expect(rotMarkers(rotState({ target: { az: 45, el: -1 } }), SIZE, "N/E/S/W").target).toBeNull();
    expect(rotMarkers(rotState({ target: null }), SIZE, "N/E/S/W").target).toBeNull();
    // El 0 is on the horizon: shown (Gpredict hides only El < 0)
    const rim = rotMarkers(rotState({ target: { az: 180, el: 0 } }), SIZE, "N/E/S/W").target!;
    expect(rim.x).toBeCloseTo(CX, 9);
    expect(rim.y).toBeCloseTo(CY + R, 9);
  });

  it("the markers follow the orientation of the Polar View", () => {
    // the letters of an orientation are what is at the top, right, bottom and left: east (90) is on the right in N/E/S/W and S/E/N/W
    const east = rotState({ setpoint: { az: 90, el: 0 } });
    const at = (o: (typeof POLAR_ORIENTATIONS)[number]) => rotMarkers(east, SIZE, o).setpoint!;
    expect(at("N/E/S/W").x).toBeCloseTo(CX + R, 9);
    expect(at("N/W/S/E").x).toBeCloseTo(CX - R, 9);
    expect(at("S/E/N/W").x).toBeCloseTo(CX + R, 9);
    expect(at("S/W/N/E").x).toBeCloseTo(CX - R, 9);
    // and north (0) is at the top in N/E/S/W and N/W/S/E, at the bottom in the other two
    const north = rotState({ setpoint: { az: 0, el: 0 } });
    const top = (o: (typeof POLAR_ORIENTATIONS)[number]) => rotMarkers(north, SIZE, o).setpoint!.y;
    expect(top("N/E/S/W")).toBeCloseTo(CY - R, 9);
    expect(top("N/W/S/E")).toBeCloseTo(CY - R, 9);
    expect(top("S/E/N/W")).toBeCloseTo(CY + R, 9);
    expect(top("S/W/N/E")).toBeCloseTo(CY + R, 9);
  });

  it("negative azimuth shifted", () => {
    // a -180...+180 rotator at -90 is drawn where 270 is (west), as gtk-rot-ctrl.c adds 360 before it hands the position to the plot
    const west = rotMarkers(rotState({ setpoint: { az: 270, el: 0 } }), SIZE, "N/E/S/W").setpoint!;
    const shifted = rotMarkers(rotState({ limits: LIMITS_180, setpoint: { az: -90, el: 0 } }), SIZE, "N/E/S/W").setpoint!;
    expect(shifted.x).toBeCloseTo(west.x, 9);
    expect(shifted.y).toBeCloseTo(west.y, 9);
    expect(shifted.x).toBeCloseTo(CX - R, 9);
    // the rotor and the target are shifted the same way
    const rotor = rotMarkers(rotState({ limits: LIMITS_180, engaged: true, rotor: { az: -90, el: 0 } }), SIZE, "N/E/S/W").rotor!;
    expect(rotor.x).toBeCloseTo(CX - R, 9);
    const target = rotMarkers(rotState({ limits: LIMITS_180, target: { az: -90, el: 0 } }), SIZE, "N/E/S/W").target!;
    expect(target.x).toBeCloseTo(CX - R, 9);
  });

  it("a negative azimuth of a 0...360 rotator is not shifted, and the plot leaves it out like Gpredict's (az >= 0)", () => {
    expect(rotMarkers(rotState({ setpoint: { az: -90, el: 0 } }), SIZE, "N/E/S/W").setpoint).toBeNull();
  });

  it("the set-point circle is hidden when the knob is below the horizon (Min El goes down to -10)", () => {
    expect(rotMarkers(rotState({ setpoint: { az: 90, el: -5 } }), SIZE, "N/E/S/W").setpoint).toBeNull();
    expect(rotMarkers(rotState({ setpoint: { az: 90, el: 0 } }), SIZE, "N/E/S/W").setpoint).not.toBeNull();
  });

  it("rotor only while engaged without error", () => {
    const rotor = { az: 180, el: 0 };
    const at = (over: Partial<RotatorState>) => rotMarkers(rotState({ rotor, ...over }), SIZE, "N/E/S/W").rotor;
    const on = at({ engaged: true, read: { az: "180.00°", el: "0.00°" } })!;
    expect(on.x).toBeCloseTo(CX, 9);
    expect(on.y).toBeCloseTo(CY + R, 9);
    expect(at({ engaged: false })).toBeNull(); // not engaged
    expect(at({ engaged: true, read: { az: "ERROR", el: "ERROR" } })).toBeNull(); // the rotator cannot be read
    expect(at({ engaged: true, rotor: null })).toBeNull(); // nothing read yet
    expect(at({ engaged: true, rotor: { az: 10, el: -1 } })).toBeNull(); // Gpredict draws it at El >= 0 only
  });

  it("is the centre and radius the plot draws: a plot of 300 x 250 has r = 105", () => {
    const m = rotMarkers(rotState({ setpoint: { az: 90, el: 0 } }), { width: 300, height: 250 }, "N/E/S/W");
    expect(m.setpoint!.x).toBeCloseTo(150 + 105, 9);
    expect(m.setpoint!.y).toBeCloseTo(125, 9);
  });
});

describe("marker shapes (ref-R §5.6, gtk-polar-plot.c)", () => {
  it("the target is a filled square of 4 x 4 px around its point", () => {
    expect(TARGET_SIZE).toBe(4);
    expect(targetRect({ x: 50, y: 60 })).toEqual({ x: 48, y: 58, w: 4, h: 4 });
  });

  it("the set-point circle has a radius of 7 px", () => {
    expect(SETPOINT_RADIUS).toBe(7);
  });

  it("the rotor is four strokes of 10 px that begin 4 px from the point and end 14 px from it", () => {
    expect(crosshair({ x: 50, y: 60 })).toEqual([
      { x1: 50, y1: 56, x2: 50, y2: 46 }, // up
      { x1: 54, y1: 60, x2: 64, y2: 60 }, // right
      { x1: 50, y1: 64, x2: 50, y2: 74 }, // down
      { x1: 46, y1: 60, x2: 36, y2: 60 }, // left
    ]);
  });
});

describe("rotEnabled", () => {
  it("monitor and knobs enabled flags come from the server", () => {
    // the server decides when "Monitor" is re-evaluated (only when Track or Engage change, ref-R §6.1): the web does not work it out
    const a = rotEnabled(rotState({ track: true, monitor_enabled: true, knobs_enabled: true }));
    expect(a.monitor).toBe(true);
    expect(a.knobs).toBe(true);
    const b = rotEnabled(rotState({ track: false, engaged: false, monitor_enabled: false, knobs_enabled: false }));
    expect(b.monitor).toBe(false);
    expect(b.knobs).toBe(false);
  });

  it("Track is greyed while Monitor is on, and Device while engaged", () => {
    expect(rotEnabled(rotState({ monitor: true })).track).toBe(false);
    expect(rotEnabled(rotState({ monitor: false })).track).toBe(true);
    expect(rotEnabled(rotState({ engaged: true })).device).toBe(false);
    expect(rotEnabled(rotState({ engaged: false })).device).toBe(true);
  });
});

describe("window", () => {
  it("the title has the name of the module after the colon", () => {
    expect(rotTitle("Amateur")).toBe("Gpredict Rotator Control: Amateur");
  });

  it("every tooltip is Gpredict's text (ref-R §5.4 and §5.5)", () => {
    expect(ROT_TOOLTIPS).toEqual({
      satellite: "Select target object",
      track: "Track the satellite when it is within range",
      device: "Select antenna rotator device",
      engage: "Engage the selected rotor device",
      monitor: "Monitor rotator but do not send any position commands",
      cycle: "This parameter controls the delay between commands sent to the rotator.",
      threshold:
        "This parameter sets the threshold that triggers new motion command to the rotator.\n" +
        "If the difference between the target and rotator values is smaller than the threshold, no new commands are sent",
    });
  });
});
