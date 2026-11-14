import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, getSatellite } from "../api";
import type { ViewProps } from "../components/ModuleView";
import { toEntries } from "../components/menuEntries";
import { PopupMenu } from "../components/PopupMenu";
import type { MenuEntry } from "../components/PopupMenu";
import { satPopup } from "../satPopup";
import { singleSatChange } from "../selection";
import type { Tick } from "../types";
import { useMeta } from "../useMeta";
import { useRefreshGate } from "./canvasHooks";
import { inCanonicalOrder, singleCell } from "./cells";
import { mergeNames, shownSatellite, singleChoices } from "./singleSat";

/**
 * The names of the module's satellites. A name comes from a tick the first time the satellite is in one and is kept, so that
 * a satellite GMAT drops from later ticks keeps its name. One that no tick has had (dropped from the first on) is asked for
 * with GET /api/satellites/{norad} once the first tick has arrived; if that fails its NORAD number stands for its name.
 */
function useSatNames(satellites: readonly number[], shown: Tick | null): ReadonlyMap<number, string> {
  const [held, setHeld] = useState<ReadonlyMap<number, string>>(new Map());
  const names = useMemo(() => mergeNames(held, shown?.sats ?? []), [held, shown]);
  useEffect(() => {
    if (names !== held) setHeld(names);
  }, [names, held]);

  const asked = useRef(new Set<number>());
  useEffect(() => {
    if (shown === null) return;
    for (const norad of satellites) {
      if (names.has(norad) || asked.current.has(norad)) continue;
      asked.current.add(norad);
      getSatellite(norad).then(
        (record) => setHeld((h) => (h.has(norad) ? h : new Map(h).set(norad, record.name))),
        () => undefined,
      );
    }
  }, [satellites, shown, names]);
  return names;
}

/**
 * The Single sat view (ref §7, spec §8.7): a satellite of the module, named in bold, with its visible fields (the module's
 * `single.fields` in the canonical order of /api/meta) as `<title> : <value>`, each row with its hint as tooltip.
 *
 * - The satellite is `single.selected` if it is in the module, else the first by name. If the tick lacks it (GMAT dropped
 *   it) every value is "-".
 * - It redraws from the tick only every `refresh.single` ticks (the first at once).
 * - The header button (tooltip "Satellite options / shortcuts") opens the popup: the satellite's name in bold (Satellite
 *   info, a later sub-project), the pass items (sent through `onPass` with the time of the tick this view shows), and one radio
 *   item per satellite sorted by name.
 *   Choosing one shows that satellite and saves it as `single.selected` with PUT /api/modules/{name}; if the server refuses,
 *   the Thai text goes to `onError` (the notice strip).
 */
export function SingleSatView({ config, tick, nf, onSaveConfig, onError, onPass }: ViewProps) {
  const meta = useMeta();
  const shown = useRefreshGate(tick, config.refresh.single);
  const names = useSatNames(config.satellites, shown);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  const choices = useMemo(() => singleChoices(config.satellites, names), [config.satellites, names]);
  const norad = shownSatellite(config.single.selected, choices);
  const name = choices.find((c) => c.norad === norad)?.name ?? "noname"; // Gpredict's text for a module without satellites
  const sat = norad === null ? undefined : shown?.sats?.find((s) => s.norad === norad);
  const fields = useMemo(() => inCanonicalOrder(meta?.single_fields ?? [], config.single.fields), [meta, config.single.fields]);

  const close = useCallback((restoreFocus: boolean) => {
    setMenuAt(null);
    if (restoreFocus) button.current?.focus();
  }, []);

  const choose = (selected: number) => {
    onSaveConfig(singleSatChange(selected)).catch((e: unknown) => onError?.(errorText(e)));
  };

  // the satellite's name in bold (Satellite info) and the pass items, as in every satellite popup (satPopup.ts); then one radio item per satellite
  const items: MenuEntry[] = [
    ...toEntries(satPopup("single", { norad: norad ?? 0, name, el: sat?.el ?? null, dir: sat?.dir ?? "" }, config), (action) => {
      // no satellite (an empty module) or no tick yet: there is nothing to ask passes of, or no time to start from
      if (action.type === "pass" && norad !== null && shown !== null) onPass?.(norad, action.kind, shown.t);
    }),
    { kind: "separator" },
    ...choices.map((c): MenuEntry => ({ kind: "radio", label: c.name, checked: c.norad === norad, onChoose: () => choose(c.norad) })),
  ];

  return (
    <div className="single-view">
      <div className="single-header">
        <button
          ref={button}
          type="button"
          className="button flat icon-button"
          title="Satellite options / shortcuts"
          aria-label="Satellite options / shortcuts"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(e) => {
            if (menuAt !== null) {
              setMenuAt(null);
              return;
            }
            const box = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: box.left, y: box.bottom });
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
        <span className="single-name">{name}</span>
      </div>
      <div className="single-body">
        <table className="single-table">
          <tbody>
            {fields.map((f) => (
              <tr key={f.name} title={f.hint}>
                <th scope="row" className="single-title">
                  {f.name}
                </th>
                <td className="single-colon">:</td>
                <td className="single-value">{singleCell(f.name, sat, nf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {menuAt !== null && <PopupMenu x={menuAt.x} y={menuAt.y} items={items} onClose={close} anchor={button} />}
    </div>
  );
}
