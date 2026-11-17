// The Predict group of Preferences (ref-P §9, sat-pref-predict.c): a notebook with the pages Pass Conditions, Multiple Passes, Single Pass
// and Sky at a Glance, and a Reset button at the bottom right of each. Every change goes to the window's draft (PrefsPageApi); the
// labels, ranges, units and tooltips are in predictPrefs.ts.

import { Fragment, useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check } from "../components/formParts";
import { SpinButton } from "../components/SpinButton";
import type { PrefsPageApi } from "./prefGroups";
import {
  CHECK_COLUMNS,
  checkRows,
  CONDITION_FIELDS,
  MULTI_PASS_CHECKS,
  PAGE_KEYS,
  PREDICT_TABS,
  RESET_TIP,
  SINGLE_PASS_CHECKS,
  SKY_COLOUR_ROWS,
  SKY_HOURS,
  toggleColumn,
} from "./predictPrefs";
import type { ColumnCheck, PredictPageId, SkyColour } from "./predictPrefs";

interface PageProps {
  api: PrefsPageApi;
  /** the Reset button of the page: its keys go back to their defaults */
  reset: () => void;
}

/** The page's "Reset" button at the bottom right (sat-pref-*.c create_reset_button), the same tooltip on every page. */
function ResetRow({ onReset }: { onReset: () => void }) {
  return (
    <div className="predict-reset">
      <button type="button" className="button" title={RESET_TIP} onClick={onReset}>
        Reset
      </button>
    </div>
  );
}

const Header = ({ children }: { children: ReactNode }) => <b className="props-header">{children}</b>;

// ---------------------------------------------------------------- Pass Conditions

function ConditionsPage({ api, reset }: PageProps) {
  const id = useId();
  return (
    <div className="predict-body">
      <div className="conditions-grid">
        {CONDITION_FIELDS.map((f) => (
          <Fragment key={f.key}>
            {f.separated && <hr className="props-separator wide" />}
            {f.header !== undefined && <Header>{f.header}</Header>}
            {f.kind === "spin" ? (
              <>
                <label htmlFor={`${id}-${f.key}`}>{f.label}</label>
                <SpinButton
                  id={`${id}-${f.key}`}
                  value={api.value<number>(f.key)}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  title={f.tooltip}
                  onChange={(v) => api.set(f.key, v)}
                />
                <span>{f.unit}</span>
              </>
            ) : (
              <div className="conditions-check">
                <Check checked={api.value<boolean>(f.key)} title={f.tooltip} onChange={(on) => api.set(f.key, on)}>
                  {f.label}
                </Check>
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <ResetRow onReset={reset} />
    </div>
  );
}

// ---------------------------------------------------------------- Multiple Passes and Single Pass: "Visible Columns:"

interface ColumnsPageProps extends PageProps {
  checks: readonly ColumnCheck[];
  columns: number;
  /** the key of the preference: a list of the names of the visible columns, in the fixed order of `checks` */
  prefKey: string;
  /** Gpredict gives the Single Pass page a 20 px border */
  bordered?: boolean;
}

function ColumnsPage({ api, reset, checks, columns, prefKey, bordered = false }: ColumnsPageProps) {
  const visible = api.value<string[]>(prefKey);
  const order = checks.map((c) => c.name);
  return (
    <div className="predict-body">
      <Header>Visible Columns:</Header>
      <div
        className={bordered ? "check-grid bordered" : "check-grid"}
        style={{ gridTemplateColumns: `repeat(${columns}, auto)`, justifyContent: "start" }}
      >
        {checkRows(checks, columns).map((row, r) => (
          <Fragment key={r}>
            {row.map((c) => (
              <Check key={c.name} checked={visible.includes(c.name)} onChange={() => api.set(prefKey, toggleColumn(visible, c.name, order))}>
                {c.label}
              </Check>
            ))}
          </Fragment>
        ))}
      </div>
      <ResetRow onReset={reset} />
    </div>
  );
}

// ---------------------------------------------------------------- Sky at a Glance

/** A colour button: a native colour chooser without alpha, as Gpredict's. Its name is the title of Gpredict's chooser, "Select colour n". */
function ColourButton({ api, colour }: { api: PrefsPageApi; colour: SkyColour }) {
  return (
    <input
      type="color"
      className="colour-input"
      value={api.value<string>(colour.key)}
      title={colour.tooltip}
      aria-label={colour.chooserTitle}
      onChange={(e) => api.set(colour.key, e.target.value.toLowerCase())}
    />
  );
}

function SkyPage({ api, reset }: PageProps) {
  const id = useId();
  return (
    <div className="predict-body">
      <Header>Time:</Header>
      <div className="inline-row">
        <label htmlFor={`${id}-hours`}>{SKY_HOURS.label}</label>
        <SpinButton
          id={`${id}-hours`}
          value={api.value<number>(SKY_HOURS.key)}
          min={SKY_HOURS.min}
          max={SKY_HOURS.max}
          step={SKY_HOURS.step}
          title={SKY_HOURS.tooltip}
          onChange={(v) => api.set(SKY_HOURS.key, v)}
        />
        <span>{SKY_HOURS.unit}</span>
      </div>
      <hr className="props-separator" />
      <Header>Colours:</Header>
      <div className="sky-colours">
        {SKY_COLOUR_ROWS.map((row) =>
          row.map((c) => (
            <Fragment key={c.key}>
              <span className="right">{c.label}</span>
              <ColourButton api={api} colour={c} />
            </Fragment>
          )),
        )}
      </div>
      <ResetRow onReset={reset} />
    </div>
  );
}

// ---------------------------------------------------------------- the notebook

function PredictNotebook({ api }: { api: PrefsPageApi }) {
  const [tab, setTab] = useState<PredictPageId>("conditions");
  const id = useId();

  const reset = (which: PredictPageId) => () => api.reset(PAGE_KEYS[which]);

  const tabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : PREDICT_TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target.id);
      document.getElementById(`${id}-tab-${target.id}`)?.focus();
    }
  };

  const page = () => {
    switch (tab) {
      case "conditions":
        return <ConditionsPage api={api} reset={reset("conditions")} />;
      case "multi":
        return (
          <ColumnsPage
            api={api}
            reset={reset("multi")}
            checks={MULTI_PASS_CHECKS}
            columns={CHECK_COLUMNS.multi}
            prefKey="PREDICT/MULTI_PASS_COL"
          />
        );
      case "single":
        return (
          <ColumnsPage
            api={api}
            reset={reset("single")}
            checks={SINGLE_PASS_CHECKS}
            columns={CHECK_COLUMNS.single}
            prefKey="PREDICT/SINGLE_PASS_COL"
            bordered
          />
        );
      case "sky":
        return <SkyPage api={api} reset={reset("sky")} />;
    }
  };

  return (
    <div className="predict-notebook">
      <div className="dtabs" role="tablist">
        {PREDICT_TABS.map((t, i) => (
          <button
            key={t.id}
            id={`${id}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            aria-controls={`${id}-panel`}
            tabIndex={t.id === tab ? 0 : -1}
            className={t.id === tab ? "dtab active" : "dtab"}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => tabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} className="predict-panel" role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
        {page()}
      </div>
    </div>
  );
}

/** The page of the Predict group (a component of its own: the window keeps it, and the tab chosen, while another group is shown). */
export function PredictPages(api: PrefsPageApi): ReactNode {
  return <PredictNotebook api={api} />;
}
