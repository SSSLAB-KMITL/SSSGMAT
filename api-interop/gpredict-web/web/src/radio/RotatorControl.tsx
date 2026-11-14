import { useCallback, useId, useMemo } from "react";
import { cssRgba, POLAR_COLORS } from "../colors";
import { FloatingWindow } from "../components/FloatingWindow";
import { RotKnob } from "../components/RotKnob";
import { SatFilter } from "../components/SatFilter";
import { SpinButton } from "../components/SpinButton";
import { ToggleButton } from "../components/ToggleButton";
import { PassPolarPlot } from "../passes/PassPolarPlot";
import type { PolarScene } from "../passes/passPolar";
import { strokeSegments } from "../passes/plotCommon";
import { orientationOf } from "../views/polarGeom";
import { editedValue, fmtAngle } from "./radioView";
import { crosshair, ROT_TOOLTIPS as TIPS, rotEnabled, rotMarkers, rotTitle, SETPOINT_RADIUS, targetRect } from "./rotView";
import type { RotMarkers } from "./rotView";
import type { RotatorState } from "./types";
import { useControllerState } from "./useControllerState";

interface Props {
  /** module name */
  module: string;
  /** the newest state of the controller: the `rotator` of the module's tick. A new object replaces what the window shows */
  state: RotatorState;
  /** the Polar View's orientation of the module as its configuration holds it ("N/E/S/W", ...; N/E/S/W for another text): the plot is drawn the way the module's polar view is */
  orientation: string;
  /** the name of the station, drawn at the top left of the plot; null when the Polar View's "QTH Info" is off */
  qthName: string | null;
  /** sends one action of the window to the server (controllerAction(module, "rotator", body)) and answers the new state, which the window shows at once */
  onAction: (body: Record<string, unknown>) => Promise<RotatorState>;
  /** the window was closed: the caller closes the controller on the server and removes the window */
  onClose: () => void;
  /** when this number changes the window comes to the front: Module menu → Antenna Control while the window is open (ref-R §1) */
  raiseToken?: number;
}

/** The numbers whose steps the window keeps until the server has answered them (see useControllerState). */
type EditKey = "az" | "el" | "cycle" | "threshold";

