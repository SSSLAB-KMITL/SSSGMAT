import { useEffect, useRef, useState } from "react";
import { FILTER_DELAY_MS, filterSats } from "../radio/radioView";
import type { ControllerSat } from "../radio/types";

interface Props {
  /** the satellites of the module's combo, every one: the Filter chooses among them */
  sats: readonly ControllerSat[];
  /** the satellite the server has selected */
  norad: number | null;
  /** the tooltip of the combo */
  tip: string;
  /** the class of the two controls, which the window's grid places */
  className: string;
  /** the user chose a satellite (in the combo, or as the first match of the Filter): the window sends it to the server */
  onSelect: (norad: number) => void;
}

/**
 * The "Filter..." entry and the satellite combo of Radio Control and Antenna Control (ref-R §2.4, §5.4; two grid cells, so a fragment).
 * The combo lists the satellites whose name has the text of the entry; a change of the text selects the first match, which GtkSearchEntry
 * reports 150 ms after the last key (`filter_text_changed_cb`).
 */
export function SatFilter({ sats, norad, tip, className, onSelect }: Props) {
  const [filter, setFilter] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const listed = filterSats(sats, filter);
  const inList = listed.some((s) => s.norad === norad);

  /** "search-changed": the combo is refilled and the first match is selected */
  const change = (text: string) => {
    setFilter(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const first = filterSats(sats, text)[0];
      if (first !== undefined) onSelect(first.norad);
    }, FILTER_DELAY_MS);
  };

  return (
    <>
      <input
        type="search"
        className={className}
        placeholder="Filter..."
        aria-label="Filter..."
        value={filter}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && filter !== "") {
            e.preventDefault(); // GtkSearchEntry clears itself on Escape; the window stays
            change("");
          }
        }}
      />
      <select className={className} title={tip} value={inList ? String(norad) : ""} onChange={(e) => onSelect(Number(e.target.value))}>
        {!inList && <option value="" disabled hidden />}
        {listed.map((s) => (
          <option key={s.norad} value={s.norad}>
            {s.name}
          </option>
        ))}
      </select>
    </>
  );
}
