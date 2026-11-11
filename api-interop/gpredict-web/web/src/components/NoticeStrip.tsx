import type { Notice } from "../notices";

interface Props {
  notices: readonly Notice[];
  onDismiss: (id: string) => void;
  /** Retry of a GMAT_FAILED notice, for the module the notice names */
  onRetry: (module: string) => void;
}

/** Dismissible notices under the tabs (ของเรา): messages of GET /api/modules and GMAT_FAILED on an ok tick. */
export function NoticeStrip({ notices, onDismiss, onRetry }: Props) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.level}`} role={n.level === "error" ? "alert" : "status"}>
          <span className="notice-text">{n.text}</span>
          {n.retryModule !== undefined && (
            <button type="button" className="button" onClick={() => onRetry(n.retryModule!)}>
              Retry
            </button>
          )}
          <button
            type="button"
            className="button flat notice-dismiss"
            title="ปิดข้อความนี้"
            aria-label="ปิดข้อความนี้"
            onClick={() => onDismiss(n.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
