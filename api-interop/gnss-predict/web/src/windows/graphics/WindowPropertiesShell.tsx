// กรอบร่วมของ 3D / 2D Graphics Window Properties (STK ref §E): แท็บของหน้าทางซ้าย, หน้าที่เลือก, ปุ่ม OK / Cancel / Apply
// ค่าตั้งเป็นของหน้าต่างกราฟิกบานที่ params.target ชี้ (useLayout.windowProps[target]) หน้าต่างนั้นถูกปิดไปแล้ว = ข้อความไทยและแก้ไม่ได้
// OK = Apply แล้วปิด (Apply ไม่ผ่าน = ไม่ปิด), Cancel = ปิดโดยไม่เปลี่ยน, Apply กดได้เมื่อมีการแก้

import type { ReactNode } from "react";
import { FormField } from "../../chrome/FormField";
import { t, type LabelKey } from "../../labels/labels";
import { useLayout } from "../../stores/layout";

/** หน้าต่างกราฟิกที่หน้าต่าง Properties นี้ตั้งค่าให้: id, ค่าที่เก็บไว้ และยังเปิดอยู่ไหม */
export function useTargetWindow(params: unknown): { target: string | null; stored: unknown; exists: boolean } {
  const raw = (params as { target?: unknown } | undefined)?.target;
  const target = typeof raw === "string" ? raw : null;
  const stored = useLayout((s) => (target === null ? undefined : s.windowProps[target]));
  const exists = useLayout((s) => target !== null && s.api?.getPanel(target) !== undefined);
  return { target, stored, exists };
}

/** ช่องติ๊กหนึ่งช่องของหน้า */
export function CheckField({ label, checked, onChange }: { label: LabelKey; checked: boolean; onChange(value: boolean): void }) {
  return (
    <FormField label={t(label)}>
      {({ id, "aria-invalid": invalid, "aria-describedby": describedBy }) => (
        <input
          id={id}
          type="checkbox"
          className="form-check"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </FormField>
  );
}

export interface WindowPropertiesShellProps<P extends string> {
  panelId: string;
  /** ชื่อของรายการแท็บ (ชื่อหน้าต่าง) */
  title: LabelKey;
  pages: readonly { id: P; title: LabelKey }[];
  page: P;
  onPage(page: P): void;
  /** หน้าต่างเป้าหมายยังเปิดอยู่ */
  exists: boolean;
  /** ข้อความเมื่อหน้าต่างเป้าหมายถูกปิดแล้ว */
  noWindow: string;
  dirty: boolean;
  /** เขียนค่า คืน false เมื่อมีช่องที่ใช้ไม่ได้ (ไม่ปิด) */
  apply(): boolean;
  children: ReactNode;
}

export function WindowPropertiesShell<P extends string>(props: WindowPropertiesShellProps<P>) {
  const { panelId, pages, page, exists } = props;
  const close = (): void => useLayout.getState().closePanel(panelId);
  const tabId = (id: P): string => `${panelId}-tab-${id}`;
  const pageDomId = `${panelId}-page`;
  return (
    <div className="props">
      <div className="props-body">
        <div className="props-tabs" role="tablist" aria-orientation="vertical" aria-label={t(props.title)}>
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={tabId(p.id)}
              className="props-tab"
              aria-selected={p.id === page}
              aria-controls={pageDomId}
              tabIndex={p.id === page ? 0 : -1}
              onClick={() => props.onPage(p.id)}
            >
              {t(p.title)}
            </button>
          ))}
        </div>
        <div className="props-page" role="tabpanel" id={pageDomId} aria-labelledby={tabId(page)}>
          {!exists && (
            <p className="form-error" role="alert">
              {props.noWindow}
            </p>
          )}
          <fieldset className="props-fields" disabled={!exists}>
            {props.children}
          </fieldset>
        </div>
      </div>
      <div className="props-buttons">
        <button
          type="button"
          className="btn"
          disabled={!exists}
          onClick={() => {
            if (props.apply()) close();
          }}
        >
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button type="button" className="btn" disabled={!exists || !props.dirty} onClick={() => void props.apply()}>
          {t("dialog.apply")}
        </button>
      </div>
    </div>
  );
}
