// The General group of Preferences (ref-D §1, sat-pref-general.c): a notebook with the tabs Number Formats, Ground Stations, TLE Update
// and Message Logs. This file has the pages that exist so far (Number Formats, Ground Stations and Message Logs); the others are added to
// `TAB_PAGES` and take their place in Gpredict's order. Every change goes to the window's draft (PrefsPageApi); the labels, items and tooltips are in
// generalPrefs.ts. As in Gpredict, every page is built when the window opens and the tab only chooses which one is seen, so the
// preview of the time format keeps running while another tab is shown.

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check } from "../components/formParts";
import { useMeta } from "../useMeta";
import {
  CLEAN_AGE_ITEMS,
  cleanAgeIndex,
  GENERAL_TABS,
  LOG_CLEAN_AGE_KEY,
  LOG_CLEAN_AGE_LABEL,
  LOG_CLEAN_AGE_TIP,
  LOG_LEVEL_ITEMS,
  LOG_LEVEL_KEY,
  LOG_LEVEL_LABEL,
  LOG_LEVEL_TIP,
  LOG_RESET_TIP,
  logInfoText,
  MESSAGE_LOG_KEYS,
  NUMBER_FORMAT_CONTROLS,
  PREVIEW_START,
  PREVIEW_TICK_MS,
  previewText,
  TIME_FORMAT_RESET_KEYS,
} from "./generalPrefs";
import type { GeneralTab } from "./generalPrefs";
import { GroundStationsPage } from "./GroundStationsPage";
import type { PrefsPageApi } from "./prefGroups";

// ---------------------------------------------------------------- Number Formats

/**
 * The label beside the time format: "now" in the format as it is typed and in the zone as the box is ticked (neither saved yet), rewritten
 * every second by one timer that reads the latest of both, as Gpredict's does, and showing the placeholder until its first tick.
 */
