import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { errorText } from "../api";
import { cssRgba, POLAR_COLORS } from "../colors";
import { FloatingWindow } from "../components/FloatingWindow";
import { RotKnob } from "../components/RotKnob";
import { SpinButton } from "../components/SpinButton";
import { ToggleButton } from "../components/ToggleButton";
import { PassPolarPlot } from "../passes/PassPolarPlot";
import type { PolarScene } from "../passes/passPolar";
import { strokeSegments } from "../passes/plotCommon";
import type { Orientation } from "../views/polarGeom";
import { beginEdit, editedValue, FILTER_DELAY_MS, filterSats, finishEdit, fmtAngle } from "./radioView";
import type { Edit } from "./radioView";
import { crosshair, ROT_TOOLTIPS as TIPS, rotEnabled, rotMarkers, rotTitle, SETPOINT_RADIUS, targetRect } from "./rotView";
import type { RotMarkers } from "./rotView";
import type { RotatorState } from "./types";

interface Props {
  /** module name */
  module: string;
  /** the newest state of the controller: the `rotator` of the module's tick. A new object replaces what the window shows */
  state: RotatorState;
  /** the Polar View's orientation of the module: the plot is drawn the way the module's polar view is */
  orientation: Orientation;
  /** the name of the station, drawn at the top left of the plot; null when the Polar View's "QTH Info" is off */
  qthName: string | null;
  /** sends one action of the window to the server (controllerAction(module, "rotator", body)) and answers the new state, which the window shows at once */
  onAction: (body: Record<string, unknown>) => Promise<RotatorState>;
  /** the window was closed: the caller closes the controller on the server and removes the window */
  onClose: () => void;
}

/** The numbers whose steps the window keeps until the server has answered them (see radioView.ts, Edit). */
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
export function RotatorControl({ module, state, orientation, qthName, onAction, onClose }: Props) {
  const id = useId();
  const [seen, setSeen] = useState(state);
  const [shown, setShown] = useState(state);
  const [edits, setEdits] = useState<Partial<Record<EditKey, Edit>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterTimer = useRef<number | undefined>(undefined);
  const requests = useRef({ sent: 0, applied: 0 });

  if (seen !== state) {
    // a tick: show it. The numbers of an edit that has no answer yet are kept (editedValue)
    setSeen(state);
    setShown(state);
  }

  /**
   * One action. An answer that is older than one already shown is dropped (two requests can come back in the other order). `edit` is a
   * number the user made with it: shown until the last of its requests is answered, whatever a tick says in the meantime.
   */
  const send = async (body: Record<string, unknown>, edit?: { key: EditKey; value: number }) => {
    const n = ++requests.current.sent;
    setProblem(null);
    if (edit !== undefined) setEdits((e) => ({ ...e, [edit.key]: beginEdit(e[edit.key], edit.value) }));
    try {
      const next = await onAction(body);
      if (n > requests.current.applied) {
        requests.current.applied = n;
        setShown(next);
      }
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      if (edit !== undefined) setEdits((e) => ({ ...e, [edit.key]: finishEdit(e[edit.key]) }));
    }
  };
  const act = (body: Record<string, unknown>) => void send(body);
  useEffect(() => () => window.clearTimeout(filterTimer.current), []);

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

  const sats = filterSats(shown.sats, filter);
  const satInList = sats.some((s) => s.norad === shown.norad);
  const enabled = rotEnabled(shown);
  const { limits } = shown;

  /** "search-changed": the combo is refilled and the first match is selected (`filter_text_changed_cb`) */
  const changeFilter = (text: string) => {
    setFilter(text);
    window.clearTimeout(filterTimer.current);
    const all = shown.sats;
    filterTimer.current = window.setTimeout(() => {
      const first = filterSats(all, text)[0];
      if (first !== undefined) void send({ action: "satellite", norad: first.norad });
    }, FILTER_DELAY_MS);
  };

  const status = problem ?? shown.status;

  return (
    <FloatingWindow title={rotTitle(module)} onClose={onClose}>
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
              <input
                type="search"
                className="ar-wide"
                placeholder="Filter..."
                aria-label="Filter..."
                value={filter}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => changeFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && filter !== "") {
                    e.preventDefault(); // GtkSearchEntry clears itself on Escape; the window stays
                    changeFilter("");
                  }
                }}
              />
              <select
                className="ar-wide"
                title={TIPS.satellite}
                value={satInList ? String(shown.norad) : ""}
                onChange={(e) => act({ action: "satellite", norad: Number(e.target.value) })}
              >
                {!satInList && <option value="" disabled hidden />}
                {sats.map((s) => (
                  <option key={s.norad} value={s.norad}>
                    {s.name}
                  </option>
                ))}
              </select>
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
