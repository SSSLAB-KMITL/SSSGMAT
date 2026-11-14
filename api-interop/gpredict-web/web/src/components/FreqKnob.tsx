import { useRef } from "react";
import type { MouseEvent } from "react";
import { freqApply, freqDigits, freqStep, freqText, groupSeparator } from "../radio/freqKnob";
import { buttonDir, KNOB_TOOLTIP, useKnobWheel } from "../radio/knobInput";
import type { Dir } from "../radio/knobInput";

interface Props {
  /** the frequency shown, in Hz */
  hz: number;
  /** an active knob has the arrows above and below the digits and takes the mouse buttons and the wheel; a passive one only shows `hz` */
  active: boolean;
  /**
   * The user stepped a digit: `hz` moved by that digit's step. A step that would leave 0 … 9 999 999 999 is ignored, but this is still
   * called, with the unchanged `hz`, because Gpredict's "freq-changed" is emitted for every action of the user.
   */
  onChange: (hz: number) => void;
}

/** The column of each digit in Gpredict's grid (`gtk-freq-knob.c:38`): column 1 is empty, the separators are in columns 5 and 9, " Hz" in 13. */
const COLUMNS = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12];
const SEPARATORS = [5, 9];
const UNIT = 13;
const SEPARATOR = groupSeparator();

/** GtkFreqKnob: the ten digits with the locale's thousands separators and " Hz"; the active knob also has ▴ and ▾ for each digit. */
export function FreqKnob({ hz, active, onChange }: Props) {
  const knob = useRef<HTMLDivElement>(null);
  const digits = freqDigits(hz);
  const step = (digit: number, dir: Dir) => onChange(freqApply(hz, digit, dir) ?? hz);
  useKnobWheel(knob, active, step);

  const press = (digit: number) => (e: MouseEvent) => {
    e.preventDefault(); // no text selection, no autoscroll on the middle button
    const dir = buttonDir(e.button);
    if (dir !== 0) step(digit, dir);
  };
  const digitProps = (digit: number) =>
    active ? { "data-digit": digit, title: KNOB_TOOLTIP, onMouseDown: press(digit), onContextMenu: (e: MouseEvent) => e.preventDefault() } : {};

  return (
    <div ref={knob} className="knob" role="group" aria-label={freqText(hz, SEPARATOR).trim()}>
      {COLUMNS.map((col, i) => (
        <span key={col} className="knob-xxl knob-cell" style={{ gridColumn: col + 1, gridRow: 2 }} aria-hidden="true" {...digitProps(i)}>
          {digits[i]}
        </span>
      ))}
      {SEPARATORS.map((col) => (
        <span key={col} className="knob-xxl" style={{ gridColumn: col + 1, gridRow: 2 }} aria-hidden="true">
          {SEPARATOR}
        </span>
      ))}
      <span className="knob-xxl" style={{ gridColumn: UNIT + 1, gridRow: 2 }} aria-hidden="true">
        {" Hz"}
      </span>
      {active &&
        COLUMNS.flatMap((col, i) =>
          ([1, -1] as const).map((dir) => (
            <button
              key={`${i}${dir}`}
              type="button"
              className="button flat knob-arrow"
              style={{ gridColumn: col + 1, gridRow: dir === 1 ? 1 : 3 }}
              aria-label={`${dir === 1 ? "เพิ่ม" : "ลด"} ${freqStep(i).toLocaleString("en-US")} Hz`} // (ของเรา) Gpredict's arrows have no text but ▴ and ▾
              onClick={() => step(i, dir)}
            >
              {dir === 1 ? "▴" : "▾"}
            </button>
          )),
        )}
    </div>
  );
}
