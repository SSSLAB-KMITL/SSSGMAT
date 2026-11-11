import { useEffect, useRef, useState } from "react";
import { errorText, updateTle } from "../api";
import { tleDialogView, TLE_HEADING, TLE_TITLE } from "../tleUpdate";
import type { TlePhase } from "../tleUpdate";
import { FloatingWindow } from "./FloatingWindow";

interface Props {
  onClose: () => void;
  /** the update was done (also when the dialog was closed before it ended): the open modules have been reloaded by the server */
  onUpdated: () => void;
}

/**
 * Edit → Update TLE data from network (ref §1): the dialog "TLE Update" starts the update when it opens and shows
 * "Updating TLE files from network", then the counts "Satellites updated / Satellites skipped / Missing Satellites", then
 * "Finished" and enables Close. The warnings of the groups that could not be fetched follow in Thai (ของเรา). The server
 * answers when it is done (it fetches the CelesTrak groups one after the other), so the progress bar only moves.
 */
export function TleUpdateDialog({ onClose, onUpdated }: Props) {
  const [phase, setPhase] = useState<TlePhase>({ kind: "running" });
  const started = useRef(false);
  const updated = useRef(onUpdated);
  useEffect(() => {
    updated.current = onUpdated;
  }, [onUpdated]);

  useEffect(() => {
    if (started.current) return; // a second run of this effect (React's strict mode in development) must not update twice
    started.current = true;
    updateTle().then(
      (result) => {
        setPhase({ kind: "done", result });
        updated.current();
      },
      (e: unknown) => setPhase({ kind: "failed", error: errorText(e) }),
    );
  }, []);

  const view = tleDialogView(phase);
  return (
    <FloatingWindow title={TLE_TITLE} onClose={onClose} width={440}>
      <div className="dialog tle">
        <b className="tle-heading">{TLE_HEADING}</b>
        <div className="tle-activity">{view.activity}</div>
        {phase.kind === "running" ? <progress className="tle-progress" aria-label={TLE_HEADING} /> : <progress className="tle-progress" max={1} value={phase.kind === "done" ? 1 : 0} />}
        <div className="tle-stats">{view.stats}</div>
        {view.error !== null && (
          <p className="dialog-error" role="alert">
            {view.error}
          </p>
        )}
        {view.warnings.length > 0 && (
          <ul className="tle-messages">
            {view.warnings.map((m, i) => (
              <li key={i} className={`notice-${m.level}`}>
                {m.text}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" disabled={!view.finished} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}
