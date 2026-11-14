import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorText, getClock, putClock, resetClock } from "../api";
import { ClockSender } from "../clockSender";
import type { ClockOp } from "../clockSender";
import { useNumberFormat } from "../numfmt";
import {
  applyEdit,
  changeField,
  composeTime,
  displayFields,
  failEdit,
  INITIAL_MODEL,
  observeClock,
  SLIDER_MAX_DAYS,
  SLIDER_STEP_DAYS,
  sliderToDays,
  SPIN_MAX,
  THROTTLE_MAX,
  THROTTLE_MIN,
} from "../timeCtl";
import type { ClockModel, SpinField, TimeFields } from "../timeCtl";
import type { ClockState, Tick } from "../types";
import { Calendar } from "./Calendar";
import { FloatingWindow } from "./FloatingWindow";
import { SpinButton } from "./SpinButton";

interface Props {
  /** module name */
  module: string;
  /** newest tick of the module, null before the first one */
  tick: Tick | null;
  /** the window was closed: the clock has been sent back to real time and throttle 1 (ref §9), the caller removes the window */
  onClose: () => void;
  /** the reset of closing failed (the window is gone by then): the caller shows the Thai text */
  onResetFailed?: (text: string) => void;
}

/** Strings of the window, as in Gpredict (ref §9, gtk-sat-module-tmg.c). */
const TITLE = "Time Controller";
const SPINS: { field: SpinField; id: string; label: string; tip: string }[] = [
  { field: "h", id: "hour", label: "Hour:", tip: "Use this control to set the hour" },
  { field: "m", id: "min", label: "Min:", tip: "Use this control to set the minutes" },
  { field: "s", id: "sec", label: "Sec:", tip: "Use this control to set the seconds" },
  { field: "ms", id: "msec", label: "Msec:", tip: "Use this control to set the milliseconds" },
];
const THROTTLE_LABEL = "Throttle:";
const THROTTLE_TIP = "Time throttle / compression factor";
const RESET_LABEL = "Reset";
const RESET_TIP = "Reset to current date and time";
const STATE_AT_START = "Real-Time";

/** (ของเรา) shown when the controls compose a time JavaScript cannot represent */
const BAD_TIME = "เวลาที่ตั้งไม่ถูกต้อง";

function opBody(state: ClockState, throttle: number) {
  return state === "stop" ? { state } : { state, throttle };
}

/**
 * The Time Controller of one module (ref §9, spec §8.9): a calendar, Hour, Min, Sec, Msec and Throttle spin buttons, a
 * slider of ±0.1 day, the state label, Reset and the three buttons Play backwards, Stop and Play forward.
 *
 * While the clock runs the calendar and the spin buttons show the module time of the live ticks and cannot be changed.
 * While it is stopped they are the time, together with the slider's offset: every change sends {state: "stop", time}.
 * The calendar and the spin buttons are in UTC, or in the machine's time zone when "Show local time instead of UTC." is on (ref-D §2.1).
 * Moving the slider while the clock runs stops it. Closing the window resets the clock (Reset, throttle 1).
 * Give it `key={module}`: the window follows one module.
 */
