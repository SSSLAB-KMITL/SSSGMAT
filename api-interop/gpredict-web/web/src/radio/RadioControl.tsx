import { useEffect, useId, useRef } from "react";
import { FloatingWindow } from "../components/FloatingWindow";
import { FreqKnob } from "../components/FreqKnob";
import { SatFilter } from "../components/SatFilter";
import { SpinButton } from "../components/SpinButton";
import { ToggleButton } from "../components/ToggleButton";
import { useNumberFormat } from "../numfmt";
import {
  countdownSize,
  editedValue,
  ellipsize,
  fmtAngle,
  fmtDoppler,
  fmtLo,
  fmtRange,
  fmtRate,
  pttKey,
  RADIO_TOOLTIPS as TIPS,
  radioTitle,
} from "./radioView";
import type { RadioLink, RadioState } from "./types";
import { useControllerState } from "./useControllerState";

interface Props {
  /** module name */
  module: string;
  /** the newest state of the controller: the `radio` of the module's tick. A new object replaces what the window shows */
  state: RadioState;
  /** sends one action of the window to the server (controllerAction(module, "radio", body)) and answers the new state, which the window shows at once */
  onAction: (body: Record<string, unknown>) => Promise<RadioState>;
  /** the window was closed: the caller closes the controller on the server and removes the window */
  onClose: () => void;
  /** when this number changes the window comes to the front: Module menu → Radio Control while the window is open (ref-R §1) */
  raiseToken?: number;
}

/** The numbers whose steps the window keeps until the server has answered them (see useControllerState). */
type EditKey = "down" | "up" | "cycle";

const noChange = () => {};

/**
 * Gpredict's Radio Control (ref-R §2, gtk-rig-ctrl.c): Downlink and Uplink, Satellite, Settings and the count-down in the grid of §2.1.
 * It is the view of a RadioState and decides nothing: every press is sent with `onAction`, and the state that comes back is shown at once
 * and then the ticks follow. (ของเรา) A line at the bottom says in Thai why the radio cannot be used (the server's `status`, or why an action failed).
 */
