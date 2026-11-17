import { useRef } from "react";
import type { MouseEvent } from "react";
import { buttonDir, KNOB_TOOLTIP, useKnobWheel } from "../radio/knobInput";
import type { Dir } from "../radio/knobInput";
import { rotArrow, rotCellStep, rotDigits, rotMouse } from "../radio/rotKnob";

interface Props {
  /** the angle shown, in degrees */
  value: number;
  /** the range of the knob (the limits of the rotator): a mouse press or the wheel stops there, an arrow ignores a step that overshoots */
  min: number;
  max: number;
  /** a knob that is not enabled is greyed out (Track or Monitor is on): it shows `value` and takes neither the arrows, the mouse nor the wheel */
  enabled: boolean;
  /** the user stepped a digit and `v` is the new angle (not called for a step that changes nothing; Gpredict's knob has no signal, its window polls) */
  onChange: (v: number) => void;
}

/**
 * GtkRotKnob: the sign, `%6.2f` of the angle and "°"; ▴ and ▾ above and below the hundreds, tens, units, tenths and hundredths. The cells
 * 0 to 6 of the display are the sign, three digits, the decimal point and two digits; the sign and the point only show.
 */
export function RotKnob({ value, min, max, enabled, onChange }: Props) {
  const knob = useRef<HTMLDivElement>(null);
  const { sign, digits } = rotDigits(value);
  const give = (v: number | null) => {
    if (v !== null && v !== value) onChange(v);
  };
  const mouse = (cell: number, dir: Dir) => {
    const step = rotCellStep(cell);
    if (step !== null) give(rotMouse(value, step, dir, min, max));
  };
  useKnobWheel(knob, enabled, mouse);

  const press = (cell: number) => (e: MouseEvent) => {
    e.preventDefault(); // no text selection, no autoscroll on the middle button
    const dir = buttonDir(e.button);
    if (dir !== 0) mouse(cell, dir);
  };
  const cellProps = (cell: number) =>
    enabled ? { "data-digit": cell, onMouseDown: press(cell), onContextMenu: (e: MouseEvent) => e.preventDefault() } : {};

  return (
    <div ref={knob} className="knob" role="group" aria-label={`${sign.trim()}${digits.trim()}°`} aria-disabled={!enabled}>
      {[sign, ...digits].map((c, cell) => (
        <span
          key={cell}
          className={rotCellStep(cell) === null ? "knob-xxl" : "knob-xxl knob-cell"} // the sign and the point are as narrow as their character
          style={{ gridColumn: cell + 1, gridRow: 2 }}
          title={KNOB_TOOLTIP}
          aria-hidden="true"
          {...cellProps(cell)}
        >
          {c}
        </span>
      ))}
      <span className="knob-xxl" style={{ gridColumn: 8, gridRow: 2 }} aria-hidden="true">
        °
      </span>
      {[0, 1, 2, 3, 4, 5, 6].flatMap((cell) => {
        const step = rotCellStep(cell);
        if (step === null) return [];
        return ([1, -1] as const).map((dir) => (
          <button
            key={`${cell}${dir}`}
            type="button"
            className="button flat knob-arrow"
            style={{ gridColumn: cell + 1, gridRow: dir === 1 ? 1 : 3 }}
            disabled={!enabled}
            aria-label={`${dir === 1 ? "เพิ่ม" : "ลด"} ${step}°`} // (ของเรา) Gpredict's arrows have no text but ▴ and ▾
            onClick={() => give(rotArrow(value, step, dir, min, max))}
          >
            {dir === 1 ? "▴" : "▾"}
          </button>
        ));
      })}
    </div>
  );
}
