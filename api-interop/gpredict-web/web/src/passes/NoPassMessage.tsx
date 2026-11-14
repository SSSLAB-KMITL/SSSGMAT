import { MessageBox } from "../components/MessageBox";
import type { ApiMessage } from "../types";

interface Props {
  /** the answer's message: PASS_NO_AOS (error) or PASS_NONE_WITHIN (info), the text is Gpredict's with its line breaks */
  message: ApiMessage;
  onOk: () => void;
}

/** The message box of a satellite that has no pass (ref-P §1.4, spec §4.3): Gpredict's message box without a title (it sets none). */
export function NoPassMessage({ message, onOk }: Props) {
  return <MessageBox message={message} onOk={onOk} />;
}
