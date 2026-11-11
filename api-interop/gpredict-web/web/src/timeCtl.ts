// Pure logic of the Time Controller window (ref §9, gtk-sat-module-tmg.c): the wrap and carry of the spin buttons, the
// time composed from the controls, the calendar grid, and what the controls show. No DOM, no React.

import type { ClockInfo } from "./types";

export const THROTTLE_MIN = 1;
export const THROTTLE_MAX = 100;
/** The slider: -0.1 ... +0.1 day in steps of 0.0001 day (about 8.6 s), no label (ref §9). */
export const SLIDER_MAX_DAYS = 0.1;
export const SLIDER_STEP_DAYS = 0.0001;
const SLIDER_STEPS_PER_DAY = 10_000;

/** State label of the stopped clock (the server sends the same text, Gpredict "<b>Manual Control</b>"). */
export const LABEL_MANUAL = "Manual Control";

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------- spin buttons

/**
 * Wrap a value that stepped outside [min, max] back into the range, as a GtkSpinButton with wrap on: Sec 60 gives 0 and
 * carries +1 to Min, Hour -1 gives 23 and carries -1 to the calendar day, Msec 1000 gives 0 and carries +1 to Sec.
 * `carry` is the number of whole turns (it is more than 1 only for a step bigger than the range).
 */
export function wrapSpin(value: number, min: number, max: number): { value: number; carry: number } {
  const span = max - min + 1;
  const carry = Math.floor((value - min) / span);
  return { value: value - carry * span, carry };
}

// ---------------------------------------------------------------- the time of the controls

/** A UTC time from its parts; also right for the years below 100, which `Date.UTC` would move to 19xx. */
function utc(year: number, month: number, date: number, h = 0, m = 0, s = 0, ms = 0): Date {
  const t = new Date(0);
  t.setUTCFullYear(year, month, date);
  t.setUTCHours(h, m, s, ms);
  return t;
}

/** The calendar day (UTC midnight) of a time. */
export function dayOf(t: Date): Date {
  return utc(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

function addDays(day: Date, n: number): Date {
  return utc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + n);
}

/**
 * The time the controls stand for (UTC): the calendar day (only its date counts), Hour, Min, Sec, Msec, and the slider's
 * offset in days (Gpredict's `calculate_time` plus `tmgCdnum = jd + slider`). A value outside its range is carried
 * on by Date, so 0.1 day is +8640 s. An invalid `day` gives an invalid Date.
 */
export function composeTime(day: Date, h: number, m: number, s: number, ms: number, sliderDays: number): Date {
  const base = utc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, s, ms);
  return new Date(base.getTime() + Math.round(sliderDays * MS_PER_DAY));
}

/** The slider's value as the time offset: kept in its range and rounded to its step, without float noise. */
export function sliderToDays(value: number): number {
  const clamped = Math.max(-SLIDER_MAX_DAYS, Math.min(SLIDER_MAX_DAYS, value));
  return Math.round(clamped * SLIDER_STEPS_PER_DAY) / SLIDER_STEPS_PER_DAY + 0; // + 0 turns -0 into 0
}

/** The calendar day and the four spin buttons. */
export interface TimeFields {
  /** UTC midnight of the calendar's day */
  day: Date;
  h: number;
  m: number;
  s: number;
  ms: number;
}

export function fieldsFromTime(t: Date): TimeFields {
  return {
    day: dayOf(t),
    h: t.getUTCHours(),
    m: t.getUTCMinutes(),
    s: t.getUTCSeconds(),
    ms: t.getUTCMilliseconds(),
  };
}

export type SpinField = "h" | "m" | "s" | "ms";

/** Range of each spin button (ref §9). */
export const SPIN_MAX: Record<SpinField, number> = { h: 23, m: 59, s: 59, ms: 999 };

const UPWARDS: readonly SpinField[] = ["ms", "s", "m", "h"];

/**
 * A spin button got `value` (already wrapped into its range) and `carry` whole turns: pass the turns on to the next
 * button, and from Hour to the calendar day. This is Gpredict's chain of `tmg_msec_wrap` ... `tmg_hour_wrap`:
 * Sec 59 -> 0 at 10:59 gives Min 0 and Hour 11, and at 23:59 it gives the next day.
 */