export function TimeController({ module, tick, onClose, onResetFailed }: Props) {
  const [model, setModel] = useState<ClockModel>(INITIAL_MODEL);
  const [error, setError] = useState<string | null>(null);
  const sender = useRef<ClockSender | null>(null);

  // the requests, and the first GET of the clock
  useEffect(() => {
    let alive = true;
    const run = (op: ClockOp) => (op.kind === "reset" ? resetClock(module) : putClock(module, op.body));
    const resync = () =>
      getClock(module).then(
        (c) => {
          if (alive && !s.busy) setModel((m) => observeClock(m, c, new Date(c.time)));
        },
        () => undefined, // the error of the request that failed is already on screen
      );
    const s = new ClockSender({
      run,
      // only the newest answer counts: an older one would move the controls back while the user is still dragging
      onResult: (_op, clock, idle) => {
        if (idle) setModel((m) => observeClock(m, clock, new Date(clock.time)));
      },
      onError: (_op, e, idle) => {
        setError(errorText(e));
        setModel(failEdit);
        if (idle) void resync();
      },
    });
    sender.current = s;
    getClock(module).then(
      (c) => {
        if (alive) setModel((m) => observeClock(m, c, new Date(c.time)));
      },
      (e) => {
        if (alive) setError(errorText(e));
      },
    );
    return () => {
      alive = false;
      s.dispose();
    };
  }, [module]);

  // the live tick; not while a request is on its way (the tick may have left before it)
  useEffect(() => {
    if (tick === null || sender.current?.busy === true) return;
    setModel((m) => observeClock(m, tick.clock, new Date(tick.t)));
  }, [tick]);

  const close = () => {
    sender.current?.finish().catch((e) => onResetFailed?.(errorText(e)));
    onClose();
  };

  const state = model.clock?.state ?? "forward"; // Play forward is active when the window opens
  const stopped = model.clock?.state === "stop";
  const { local } = useNumberFormat();
  const fields = displayFields(model, new Date(), local);

  const send = (op: ClockOp) => {
    setError(null);
    sender.current?.send(op);
  };

  /** the user set the fields and/or the slider: the clock stops at the time they compose */
  const commit = (next: TimeFields, slider: number) => {
    const time = composeTime(next.day, next.h, next.m, next.s, next.ms, slider, local);
    if (Number.isNaN(time.getTime())) {
      setError(BAD_TIME);
      return;
    }
    setModel((m) => applyEdit(m, next, slider, local));
    send({ kind: "put", body: { state: "stop", time: time.toISOString() } });
  };

  const setThrottle = (value: number) => {
    setModel((m) => ({ ...m, throttle: value }));
    send({ kind: "put", body: { throttle: value } });
  };

  const play = (to: ClockState) => {
    if (model.clock !== null && model.clock.state === to) return;
    send({ kind: "put", body: opBody(to, model.throttle) });
  };

  const reset = () => {
    setModel((m) => ({ ...m, slider: 0 }));
    send({ kind: "reset" });
  };

  const label = model.clock?.label ?? STATE_AT_START;

  return (
    <FloatingWindow title={`${TITLE} / ${module}`} onClose={close} width={440}>
      <div className="tc">
        <div className="tc-top">
          <Calendar value={fields.day} readOnly={!stopped} onChange={(day) => commit({ ...fields, day }, model.slider)} />
          <div className="tc-spins">
            {SPINS.map(({ field, id, label: text, tip }) => (
              <Row key={id} htmlFor={`tc-${id}`} label={text}>
                <SpinButton
                  id={`tc-${id}`}
                  value={fields[field]}
                  min={0}
                  max={SPIN_MAX[field]}
                  wrap
                  readOnly={!stopped}
                  title={tip}
                  onChange={(value, carry) => commit(changeField(fields, field, value, carry), model.slider)}
                />
              </Row>
            ))}
            <Row htmlFor="tc-throttle" label={THROTTLE_LABEL}>
              <SpinButton
                id="tc-throttle"
                value={model.throttle}
                min={THROTTLE_MIN}
                max={THROTTLE_MAX}
                title={THROTTLE_TIP}
                onChange={setThrottle}
              />
            </Row>
          </div>
        </div>
        <input
          type="range"
          className="tc-slider"
          aria-label="Time offset"
          min={-SLIDER_MAX_DAYS}
          max={SLIDER_MAX_DAYS}
          step={SLIDER_STEP_DAYS}
          value={model.slider}
          onChange={(e) => commit(fields, sliderToDays(Number(e.target.value)))}
        />
        {error !== null && (
          <div className="tc-error" role="alert">
            {error}
          </div>
        )}
        <hr className="tc-separator" />
        <div className="tc-buttons">
          <strong className="tc-state">{label}</strong>
          <button type="button" className="button tc-reset" title={RESET_TIP} onClick={reset}>
            {RESET_LABEL}
          </button>
          <div className="tc-toggles" role="group" aria-label="Clock direction">
            <Toggle title="Play backwards" pressed={state === "backward"} onClick={() => play("backward")}>
              <path d="M8 3L2 8l6 5zM14 3L8 8l6 5z" />
            </Toggle>
            <Toggle title="Stop" pressed={state === "stop"} onClick={() => play("stop")}>
              <path d="M4 3h3v10H4zM9 3h3v10H9z" />
            </Toggle>
            <Toggle title="Play forward" pressed={state === "forward"} onClick={() => play("forward")}>
              <path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" />
            </Toggle>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}

/** One line of the spin buttons: the label to the right, as in Gpredict. */
function Row({ htmlFor, label, children }: { htmlFor: string; label: string; children: ReactNode }) {
  return (
    <>
      <label className="tc-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </>
  );
}

/** A toggle button of the row at the bottom: an icon (Gpredict's media-seek-* and media-playback-pause) and a tooltip. */
function Toggle({ title, pressed, onClick, children }: { title: string; pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={pressed ? "button tc-toggle active" : "button tc-toggle"}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
