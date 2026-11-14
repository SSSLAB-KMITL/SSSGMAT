import { boldSegments } from "../tleUpdate";
import { FloatingWindow } from "./FloatingWindow";
import { MessageIcon } from "./MessageBox";

interface Props {
  /** the text of the notice as the server sends it (`tle_old` of /ws/app): Gpredict's, with `<b>…</b>` where it is bold */
  text: string;
  onClose: () => void;
}

/**
 * The notice that the TLE data is old (ref-D §5.1, main.c:516-536): a message dialog that does not block the page and has no title, the
 * info icon, the text with "Edit -> Update TLE" in bold, and one button, OK. Escape and the close button close it like OK does. Only the
 * tag `<b>` is shown as markup (`boldSegments`): the rest of the text is text.
 */
export function TleOldNotice({ text, onClose }: Props) {
  return (
    <FloatingWindow title="" onClose={onClose}>
      <div className="dialog message-box tle-old">
        <div className="message-box-row">
          <MessageIcon error={false} />
          <p className="dialog-text message-box-text">
            {boldSegments(text).map((s, i) => (s.bold ? <b key={i}>{s.text}</b> : s.text))}
          </p>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="button" data-autofocus onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}