/** The markers over the plot, all in the colour of a satellite (`col_sat`): a filled square, a circle and a cross-hair (`gtk-polar-plot.c:592-635`). */
function paintMarkers(ctx: CanvasRenderingContext2D, markers: RotMarkers): void {
  const color = cssRgba(POLAR_COLORS.satellite);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (markers.target !== null) {
    const t = targetRect(markers.target);
    ctx.fillRect(t.x, t.y, t.w, t.h);
  }
  if (markers.setpoint !== null) {
    ctx.beginPath();
    ctx.arc(markers.setpoint.x, markers.setpoint.y, SETPOINT_RADIUS, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (markers.rotor !== null) strokeSegments(ctx, crosshair(markers.rotor), color);
}

/**
 * Gpredict's Antenna Control (ref-R §5, gtk-rot-ctrl.c): the Polar plot on the left and, on the right, the grid of Azimuth, Elevation,
 * Satellite and Settings (§5.1). It is the view of a RotatorState and decides nothing: every press is sent with `onAction`, and the
 * state that comes back is shown at once and then the ticks follow. (ของเรา) A line at the bottom says in Thai why the rotator cannot
 * be used (the server's `status`, or why an action failed).
 */
export function RotatorControl({ module, state, orientation: named, qthName, onAction, onClose, raiseToken }: Props) {
  const id = useId();
  const orientation = orientationOf(named);
  const { shown, edits, problem, send, act } = useControllerState<RotatorState, EditKey>(state, onAction);

  const az = editedValue(edits.az, shown.knob.az);
  const el = editedValue(edits.el, shown.knob.el);
  const cycle = editedValue(edits.cycle, shown.cycle_ms);
  const threshold = editedValue(edits.threshold, shown.threshold_deg);
  // the set-point circle is at the knobs, so the state the markers are made from has the numbers of the knobs
  const marked = useMemo(() => ({ ...shown, setpoint: { az, el } }), [shown, az, el]);
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, scene: PolarScene) => paintMarkers(ctx, rotMarkers(marked, scene, orientation)),
    [marked, orientation],
  );

  const enabled = rotEnabled(shown);
  const { limits } = shown;

  const status = problem ?? shown.status;

  return (
    // not closed by Escape: closing disengages the rotator, and Gpredict closes the window only with its close button (ref-R §1)
    <FloatingWindow title={rotTitle(module)} onClose={onClose} closeOnEscape={false} raiseToken={raiseToken}>
      <div className="ar">
        <div className="ar-plot">
          <div className="ar-plot-fill">
            <PassPolarPlot pass={shown.pass} qthName={qthName} orientation={orientation} overlay={paint} />
          </div>
        </div>
        <div className="rc-grid ar-grid">
          <fieldset className="rc-frame">
            <legend>Azimuth</legend>
            <div className="ar-knob">
              <RotKnob
                value={az}
                min={limits.min_az}
                max={limits.max_az}
                enabled={enabled.knobs}
                onChange={(deg) => void send({ action: "az", deg }, { key: "az", value: deg })}
              />
              <span className="rc-label right">Read:</span>
              <span className="rc-value">{shown.read.az}</span>
            </div>
          </fieldset>

          <fieldset className="rc-frame">
            <legend>Elevation</legend>
            <div className="ar-knob">
              <RotKnob
                value={el}
                min={limits.min_el}
                max={limits.max_el}
                enabled={enabled.knobs}
                onChange={(deg) => void send({ action: "el", deg }, { key: "el", value: deg })}
              />
              <span className="rc-label right">{"Read: "}</span>
              <span className="rc-value">{shown.read.el}</span>
            </div>
          </fieldset>

          <fieldset className="rc-frame">
            <legend>Satellite</legend>
            <div className="ar-sat">
              <SatFilter
                sats={shown.sats}
                norad={shown.norad}
                tip={TIPS.satellite}
                className="ar-wide"
                onSelect={(norad) => act({ action: "satellite", norad })}
              />
              <ToggleButton title={TIPS.track} pressed={shown.track} disabled={!enabled.track} onToggle={(on) => act({ action: "track", on })}>
                Track
              </ToggleButton>
              <span className="rc-label right">Az:</span>
              <span className="rc-value">{fmtAngle(shown.target?.az ?? null)}</span>
              <span className="rc-label right">El:</span>
              <span className="rc-value">{fmtAngle(shown.target?.el ?? null)}</span>
              <span className="rc-label right">ΔT:</span>
              <span className="rc-value">{shown.countdown}</span>
            </div>
          </fieldset>

          <fieldset className="rc-frame">
            <legend>Settings</legend>
            <div className="rc-settings ar-settings">
              <label className="rc-label right" htmlFor={`${id}-dev`}>
                Device:
              </label>
              <select
                id={`${id}-dev`}
                title={TIPS.device}
                disabled={!enabled.device}
                value={shown.device ?? ""}
                onChange={(e) => act({ action: "device", name: e.target.value })}
              >
                {shown.devices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ToggleButton title={TIPS.engage} pressed={shown.engaged} onToggle={(on) => act({ action: "engage", on })}>
                Engage
              </ToggleButton>
              <label className="check ar-monitor" title={TIPS.monitor}>
                <input
                  type="checkbox"
                  checked={shown.monitor}
                  disabled={!enabled.monitor}
                  onChange={(e) => act({ action: "monitor", on: e.target.checked })}
                />
                Monitor
              </label>
              <label className="rc-label right" htmlFor={`${id}-cycle`}>
                Cycle:
              </label>
              <SpinButton
                id={`${id}-cycle`}
                value={cycle}
                min={10}
                max={30000}
                step={10}
                page={100}
                title={TIPS.cycle}
                onChange={(ms) => void send({ action: "cycle", ms }, { key: "cycle", value: ms })}
              />
              <span className="rc-label">msec</span>
              <label className="rc-label right" htmlFor={`${id}-threshold`}>
                Threshold:
              </label>
              <SpinButton
                id={`${id}-threshold`}
                value={threshold}
                min={0.01}
                max={50}
                step={0.01}
                page={0.1}
                digits={2}
                title={TIPS.threshold}
                onChange={(deg) => void send({ action: "threshold", deg }, { key: "threshold", value: deg })}
              />
              <span className="rc-label">deg</span>
            </div>
          </fieldset>
        </div>
      </div>
      {status !== null && (
        <p className="dialog-error rc-status" role="status">
          {status}
        </p>
      )}
    </FloatingWindow>
  );
}
