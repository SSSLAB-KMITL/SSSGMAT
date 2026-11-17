// Preferences → General → TLE Update (ref-D §4, sat-pref-tle.c): the "Auto-Update" block (the age to check, what to do when the TLEs are too
// old), the "Update from the Internet" block (proxy and the list of TLE sources, which a double click edits) and the check box "Add new
// satellites to local database", then Reset. Every change goes to the window's draft (PrefsPageApi); OK of the window saves it. The
// labels and tooltips are in tlePrefs.ts.

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check } from "../components/formParts";
import { MessageBox } from "../components/MessageBox";
import type { PrefsPageApi } from "./prefGroups";
import {
  ACTION_ITEMS,
  ACTION_LABEL,
  ADD_NEW,
  addSource,
  AUTO_UPDATE_HEADER,
  deleteSource,
  editSource,
  FREQ_ITEMS,
  FREQ_LABEL,
  INTERNET_HEADER,
  LAST_SOURCE_MESSAGE,
  PROXY_LABEL,
  PROXY_MAX,
  PROXY_TIP,
  SOURCE_BUTTONS,
  SOURCES_LABEL,
  SOURCES_TIP,
  TLE_KEYS,
  TLE_PAGE_KEYS,
  TLE_RESET_TIP,
} from "./tlePrefs";

/**
 * The text of a source while it is edited (a GtkCellRendererText's entry): it takes the focus with the text selected, Enter or leaving it
 * keeps what was typed, Escape drops it. `onDone` gets the text, or null for Escape, once.
 */
function SourceEdit({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return; // Enter or Escape removes the entry, which can take the focus away as well
    done.current = true;
    onDone(text);
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      type="text"
      className="tle-source-edit"
      aria-label={SOURCES_LABEL}
      autoComplete="off"
      spellCheck={false}
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault(); // the window must not take this Escape for Cancel
          finish(null);
        }
      }}
    />
  );
}

export function TleUpdatePage({ api }: { api: PrefsPageApi }) {
  const id = useId();
  const urls = api.value<string[]>(TLE_KEYS.urls);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [lastSource, setLastSource] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  // the selected row is kept in view (Add scrolls to the new row, `:153`)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, urls.length]);

  const add = () => {
    setSelected(urls.length); // the new row is selected; it is not edited, as in Gpredict (`:156`)
    api.set(TLE_KEYS.urls, addSource(urls));
  };
  const remove = () => {
    const next = deleteSource(urls, selected);
    if (next === "last") setLastSource(true);
    else if (selected !== null && selected < urls.length) {
      api.set(TLE_KEYS.urls, next);
      setSelected(null);
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // a key typed in the entry of a row being edited is the entry's
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const to = (selected ?? (e.key === "ArrowDown" ? -1 : urls.length)) + (e.key === "ArrowDown" ? 1 : -1);
      setSelected(Math.max(0, Math.min(urls.length - 1, to)));
    } else if ((e.key === "Enter" || e.key === "F2") && selected !== null) {
      // (ของเรา) Gpredict edits a row with the mouse only; the keyboard has no other way to
      e.preventDefault();
      setEditing(selected);
    }
  };

  return (
    <div className="general-body tle-page">
      <b className="props-header">{AUTO_UPDATE_HEADER}</b>
      <div className="tle-freq-row">
        <label htmlFor={`${id}-freq`}>{FREQ_LABEL}</label>
        <select id={`${id}-freq`} className="tle-combo" value={api.value<number>(TLE_KEYS.freq)} onChange={(e) => api.set(TLE_KEYS.freq, Number(e.target.value))}>
          {FREQ_ITEMS.map((item, value) => (
            <option key={item} value={value}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <span>{ACTION_LABEL}</span>
      {ACTION_ITEMS.map((item) => (
        <label key={item.value} className="check">
          <input
            type="radio"
            name={`${id}-action`}
            checked={api.value<number>(TLE_KEYS.action) === item.value}
            onChange={() => api.set(TLE_KEYS.action, item.value)}
          />
          {item.label}
        </label>
      ))}
      <hr className="props-separator" />
      <b className="props-header">{INTERNET_HEADER}</b>
      <div className="tle-grid">
        <label className="tle-grid-label" htmlFor={`${id}-proxy`}>
          {PROXY_LABEL}
        </label>
        <input
          id={`${id}-proxy`}
          type="text"
          className="format-entry"
          maxLength={PROXY_MAX}
          autoComplete="off"
          spellCheck={false}
          title={PROXY_TIP}
          value={api.value<string>(TLE_KEYS.proxy)}
          onChange={(e) => api.set(TLE_KEYS.proxy, e.target.value)}
        />
        <span className="tle-grid-label top" id={`${id}-sources`}>
          {SOURCES_LABEL}
        </span>
        {/* the list has no header row: one editable column */}
        <div ref={list} className="hw-list tle-list" role="listbox" aria-labelledby={`${id}-sources`} tabIndex={0} title={SOURCES_TIP} onKeyDown={key}>
          {urls.map((url, i) => (
            <div
              // a row is its place in the list: two rows can hold the same text, and an edited row stays the same row
              key={i}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? "dialog-row tle-source selected" : "dialog-row tle-source"}
              onClick={() => setSelected(i)}
              onDoubleClick={() => {
                setSelected(i);
                setEditing(i);
              }}
            >
              {editing === i ? (
                <SourceEdit
                  initial={url}
                  onDone={(text) => {
                    setEditing(null);
                    if (text !== null && text !== url) api.set(TLE_KEYS.urls, editSource(urls, i, text));
                    list.current?.focus({ preventScroll: true });
                  }}
                />
              ) : (
                url
              )}
            </div>
          ))}
        </div>
        <span />
        <div className="hw-buttons">
          <button type="button" className="button" title={SOURCE_BUTTONS.add.tip} onClick={add}>
            {SOURCE_BUTTONS.add.label}
          </button>
          <button type="button" className="button" title={SOURCE_BUTTONS.delete.tip} onClick={remove}>
            {SOURCE_BUTTONS.delete.label}
          </button>
        </div>
      </div>
      <hr className="props-separator" />
      <Check checked={api.value<boolean>(TLE_KEYS.addNew)} title={ADD_NEW.tip} onChange={(on) => api.set(TLE_KEYS.addNew, on)}>
        {ADD_NEW.label}
      </Check>
      <div className="general-reset">
        <button
          type="button"
          className="button"
          title={TLE_RESET_TIP}
          onClick={() => {
            setEditing(null); // the rows are the default ones now: the row that was selected or edited is another row or none
            setSelected(null);
            api.reset(TLE_PAGE_KEYS);
          }}
        >
          Reset
        </button>
      </div>
      {lastSource && (
        // Gpredict's message dialog: error icon, the text, OK
        <MessageBox message={{ code: "TLE_LAST_SOURCE", level: "error", text: LAST_SOURCE_MESSAGE, object: null }} onOk={() => setLastSource(false)} />
      )}
    </div>
  );
}
