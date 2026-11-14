import { useEffect, useRef, useState } from "react";
import { errorText } from "../api";
import { Modal } from "../components/Modal";
import { updateTransponders } from "./radioApi";
import { trspDialogView, TRSP_HEADING, TRSP_STATS, TRSP_TITLE } from "./trspUpdate";
import type { TrspPhase } from "./trspUpdate";

interface Props {
  onClose: () => void;
}

/**
 * Edit → Update transponder data (ref-R §11.1, spec §7.1): the modal "Transponder Update" starts the update when it opens and shows
 * "Updating transponder files from network" in bold, then "Fetching transmitters.json" while the server fetches, then "Finished" with
 * the progress bar at 100 % and Close enabled. (ของเรา) The Thai lines of the server's answer follow "Finished": when the data was
 * fetched, or why nothing was (within two hours of the last request, SatNOGS DB could not be reached, ...). The server answers when it
 * is done, so nothing moves in between, as in Gpredict where the bar jumps at the end.
 */
export function TrspUpdateDialog({ onClose }: Props) {
  const [phase, setPhase] = useState<TrspPhase>({ kind: "start" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // a second run of this effect (React's strict mode in development) must not ask twice
    started.current = true;
    setPhase({ kind: "fetching" });
    updateTransponders().then(
      (answer) => setPhase({ kind: "done", answer }),
      (e: unknown) => setPhase({ kind: "failed", error: errorText(e) }),
    );
  }, []);

  const view = trspDialogView(phase);
  // (ของเรา) Escape closes it only when Close can be pressed
  const escape = () => {
    if (view.finished) onClose();
  };
  return (
    <Modal title={TRSP_TITLE} onEscape={escape}>
      <div className="dialog tle trsp">
        <b className="tle-heading">{TRSP_HEADING}</b>
        <div className="tle-activity">{view.activity}</div>
        <progress className="tle-progress" max={1} value={view.progress} aria-label={TRSP_HEADING} />
        <div className="tle-stats">{TRSP_STATS}</div>
        {view.lines.length > 0 && (
          <ul className="tle-messages">
            {view.lines.map((m, i) => (
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
    </Modal>
  );
}
