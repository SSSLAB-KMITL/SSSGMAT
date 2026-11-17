import { Modal } from "./Modal";
import type { ApiMessage } from "../types";

interface Props {
  /** what the box says: `level` "error" shows the error icon, anything else the info icon; the text keeps its line breaks */
  message: ApiMessage;
  /** the title of the box; without it the box has none, as Gpredict's "no pass" box (Radio Control's "ERROR" box has one) */
  title?: string;
  onOk: () => void;
}

/**
 * (ของเรา) Gpredict shows the theme's dialog-error and dialog-information icons; these drawings stand for them. The message box below and the
 * notice "TLE files are getting out of date" (TleOldNotice.tsx) use it.
 */
export function MessageIcon({ error }: { error: boolean }) {
  return (
    <svg className={`message-box-icon ${error ? "error" : "info"}`} width="32" height="32" viewBox="0 0 32 32" role="img" aria-label={error ? "Error" : "Info"}>
      <circle cx="16" cy="16" r="14" />
      {error ? (
        <path d="M10.5 10.5l11 11M21.5 10.5l-11 11" />
      ) : (
        <>
          <circle className="dot" cx="16" cy="9.5" r="1.8" />
          <path d="M16 14.5v9" />
        </>
      )}
    </svg>
  );
}

/**
 * Gpredict's message box (a GtkMessageDialog): a modal with an icon (error or info), the text letter for letter with its line breaks,
 * and one button, OK, which has the focus. Escape closes it like OK does. The "no pass" box (passes/NoPassMessage.tsx), Preferences →
 * Interfaces and the boxes of Radio Control and Antenna Control use it.
 */
export function MessageBox({ message, title, onOk }: Props) {
  return (
    <Modal title={title} onEscape={onOk}>
      <div className="dialog message-box">
        <div className="message-box-row">
          <MessageIcon error={message.level === "error"} />
          <p className="dialog-text message-box-text">{message.text}</p>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="button" data-autofocus onClick={onOk}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
