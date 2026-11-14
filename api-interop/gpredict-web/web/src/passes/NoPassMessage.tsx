import { Modal } from "../components/Modal";
import type { ApiMessage } from "../types";

interface Props {
  /** the answer's message: PASS_NO_AOS (error) or PASS_NONE_WITHIN (info), the text is Gpredict's with its line breaks */
  message: ApiMessage;
  /** the title of the box; without it the box has none, as Gpredict's "no pass" box (Radio Control's "ERROR" box has one) */
  title?: string;
  onOk: () => void;
}

/**
 * The message box of a satellite that has no pass (ref-P §1.4, spec §4.3): a modal without a title, as Gpredict's (it sets none),
 * with an icon (error or info), the text letter for letter with its line breaks, and one button, OK, which has the focus.
 * Escape closes it like OK does. The other message boxes of Gpredict look the same and use it too (Preferences → Interfaces, the
 * boxes of Radio Control and Antenna Control).
 */
export function NoPassMessage({ message, title, onOk }: Props) {
  const error = message.level === "error";
  return (
    <Modal title={title} onEscape={onOk}>
      <div className="dialog no-pass">
        <div className="no-pass-row">
          {/* (ของเรา) Gpredict shows the theme's dialog-error and dialog-information icons; these drawings stand for them */}
          <svg className={`no-pass-icon ${error ? "error" : "info"}`} width="32" height="32" viewBox="0 0 32 32" role="img" aria-label={error ? "Error" : "Info"}>
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
          <p className="dialog-text no-pass-text">{message.text}</p>
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
