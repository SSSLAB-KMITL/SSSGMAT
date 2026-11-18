import { useState } from "react";
import type { KeyboardEvent } from "react";
import { formatSpin, parseSpinText, stepSpin } from "../spin";
import { wrapSpin } from "../timeCtl";

interface Props {
  /** id of the text field, for the <label htmlFor> */
  id: string;
  value: number;
  min: number;
  max: number;
  /** stepping past an end wraps round to the other end and reports the carry; without it the value stops at the end */
  wrap?: boolean;
  /** a step or a typed number gave `value`; `carry` is the whole turns of a wrap (0 for a typed number) */
  onChange: (value: number, carry: number) => void;
  /** the tooltip */
  title: string;
  /** shows the value but cannot be changed (the clock is running) */
  readOnly?: boolean;
  /** decimal places, default 0 (the latitude and longitude of a ground station have 4) */
  digits?: number;
  /** what the arrow keys and the - and + buttons add, default 1 */
  step?: number;
  /** what Page Up and Page Down add, default 10 */
  page?: number;
}

/**
 * A GtkSpinButton (digits 0, step 1, page 10, numeric unless `digits`, `step` and `page` say otherwise): the arrow keys and the
 * - and + buttons step, a typed number is taken on Enter or when the field loses focus if it is inside the range
 * (GTK_UPDATE_IF_VALID: otherwise the old value comes back).
 */
export function SpinButton({
  id,
  value,
  min,
  max,
  wrap = false,
  onChange,
  title,
  readOnly = false,
  digits = 0,
  step: stepSize = 1,
  page = 10,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null); // the text while the user types

  const step = (delta: number) => {
    if (readOnly) return;
    if (wrap) {
      const w = wrapSpin(value + delta, min, max);
      onChange(w.value, w.carry);
    } else {
      const next = stepSpin(value, delta, min, max, digits);
      if (next !== value) onChange(next, 0);
    }
  };

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const typed = parseSpinText(draft, min, max, digits);
    if (typed !== null && typed !== value) onChange(typed, 0);
  };

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    const delta = ({ ArrowUp: stepSize, ArrowDown: -stepSize, PageUp: page, PageDown: -page } as Record<string, number>)[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      setDraft(null);
      step(delta);
    } else if (e.key === "Enter") {
      e.preventDefault(); // takes the number; does not also press the OK button of a form around the spin button
      commit();
    }
  };

  return (
    <span className="spin" title={title}>
      <input
        id={id}
        className={digits > 0 ? "spin-input wide" : "spin-input"}
        type="text"
        inputMode={digits > 0 || min < 0 ? "decimal" : "numeric"}
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        value={draft ?? formatSpin(value, digits)}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={key}
      />
      <button
        type="button"
        className="button spin-step"
        tabIndex={-1}
        aria-hidden="true"
        aria-disabled={readOnly}
        onClick={() => step(-stepSize)}
      >
        −
      </button>
      <button
        type="button"
        className="button spin-step"
        tabIndex={-1}
        aria-hidden="true"
        aria-disabled={readOnly}
        onClick={() => step(stepSize)}
      >
        +
      </button>
    </span>
  );
}
