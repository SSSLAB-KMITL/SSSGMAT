import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cssRgba } from "../colors";
import { joinRgba, splitRgba } from "../rgba";

interface Props {
  /** Gpredict's label of the button ("Grid:"), shown at its left */
  label: string;
  /** the tooltip of the button */
  tooltip: string;
  /** the colour, 0xRRGGBBAA */
  value: number;
  /** the user chose a colour or an opacity: the new colour, 0xRRGGBBAA */
  onChange: (value: number) => void;
}

/**
 * A colour button of the Map View and Polar View pages (ref-D §11, §12): the label and a button that shows the colour as a swatch (over
 * a chequerboard, so a transparent colour can be seen to be one). Gpredict's is a GtkColorButton with alpha, whose chooser has an opacity
 * control; (ของเรา) the button opens a small panel with the browser's colour input and a slider of the opacity from 0 to 255, which is
 * the alpha byte of the stored 0xRRGGBBAA. Escape or a press outside closes the panel. The label and the button are two cells of the
 * grid of the page (`.colour-grid`), so this is a fragment.
 */
export function ColourButton({ label, tooltip, value, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const cell = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { hex, alpha } = splitRgba(value);
  const name = label.replace(/:$/, "");

  // a press outside the button and its panel closes the panel
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && cell.current?.contains(e.target) !== true) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  // the panel is in the page, which scrolls: it comes into view when it opens
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault(); // the window that holds the page stays open: Escape only closes the panel
      e.stopPropagation();
      setOpen(false);
      cell.current?.querySelector("button")?.focus();
    }
  };

  return (
    <>
      <span className="right">{label}</span>
      <span ref={cell} className="colour-cell" onKeyDown={key}>
        <button
          type="button"
          className="button colour"
          title={tooltip}
          aria-label={name}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="swatch">
            <span style={{ background: cssRgba(value) }} />
          </span>
        </button>
        {open && (
          <div ref={panel} id={`${id}-panel`} className="colour-panel" role="dialog" aria-label={`สี ${name}`}>
            <input
              type="color"
              className="colour-input"
              aria-label={`สี ${name}`}
              value={hex}
              onChange={(e) => onChange(joinRgba(e.target.value, alpha))}
            />
            <label className="colour-alpha" htmlFor={`${id}-alpha`}>
              ความทึบ
            </label>
            <input
              id={`${id}-alpha`}
              type="range"
              min={0}
              max={255}
              step={1}
              value={alpha}
              onChange={(e) => onChange(joinRgba(hex, Number(e.target.value)))}
            />
            <output className="colour-alpha-value" htmlFor={`${id}-alpha`}>
              {alpha}
            </output>
          </div>
        )}
      </span>
    </>
  );
}