function FormatPreview({ fmt, local }: { fmt: string; local: boolean }) {
  const [text, setText] = useState(PREVIEW_START);
  const latest = useRef({ fmt, local });
  useEffect(() => {
    latest.current = { fmt, local };
  }, [fmt, local]);
  useEffect(() => {
    const timer = setInterval(() => setText(previewText(latest.current.fmt, latest.current.local, new Date())), PREVIEW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return <span className="format-preview">{text}</span>;
}

function NumberFormatsPage({ api }: { api: PrefsPageApi }) {
  const id = useId();
  const c = NUMBER_FORMAT_CONTROLS;
  const local = api.value<boolean>(c.local.key);
  const format = api.value<string>(c.timeFormat.key);
  return (
    <div className="general-body">
      <Check checked={local} title={c.local.tooltip} onChange={(on) => api.set(c.local.key, on)}>
        {c.local.label}
      </Check>
      <div className="format-row">
        <label htmlFor={`${id}-format`}>{c.timeFormat.label}</label>
        <input
          id={`${id}-format`}
          type="text"
          className="format-entry"
          maxLength={c.timeFormat.maxLength}
          autoComplete="off"
          spellCheck={false}
          title={c.timeFormat.tooltip}
          value={format}
          onChange={(e) => api.set(c.timeFormat.key, e.target.value)}
        />
        <FormatPreview fmt={format} local={local} />
        <button type="button" className="button" title={c.timeFormat.resetTooltip} onClick={() => api.reset(TIME_FORMAT_RESET_KEYS)}>
          {c.timeFormat.resetLabel}
        </button>
      </div>
      <hr className="props-separator" />
      <Check checked={api.value<boolean>(c.nsew.key)} title={c.nsew.tooltip} onChange={(on) => api.set(c.nsew.key, on)}>
        {c.nsew.label}
      </Check>
      <hr className="props-separator" />
      <Check checked={api.value<boolean>(c.imperial.key)} title={c.imperial.tooltip} onChange={(on) => api.set(c.imperial.key, on)}>
        {c.imperial.label}
      </Check>
    </div>
  );
}

// ---------------------------------------------------------------- Message Logs

/** Where the info text names the folder before the server has answered (GET /api/meta): Gpredict's own words for it. */
const CONF_DIR_LOGS = "<conf dir>/logs";

function MessageLogsPage({ api }: { api: PrefsPageApi }) {
  const id = useId();
  const meta = useMeta();
  return (
    <div className="general-body">
      <div className="logs-row">
        <label htmlFor={`${id}-level`}>{LOG_LEVEL_LABEL}</label>
        <select
          id={`${id}-level`}
          className="logs-combo"
          title={LOG_LEVEL_TIP}
          value={api.value<number>(LOG_LEVEL_KEY)}
          onChange={(e) => api.set(LOG_LEVEL_KEY, Number(e.target.value))}
        >
          {LOG_LEVEL_ITEMS.map((item, level) => (
            <option key={item} value={level}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="logs-row">
        <label htmlFor={`${id}-age`}>{LOG_CLEAN_AGE_LABEL}</label>
        <select
          id={`${id}-age`}
          className="logs-combo"
          title={LOG_CLEAN_AGE_TIP}
          value={cleanAgeIndex(api.value<number>(LOG_CLEAN_AGE_KEY))}
          onChange={(e) => api.set(LOG_CLEAN_AGE_KEY, CLEAN_AGE_ITEMS[Number(e.target.value)]![1])}
        >
          {CLEAN_AGE_ITEMS.map(([item], i) => (
            <option key={item} value={i}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <hr className="props-separator" />
      <p className="dialog-text">{logInfoText(meta?.log_dir ?? CONF_DIR_LOGS)}</p>
      <div className="general-reset">
        <button type="button" className="button" title={LOG_RESET_TIP} onClick={() => api.reset(MESSAGE_LOG_KEYS)}>
          Reset
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the notebook

/** The page of each tab that has one. TLE Update is added here (sub-project 4, task 18). */
const TAB_PAGES: Partial<Record<GeneralTab, (props: { api: PrefsPageApi }) => ReactNode>> = {
  "Number Formats": NumberFormatsPage,
  "Ground Stations": GroundStationsPage,
  "Message Logs": MessageLogsPage,
};

/** The tabs that have a page, in Gpredict's order. */
const SHOWN_TABS = GENERAL_TABS.filter((t) => TAB_PAGES[t] !== undefined);

function GeneralNotebook({ api }: { api: PrefsPageApi }) {
  const [tab, setTab] = useState<GeneralTab>(SHOWN_TABS[0]!);
  const id = useId();
  const slug = (t: GeneralTab) => t.toLowerCase().replace(/ /g, "-");

  const tabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : SHOWN_TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target);
      document.getElementById(`${id}-tab-${slug(target)}`)?.focus();
    }
  };

  return (
    <div className="general-notebook">
      <div className="dtabs" role="tablist">
        {SHOWN_TABS.map((t, i) => (
          <button
            key={t}
            id={`${id}-tab-${slug(t)}`}
            type="button"
            role="tab"
            aria-selected={t === tab}
            aria-controls={`${id}-panel-${slug(t)}`}
            tabIndex={t === tab ? 0 : -1}
            className={t === tab ? "dtab active" : "dtab"}
            onClick={() => setTab(t)}
            onKeyDown={(e) => tabKey(e, i)}
          >
            {t}
          </button>
        ))}
      </div>
      {SHOWN_TABS.map((t) => {
        const Page = TAB_PAGES[t]!;
        return (
          <div
            key={t}
            id={`${id}-panel-${slug(t)}`}
            className="general-panel"
            role="tabpanel"
            aria-labelledby={`${id}-tab-${slug(t)}`}
            hidden={t !== tab}
          >
            <Page api={api} />
          </div>
        );
      })}
    </div>
  );
}

/** The page of the General group (a component of its own: the window keeps it, and the tab chosen, while another group is shown). */
export function GeneralPages(api: PrefsPageApi): ReactNode {
  return <GeneralNotebook api={api} />;
}
