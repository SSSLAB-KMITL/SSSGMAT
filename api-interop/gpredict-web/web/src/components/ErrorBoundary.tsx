import { Component } from "react";
import type { ReactNode } from "react";
import { errorText } from "../api";

/** (ของเรา) What a page that failed shows in its place. */
export const pageFailedText = (error: unknown): string => `หน้านี้ทำงานผิดพลาด จึงแสดงไม่ได้ (${errorText(error)}) หน้าอื่นของ Preferences ยังใช้ได้`;

interface State {
  failed: boolean;
  error: unknown;
}

/**
 * (ของเรา) Catches an error thrown while a page of Preferences is drawn, so that the page shows a Thai message inside the window and the
 * rest of the application stays. React itself reports the error to the console. The page stays failed until the window closes.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  render(): ReactNode {
    return this.state.failed ? (
      <p className="dialog-error" role="alert">
        {pageFailedText(this.state.error)}
      </p>
    ) : (
      this.props.children
    );
  }
}
