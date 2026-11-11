import { useState } from "react";
import type { KeyboardEvent } from "react";
import { layoutCodeError, presetIndexOf, PROPS_TABS, resetTab, RESET_TIP } from "../moduleProps";
import type { ModuleProps, PropsTab } from "../moduleProps";
import type { Meta } from "../types";
import { FloatingWindow } from "./FloatingWindow";
import { FieldsPage, LayoutPage, MapPage, PolarPage, RefreshPage } from "./ModulePropertiesPages";

interface Props {
  /** the properties the dialog opens with */
  initial: ModuleProps;
  meta: Meta;
  /** Cancel, the close button or Escape: the draft is dropped */
  onCancel: () => void;
  /** OK: the properties as they are now (the module dialog keeps them until it is itself confirmed) */
  onOK: (props: ModuleProps) => void;
}

/**
 * The "Module properties" dialog (ref §3), opened by the Properties button of Create new module / Edit module: a notebook with
 * the pages Layout, Refresh Rates, List View, Map View, Polar View and Single Sat View, each with a Reset button that puts the
 * page's settings back to Gpredict's defaults, and the buttons Cancel and OK. Nothing is changed until OK here and OK of the
 * module dialog. The colours, the background map and the window placements are shown and cannot be used yet (spec §8.2).
 */
export function ModuleProperties({ initial, meta, onCancel, onOK }: Props) {
  const [draft, setDraft] = useState<ModuleProps>(initial);
  const [tab, setTab] = useState<PropsTab>("layout");
  const [custom, setCustom] = useState(() => presetIndexOf(initial.layout_code, meta.layout_presets) === meta.layout_presets.length);
  const [failure, setFailure] = useState<string | null>(null);

  const reset = (which: PropsTab) => {
    const next = resetTab(draft, which, meta.module_defaults);
    setDraft(next);
    if (which === "layout") setCustom(presetIndexOf(next.layout_code, meta.layout_presets) === meta.layout_presets.length);
    setFailure(null);
  };

  const ok = () => {
    const problem = layoutCodeError(draft.layout_code);
    if (problem !== null) {
      setTab("layout");
      setFailure(problem);
      return;
    }
    onOK(draft);
  };

  const tabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : PROPS_TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target.id);
      document.getElementById(`props-tab-${target.id}`)?.focus();
    }
  };

  const page = () => {
    switch (tab) {
      case "layout":
        return (
          <LayoutPage
            props={draft}
            meta={meta}
            set={setDraft}
            custom={custom}
            setCustom={setCustom}
            onReset={() => reset("layout")}
            resetTip={RESET_TIP.layout}
          />
        );
      case "refresh":
        return <RefreshPage props={draft} meta={meta} set={setDraft} onReset={() => reset("refresh")} resetTip={RESET_TIP.refresh} />;
      case "list":
        return (
          <FieldsPage
            fields={meta.list_columns}
            visible={draft.list_columns}
            onChange={(list_columns) => setDraft({ ...draft, list_columns })}
            onReset={() => reset("list")}
            resetTip={RESET_TIP.list}
          />
        );
      case "map":
        return <MapPage props={draft} meta={meta} set={setDraft} onReset={() => reset("map")} resetTip={RESET_TIP.map} />;
      case "polar":
        return <PolarPage props={draft} meta={meta} set={setDraft} onReset={() => reset("polar")} resetTip={RESET_TIP.polar} />;
      case "single":
        return (
          <FieldsPage
            fields={meta.single_fields}
            visible={draft.single_fields}
            onChange={(single_fields) => setDraft({ ...draft, single_fields })}
            onReset={() => reset("single")}
            resetTip={RESET_TIP.single}
          />
        );
    }
  };

  return (
    <FloatingWindow title="Module properties" onClose={onCancel} width={640}>
      <div className="dialog">
        <div className="dtabs" role="tablist">
          {PROPS_TABS.map((t, i) => (
            <button
              key={t.id}
              id={`props-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              aria-controls="props-panel"
              tabIndex={t.id === tab ? 0 : -1}
              data-autofocus={t.id === "layout" ? true : undefined}
              className={t.id === tab ? "dtab active" : "dtab"}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => tabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id="props-panel" className="props-page" role="tabpanel" aria-labelledby={`props-tab-${tab}`}>
          {page()}
        </div>
        {failure !== null && (
          <p className="dialog-error" role="alert">
            {failure}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}
