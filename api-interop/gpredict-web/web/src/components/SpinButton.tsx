import { useState } from "react";
import type { KeyboardEvent } from "react";
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
}

const PAGE = 10;
const KEY_STEPS: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: PAGE, PageDown: -PAGE };

/**
 * A GtkSpinButton (digits 0, step 1, page 10, numeric): the arrow keys and the - and + buttons step, a typed number is
 * taken on Enter or when the field loses focus if it is inside the range (GTK_UPDATE_IF_VALID: otherwise the old value
 * comes back).
 */
export function SpinButton({ id, value, min, max, wrap = false, onChange, title, readOnly = false }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // the text while the user types

  const step = (delta: number) => {
    if (readOnly) return;
    const raw = value + delta;
    if (wrap) {
      const w = wrapSpin(raw, min, max);
      onChange(w.value, w.carry);
    } else {
      const clamped = Math.max(min, Math.min(max, raw));
      if (clamped !== value) onChange(clamped, 0);
    }
  };

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (!/^\d+$/.test(draft)) return;
    const typed = Number(draft);
    if (typed >= min && typed <= max && typed !== value) onChange(typed, 0);
  };

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    const delta = KEY_STEPS[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      setDraft(null);
      step(delta);
    } else if (e.key === "Enter") {
      commit();
    }
  };

  return (
    <span className="spin" title={title}>
      <input
        id={id}
        className="spin-input"
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        value={draft ?? String(value)}
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
        onClick={() => step(-1)}
      >
        −
      </button>
      <button
        type="button"
        className="button spin-step"
        tabIndex={-1}
        aria-hidden="true"
        aria-disabled={readOnly}
        onClick={() => step(1)}
      >
        +
      </button>
    </span>
  );
}
