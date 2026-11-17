import { useEffect, useRef } from "react";
import { Modal } from "../components/Modal";

interface Props {
  /** "waiting" while GMAT works; `{ error }` (the Thai text of the server) when it failed */
  state: "waiting" | { error: string };
  /** Cancel (also Escape): drops the request, the server drops the GMAT job nobody else waits for */
  onCancel: () => void;
  /** Retry: asks again with the same request (only in the error state) */
  onRetry: () => void;
}

/**
 * (ของเรา) The box Gpredict does not have: it answers at once, we may have to wait for GMAT (spec §4.4). A small modal without a
 * title that says `กำลังคำนวณวงโคจรด้วย GMAT…` with Cancel; it comes up only when the answer is more than WAIT_BOX_DELAY_MS late
 * (passRequest.ts). If GMAT failed it shows the error in the same box, with Retry and Cancel (Retry has the focus then).
 */
export function PassWait({ state, onCancel, onRetry }: Props) {
  const failed = state !== "waiting";
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (failed) retry.current?.focus({ preventScroll: true });
  }, [failed]);

  return (
    <Modal onEscape={onCancel}>
      <div className="dialog pass-wait">
        {failed ? (
          <p className="dialog-error" role="alert">
            {state.error}
          </p>
        ) : (
          <p className="dialog-text" role="status">
            กำลังคำนวณวงโคจรด้วย GMAT…
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" data-autofocus onClick={onCancel}>
            Cancel
          </button>
          {failed && (
            <button ref={retry} type="button" className="button" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
