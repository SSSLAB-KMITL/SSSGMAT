import { Component } from "react";
import type { ReactNode } from "react";
import { errorText } from "../api";

/** (ของเรา) What a part that failed shows in its place: the Thai sentence, the text of the error, then `text` of its window if any. */
export const pageFailedText = (error: unknown, text?: string): string =>
  `หน้านี้ทำงานผิดพลาด จึงแสดงไม่ได้ (${errorText(error)})${text ? ` ${text}` : ""}`;

interface Props {
  children: ReactNode;
  /** (ของเรา) what the message adds after the error, in Thai: what still works, e.g. Preferences' "หน้าอื่นของ Preferences ยังใช้ได้" */
  text?: string;
}

interface State {
  failed: boolean;
  error: unknown;
}

/**
 * (ของเรา) Catches an error thrown while a part of a window is drawn (a page of Preferences), so that the part shows a Thai message in its
 * place and the rest of the application stays. React itself reports the error to the console. The part stays failed until it is unmounted.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  render(): ReactNode {
    return this.state.failed ? (
      <p className="dialog-error" role="alert">
        {pageFailedText(this.state.error, this.props.text)}
      </p>
    ) : (
      this.props.children
    );
  }
}