export function RadioControl({ module, state, onAction, onClose, raiseToken }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const { shown, edits, problem, send, act } = useControllerState<RadioState, EditKey>(state, onAction);
  const nf = useNumberFormat(); // Range and Rate are in miles with "Use Imperial units"

  // SPACE: PTT of an FT817/857/897 (manual) radio, for a key pressed anywhere in this window (`key_press_cb`)
  const latest = useRef({ send, spacePtt: shown.space_ptt });
  useEffect(() => {
    latest.current = { send, spacePtt: shown.space_ptt };
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof Element) || root.current?.closest(".float-window")?.contains(target) !== true) return;
      const what = pttKey(e.type, e.key, latest.current.spacePtt, target.tagName, e.repeat);
      if (what === null) return;
      e.preventDefault(); // the button that has the focus is not pressed (Firefox presses it on keyup, so that is cancelled too)
      if (what === "toggle") void latest.current.send({ action: "ptt_toggle" });
    };
    document.addEventListener("keydown", key);
    document.addEventListener("keyup", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("keyup", key);
    };
  }, []);

  const down = editedValue(edits.down, shown.down.sat_hz);
  const up = editedValue(edits.up, shown.up.sat_hz);
  const cycle = editedValue(edits.cycle, shown.cycle_ms);
  const status = problem ?? shown.status;

  return (
    // not closed by Escape: closing disengages the radio, and Gpredict closes the window only with its close button (ref-R §1)
    <FloatingWindow title={radioTitle(module)} onClose={onClose} closeOnEscape={false} raiseToken={raiseToken}>
      <div ref={root} className="rc">
        <div className="rc-grid">
          <LinkFrame
            title="Downlink"
            sat={down}
            link={shown.down}
            tip={TIPS.downDoppler}
            onSat={(hz) => void send({ action: "freq", link: "down", hz }, { key: "down", value: hz })}
          />
          <LinkFrame
            title="Uplink"
            sat={up}
            link={shown.up}
            tip={TIPS.upDoppler}
            onSat={(hz) => void send({ action: "freq", link: "up", hz }, { key: "up", value: hz })}
          />

          <fieldset className="rc-frame">
            <legend>Satellite</legend>
            <div className="rc-sat">
              <SatFilter
                sats={shown.sats}
                norad={shown.norad}
                tip={TIPS.satellite}
                className="rc-wide"
                onSelect={(norad) => act({ action: "satellite", norad })}
              />
              <ToggleButton title={TIPS.track} pressed={shown.track} onToggle={(on) => act({ action: "track", on })}>
                Track
              </ToggleButton>
              <select
                className="rc-wide rc-trsp"
                title={TIPS.transponder}
                value={shown.transponder === null ? "" : String(shown.transponder)}
                onChange={(e) => act({ action: "transponder", index: Number(e.target.value) })}
              >
                {shown.transponders.map((name, i) => (
                  // the same name can be in the list twice, so the index is the value
                  <option key={i} value={i}>
                    {ellipsize(name)}
                  </option>
                ))}
              </select>
              <div className="rc-tl">
                <button type="button" className="button" title={TIPS.tune} onClick={() => act({ action: "tune" })}>
                  T
                </button>
                <ToggleButton title={TIPS.lock} pressed={shown.lock} onToggle={(on) => act({ action: "lock", on })}>
                  L
                </ToggleButton>
              </div>
              <span className="rc-label right">Az:</span>
              <span className="rc-value">{fmtAngle(shown.az)}</span>
              <span className="rc-label right" title={TIPS.range}>
                {" Range:"}
              </span>
              <span className="rc-value" title={TIPS.range}>
                {fmtRange(shown.range_km, nf)}
              </span>
              <span className="rc-label right">El:</span>
              <span className="rc-value">{fmtAngle(shown.el)}</span>
              <span className="rc-label right" title={TIPS.rate}>
                {" Rate:"}
              </span>
              <span className="rc-value" title={TIPS.rate}>
                {fmtRate(shown.rate_kms, nf)}
              </span>
            </div>
          </fieldset>

          <fieldset className="rc-frame">
            <legend>Settings</legend>
            <div className="rc-settings">
              <label className="rc-label right" htmlFor={`${id}-dev1`}>
                1. Device:
              </label>
              <select
                id={`${id}-dev1`}
                title={TIPS.device1}
                disabled={shown.engaged}
                value={shown.device1 ?? ""}
                onChange={(e) => act({ action: "device1", name: e.target.value })}
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
              <label className="rc-label right" htmlFor={`${id}-dev2`}>
                2. Device:
              </label>
              <select
                id={`${id}-dev2`}
                title={TIPS.device2}
                disabled={shown.engaged}
                value={shown.device2}
                onChange={(e) => act({ action: "device2", name: e.target.value })}
              >
                {shown.devices2.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {/* Gpredict's grid has an empty row here; an empty row of a GtkGrid takes no room, so there is none here either */}
              <label className="rc-label right rc-cycle-label" htmlFor={`${id}-cycle`}>
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
            </div>
          </fieldset>

          <fieldset className="rc-frame rc-countdown-frame">
            <div className={`rc-countdown ${countdownSize(shown.countdown)}`} title={TIPS.countdown}>
              {shown.countdown}
            </div>
          </fieldset>
        </div>
        {status !== null && (
          <p className="dialog-error rc-status" role="status">
            {status}
          </p>
        )}
      </div>
    </FloatingWindow>
  );
}

interface LinkProps {
  /** "Downlink" or "Uplink" */
  title: string;
  /** the satellite's frequency as the knob shows it, in Hz */
  sat: number;
  link: RadioLink;
  /** the tooltip of "Doppler:" */
  tip: string;
  onSat: (hz: number) => void;
}

/** The Downlink and Uplink frames (ref-R §2.2): the satellite's frequency (a knob to turn), Doppler and LO, and the radio's frequency (a knob that only shows). */
function LinkFrame({ title, sat, link, tip, onSat }: LinkProps) {
  return (
    <fieldset className="rc-frame">
      <legend className="rc-legend">
        <b>{` ${title} `}</b>
      </legend>
      <div className="rc-link">
        <div className="rc-knob">
          <FreqKnob hz={sat} active onChange={onSat} />
        </div>
        <div className="rc-doppler">
          <span className="rc-label right" title={tip}>
            Doppler:
          </span>
          <span className="rc-value">{fmtDoppler(link.doppler_hz)}</span>
          <span className="rc-label right rc-lo">LO:</span>
          <span className="rc-value">{fmtLo(link.lo_mhz)}</span>
        </div>
        <div className="rc-radio">
          <span className="rc-radio-label">Radio:</span>
          <div className="rc-knob">
            <FreqKnob hz={link.radio_hz} active={false} onChange={noChange} />
          </div>
        </div>
      </div>
    </fieldset>
  );
}