export function changeField(fields: TimeFields, field: SpinField, value: number, carry: number): TimeFields {
  const next: TimeFields = { ...fields, [field]: value };
  let c = carry;
  for (let i = UPWARDS.indexOf(field) + 1; i < UPWARDS.length && c !== 0; i++) {
    const upper = UPWARDS[i]!;
    const wrapped = wrapSpin(next[upper] + c, 0, SPIN_MAX[upper]);
    next[upper] = wrapped.value;
    c = wrapped.carry;
  }
  if (c !== 0) next.day = addDays(next.day, c);
  return next;
}

// ---------------------------------------------------------------- calendar (stands in for GtkCalendar)

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Day names of the calendar's header, Sunday first (the default of GtkCalendar). */
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The 6 weeks (42 days, UTC midnight) a month page shows: from the Sunday on or before the 1st of `day`'s month. */
export function monthGrid(day: Date): Date[] {
  const first = utc(day.getUTCFullYear(), day.getUTCMonth(), 1);
  const start = addDays(first, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** `n` months from `day`, on the same day of the month, or the last day of a shorter month (GtkCalendar's month arrows). */
export function shiftMonth(day: Date, n: number): Date {
  const total = day.getUTCFullYear() * 12 + day.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = utc(year, month + 1, 0).getUTCDate();
  return utc(year, month, Math.min(day.getUTCDate(), last));
}

export function shiftYear(day: Date, n: number): Date {
  return shiftMonth(day, 12 * n);
}

// ---------------------------------------------------------------- what the window knows about the clock

/**
 * Everything the window shows, and the one place it is kept (React holds one of these).
 * - `clock`, `time`: the newest state and module time, from the GET, the answers of our own requests and the ticks.
 * - `edit`, `slider`: what the user set while the clock was stopped. The fields below are not the module time then: the
 *   time is these fields plus the slider's offset (ref §9, "when stopped, time comes from the calendar, the spinners and
 *   the slider offset"). The edit counts only as long as it composes to the module time, so a failed request or a
 *   change from another browser tab shows the real time.
 * - `throttle`: the value of the Throttle spin button.
 */
export interface ClockModel {
  clock: ClockInfo | null;
  time: Date | null;
  edit: TimeFields | null;
  /** slider offset in days */
  slider: number;
  throttle: number;
}

export const INITIAL_MODEL: ClockModel = { clock: null, time: null, edit: null, slider: 0, throttle: THROTTLE_MIN };

/**
 * A state and time of the clock arrived (the GET, the answer of a request, or a tick). The Throttle spin button follows
 * the clock's throttle only when that changed (Reset, another browser tab), and only if `syncThrottle`: it must not
 * jump back while the user is stepping it and older answers are still arriving.
 */
export function observeClock(m: ClockModel, info: ClockInfo, time: Date, syncThrottle = true): ClockModel {
  const changed = m.clock === null || m.clock.throttle !== info.throttle;
  return { ...m, clock: info, time, throttle: syncThrottle && changed ? info.throttle : m.throttle };
}

/** The user set the fields and the slider (the request {state: "stop", time} is sent): show it at once, as stopped. */
export function applyEdit(m: ClockModel, fields: TimeFields, slider: number): ClockModel {
  const time = composeTime(fields.day, fields.h, fields.m, fields.s, fields.ms, slider);
  const clock: ClockInfo = { state: "stop", throttle: m.clock?.throttle ?? m.throttle, label: LABEL_MANUAL };
  return { ...m, clock, time, edit: fields, slider };
}

/** A request failed: forget what the user set, centre the slider and take the throttle back from the clock. */
export function failEdit(m: ClockModel): ClockModel {
  return { ...m, edit: null, slider: 0, throttle: m.clock?.throttle ?? m.throttle };
}

/** Two times this close (ms) are the same: the server rounds a time to the millisecond. */
const SAME_TIME_MS = 2;

/**
 * The calendar day and spin buttons to show. While the clock runs they follow the module time with the milliseconds
 * cut off (Gpredict: "msec: always 0 in RT and SRT modes"). While it is stopped they show what the user set, as long as
 * that is still the module time, else the module time itself. `fallback` is used before any time is known.
 */
export function displayFields(m: ClockModel, fallback: Date): TimeFields {
  const time = m.time ?? fallback;
  if (m.clock?.state === "stop") {
    if (m.edit !== null && m.time !== null) {
      const composed = composeTime(m.edit.day, m.edit.h, m.edit.m, m.edit.s, m.edit.ms, m.slider);
      if (Math.abs(composed.getTime() - m.time.getTime()) <= SAME_TIME_MS) return m.edit;
    }
    return fieldsFromTime(time);
  }
  return fieldsFromTime(new Date(Math.floor(time.getTime() / 1000) * 1000));
}
