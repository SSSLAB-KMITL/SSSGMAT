import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { layoutCodeError, markEdited, markReset, presetIndexOf, PROPS_TABS, resetTab, RESET_TIP } from "../moduleProps";
import type { ModuleProps, PropsMarks, PropsTab } from "../moduleProps";
import type { Meta } from "../types";
import { FloatingWindow } from "./FloatingWindow";
import { FieldsPage, LayoutPage, MapPage, PolarPage, RefreshPage } from "./ModulePropertiesPages";

interface NotebookProps {
  /** the values the pages show */
  props: ModuleProps;
  meta: Meta;
  /** the page shown */
  tab: PropsTab;
  setTab: (tab: PropsTab) => void;
  /** a control of page `tab` was changed: the pages now show `next` */
  onEdit: (tab: PropsTab, next: ModuleProps) => void;
  /** the Reset button of page `tab` */
  onReset: (tab: PropsTab) => void;
  /** the tooltip of each page's Reset: the global values in module mode, the defaults in Preferences (ref-D §10) */
  resetTips: Readonly<Record<PropsTab, string>>;
  /** the Window Placements of the Layout page (Preferences only) */
  layoutExtra?: ReactNode;
  /** the first tab takes the focus when the window opens (a window whose own first control should not) */
  autoFocus?: boolean;
}

/**
 * The notebook of Module properties (sat-pref-modules.c:65-80): the pages Layout, Refresh Rates, List View, Map View, Polar View and
 * Single Sat View, each with its Reset button. Module properties edits a module with it, Preferences → Modules the global values
 * (the same pages in Gpredict, sat-pref-modules.c:43-57); what a change and a Reset do is theirs (`onEdit`, `onReset`).
 */
export function PropsNotebook({ props, meta, tab, setTab, onEdit, onReset, resetTips, layoutExtra, autoFocus = false }: NotebookProps) {
  const uid = useId();
  // "Custom" chosen in the layout combo: the code can be typed even while it is a built-in layout's; Reset forgets it
  const [chosenCustom, setChosenCustom] = useState(false);
  const custom = chosenCustom || presetIndexOf(props.layout_code, meta.layout_presets) === meta.layout_presets.length;

  const reset = (which: PropsTab) => {
    if (which === "layout") setChosenCustom(false);
    onReset(which);
  };

  const tabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : PROPS_TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target.id);
      document.getElementById(`${uid}-tab-${target.id}`)?.focus();
    }
  };

  const page = () => {
    const common = { props, meta, uid, onReset: () => reset(tab), resetTip: resetTips[tab] };
    switch (tab) {
      case "layout":
        return (
          <LayoutPage
            {...common}
            set={(next) => onEdit("layout", next)}
            custom={custom}
            setCustom={setChosenCustom}
            extra={layoutExtra}
          />
        );
      case "refresh":
        return <RefreshPage {...common} set={(next) => onEdit("refresh", next)} />;
      case "list":
        return (
          <FieldsPage
            fields={meta.list_columns}
            visible={props.list_columns}
            onChange={(list_columns) => onEdit("list", { ...props, list_columns })}
            onReset={common.onReset}
            resetTip={common.resetTip}
          />
        );
      case "map":
        return <MapPage {...common} set={(next) => onEdit("map", next)} />;
      case "polar":
        return <PolarPage {...common} set={(next) => onEdit("polar", next)} />;
      case "single":
        return (
          <FieldsPage
            fields={meta.single_fields}
            visible={props.single_fields}
            onChange={(single_fields) => onEdit("single", { ...props, single_fields })}
            onReset={common.onReset}
            resetTip={common.resetTip}
          />
        );
    }
  };

  return (
    <>
      <div className="dtabs" role="tablist">
        {PROPS_TABS.map((t, i) => (
          <button
            key={t.id}
            id={`${uid}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            aria-controls={`${uid}-panel`}
            tabIndex={t.id === tab ? 0 : -1}
            data-autofocus={autoFocus && i === 0 ? true : undefined}
            className={t.id === tab ? "dtab active" : "dtab"}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => tabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${uid}-panel`} className="props-page" role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
        {page()}
      </div>
    </>
  );
}

interface Props {
  /** the properties the dialog opens with */
  initial: ModuleProps;
  /** what the earlier OKs of Module properties in the same module dialog did to the pages (none the first time) */
  marks: PropsMarks;
  /** the global values (Preferences → Modules), which a page's Reset loads */
  global: ModuleProps;
  meta: Meta;
  /** Cancel, the close button or Escape: the draft is dropped */
  onCancel: () => void;
  /** OK: the properties as they are now and what was done to the pages (the module dialog keeps them until it is itself confirmed) */
  onOK: (props: ModuleProps, marks: PropsMarks) => void;
}

/**
 * The "Module properties" dialog (ref §3, ref-D §10), opened by the Properties button of Create new module / Edit module: the notebook
 * of the pages, each with a Reset button that gives the page the current global values again ("Reset module settings to the global
 * values."), and the buttons Cancel and OK. A page the user changes is pinned to the module when it is saved, a page that was Reset
 * and not changed afterwards inherits the global values again (`propsSave`). Nothing is changed until OK here and OK of the module
 * dialog. The Map View page has the background map ("Select map") and the colours, the Polar View page the colours (ref-D §11, §12).
 */
export function ModuleProperties({ initial, marks: initialMarks, global, meta, onCancel, onOK }: Props) {
  const [draft, setDraft] = useState<ModuleProps>(initial);
  const [marks, setMarks] = useState<PropsMarks>(initialMarks);
  const [tab, setTab] = useState<PropsTab>("layout");
  const [failure, setFailure] = useState<string | null>(null);

  const edit = (which: PropsTab, next: ModuleProps) => {
    setDraft(next);
    setMarks((m) => markEdited(m, which));
  };

  const reset = (which: PropsTab) => {
    setDraft((d) => resetTab(d, which, global));
    setMarks((m) => markReset(m, which));
    setFailure(null);
  };

  const ok = () => {
    const problem = layoutCodeError(draft.layout_code);
    if (problem !== null) {
      setTab("layout");
      setFailure(problem);
      return;
    }
    onOK(draft, marks);
  };

  return (
    <FloatingWindow title="Module properties" onClose={onCancel} width={640}>
      <div className="dialog">
        <PropsNotebook
          props={draft}
          meta={meta}
          tab={tab}
          setTab={setTab}
          onEdit={edit}
          onReset={reset}
          resetTips={RESET_TIP}
          autoFocus
        />
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
