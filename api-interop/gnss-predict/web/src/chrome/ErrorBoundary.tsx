// error boundary ของแอป: exception ตอนวาดของส่วนหนึ่งต้องไม่ทำให้ทั้งพื้นที่ทำงานว่าง (และค่าที่ยังไม่ได้ Apply ของหน้าต่างอื่นหาย)
// - PanelBoundary ห่อเนื้อของหน้าต่าง dockview แต่ละบาน (Workspace.tsx PanelHost): ข้อความไทยในหน้าต่างนั้น ปุ่ม Retry (วาดใหม่) และ Close (ปิดหน้าต่าง)
// - ChromeBoundary ห่อแถบเมนู + แถบเครื่องมือ, แถบสถานะ และกล่องโต้ตอบ (App.tsx): ข้อความไทยแทนส่วนนั้น ปุ่ม Retry หน้าต่างทั้งหมดยังใช้ได้
// ทั้งสองแจ้งข้อผิดพลาดใน Message Viewer (รหัส PANEL_CRASH / CHROME_CRASH รายละเอียดคือ stack ของ error และของ component)
// Retry เปลี่ยน key ของลูก: ส่วนนั้นเริ่มใหม่จากสถานะตั้งต้น (สถานะที่ทำให้พังไม่ค้าง)

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { errorText } from "../api/client";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { useLayout } from "../stores/layout";
import { report } from "../stores/messages";

interface BoundaryProps {
  children: ReactNode;
  /** สิ่งที่แสดงแทนลูกที่พัง retry = วาดลูกใหม่ */
  fallback(retry: () => void): ReactNode;
  onError(error: unknown, info: ErrorInfo): void;
}

interface BoundaryState {
  failed: boolean;
  attempt: number;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  private readonly retry = (): void => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback(this.retry);
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

/** รายละเอียดใน Message Viewer: stack ของ error แล้ว stack ของ component */
function detailOf(error: unknown, info: ErrorInfo): string | null {
  const parts = [error instanceof Error ? error.stack : undefined, info.componentStack ?? undefined].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return parts.length === 0 ? null : parts.join("\n").trim();
}

/** เนื้อของหน้าต่าง dockview หนึ่งบาน: พัง = ข้อความไทย + Retry / Close ในหน้าต่างนั้น */
export function PanelBoundary({ panelId, title, children }: { panelId: string; title: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error, info) => report("error", "PANEL_CRASH", msg("panel.crashedLog", { window: title, message: errorText(error) }), null, detailOf(error, info))}
      fallback={(retry) => (
        <div className="crashed crashed-panel" role="alert">
          <p className="crashed-text">{msg("panel.crashed")}</p>
          <div className="crashed-buttons">
            <button type="button" className="btn" onClick={retry}>
              {t("dialog.retry")}
            </button>
            <button type="button" className="btn" onClick={() => useLayout.getState().closePanel(panelId)}>
              {t("dialog.windows.close")}
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export type ChromePart = "header" | "footer" | "dialogs";

const PART_NAMES = { header: "chrome.part.header", footer: "chrome.part.footer", dialogs: "chrome.part.dialogs" } as const;

/** แถบเมนู + แถบเครื่องมือ, แถบสถานะ หรือกล่องโต้ตอบ: พัง = ข้อความไทยแทนส่วนนั้น + Retry หน้าต่างอื่นยังทำงาน */
export function ChromeBoundary({ part, children }: { part: ChromePart; children: ReactNode }) {
  const name = msg(PART_NAMES[part]);
  return (
    <ErrorBoundary
      onError={(error, info) => report("error", "CHROME_CRASH", msg("chrome.crashedLog", { part: name, message: errorText(error) }), null, detailOf(error, info))}
      fallback={(retry) => (
        <div className={`crashed crashed-chrome crashed-${part}`} role="alert">
          <span className="crashed-text">{msg("chrome.crashed", { part: name })}</span>
          <button type="button" className="btn" onClick={retry}>
            {t("dialog.retry")}
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
