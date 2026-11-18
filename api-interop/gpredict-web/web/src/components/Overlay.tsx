import { useState } from "react";
import type { OverlayState } from "../overlay";

interface Props {
  state: OverlayState | null;
  /** re-run the failed GMAT calculation (POST /api/modules/{name}/retry) */
  onRetry: () => Promise<void>;
}

/** Covers the module's views while the tick status is computing or failed, or while the socket is down (ของเรา: Thai text, and the Retry button). */
export function Overlay({ state, onRetry }: Props) {
  const [busy, setBusy] = useState(false);
  if (state === null) return null;

  const retry = async () => {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  const failed = state.kind === "failed";
  return (
    <div className={`overlay overlay-${state.kind}`} role={failed ? "alert" : "status"}>
      {!failed && state.kind !== "gone" && <div className="spinner" aria-hidden="true" />}
      <div className="overlay-text">{state.text}</div>
      {state.kind === "failed" && state.detail !== null && <div className="overlay-detail">{state.detail}</div>}
      {failed && (
        <button type="button" className="button" onClick={retry} disabled={busy}>
          Retry
        </button>
      )}
    </div>
  );
}
