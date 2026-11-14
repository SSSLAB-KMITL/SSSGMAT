import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { errorText, putQth } from "../api";
import type { LocationRow, SelectMode } from "../locations";
import { sanitizeModuleName } from "../moduleName";
import {
  altFromShown,
  altMax,
  altShown,
  altUnit,
  applyLocation,
  applyWeather,
  canSaveQth,
  clearQthForm,
  COORDINATE_DIGITS,
  editCoordinates,
  editLocator,
  EMPTY_QTH_FORM,
  formToQth,
  QTH_LIMITS,
  QTH_TIPS,
  qthNameError,
  qthToForm,
} from "../qthForm";
import type { Qth } from "../types";
import { FloatingWindow } from "./FloatingWindow";
import { LocationSelector } from "./LocationSelector";
import { Modal } from "./Modal";
import { SpinButton } from "./SpinButton";

interface CommonProps {
  /** the altitude is shown in feet ("ft ASL", range 0 to 5000 m in feet) and typed in feet, and is stored in metres (GLOBAL/USE_IMPERIAL) */
  imperial: boolean;
  onClose: () => void;
}

type Props = CommonProps &
  (
    | {
        /** Create new module / Edit module, Add: OK saves the station on the server at once (PUT /api/qth/{name}), in a window over the page */
        mode: "save";
        /** the names of the ground stations that exist */
        existing: readonly string[];
        /** the station was saved on the server */
        onSaved: (qth: Qth) => void;
      }
    | {
        /** Preferences → Ground Stations, Add new and Edit: OK hands the station back and writes nothing (the list is written by OK of Preferences), in a modal */
        mode: "draft";
        /** the station that is edited, null for a new one */
        initial: Qth | null;
        /** the names the other stations of the list have: the station may not take one of them (ignoring case) */
        taken: readonly string[];
        /** OK: the station as entered */
        onSaved: (qth: Qth) => void;
      }
  );

/**
 * The "Edit ground station data" dialog (ref §10), in two places: the Add button of Create new module / Edit module (`mode` "save": a window
 * that saves the station at once) and Add new and Edit of Preferences → Ground Stations (`mode` "draft": a modal that gives the station back).
 * Name, Description, Location (with a Select button: the list of cities, which fills Location, Latitude, Longitude, Altitude and Weather St),
 * Latitude and Longitude with North / South and East / West, the Locator that follows them and that they follow, Altitude in "m ASL" or "ft ASL",
 * Weather St (with a Select button for the weather station only) and the buttons Clear, Cancel and OK. OK is off until a valid name is entered.
 * A refusal of the server is shown in Thai in the dialog. (ของเรา: the name may not be one that another station has, and Imperial works in
 * both places; Gpredict's Add of the module dialog saves the typed number as it is, as metres, under "ft ASL".)
 */
export function QthEditor(props: Props) {
  const { imperial, onClose } = props;
  const [form, setForm] = useState(() => (props.mode === "draft" && props.initial !== null ? qthToForm(props.initial) : EMPTY_QTH_FORM));
  const [selecting, setSelecting] = useState<SelectMode | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clash = qthNameError(form.name, props.mode === "draft" ? props.taken : props.existing);
  const canSave = canSaveQth(form) && clash === null && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (props.mode === "draft") {
      props.onSaved(formToQth(form));
      onClose();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      props.onSaved(await putQth(formToQth(form)));
      onClose();
    } catch (err) {
      setFailure(errorText(err));
      setBusy(false);
    }
  };

  const picked = (row: LocationRow) => {
    setForm(selecting === "weather" ? applyWeather(form, row) : applyLocation(form, row));
    setSelecting(null);
  };

  const body = (
    <form className="dialog" onSubmit={(e) => void submit(e)}>
      <div className="qth-grid">
        <label htmlFor="qth-name">Name</label>
        <input
          id="qth-name"
          className="dialog-entry qth-wide"
          type="text"
          value={form.name}
          maxLength={QTH_LIMITS.name}
          title={QTH_TIPS.name}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          onChange={(e) => setForm({ ...form, name: sanitizeModuleName(e.target.value) })}
        />

        <label htmlFor="qth-description">Description</label>
        <input
          id="qth-description"
          className="dialog-entry qth-wide"
          type="text"
          value={form.description}
          maxLength={QTH_LIMITS.description}
          title={QTH_TIPS.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <label htmlFor="qth-location">Location</label>
        <input
          id="qth-location"
          className="dialog-entry qth-span2"
          type="text"
          value={form.location}
          maxLength={QTH_LIMITS.location}
          title={QTH_TIPS.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
        <button type="button" className="button" title={QTH_TIPS.selectLocation} onClick={() => setSelecting("location")}>
          Select
        </button>

        <label htmlFor="qth-lat">Latitude (°)</label>
        <SpinButton
          id="qth-lat"
          value={form.lat}
          min={0}
          max={QTH_LIMITS.lat}
          digits={COORDINATE_DIGITS}
          step={0.01}
          page={1}
          title={QTH_TIPS.lat}
          onChange={(lat) => setForm(editCoordinates(form, { lat }))}
        />
        <select
          className="dialog-entry"
          aria-label="North / South"
          value={form.south ? "S" : "N"}
          onChange={(e) => setForm(editCoordinates(form, { south: e.target.value === "S" }))}
        >
          <option value="N">North</option>
          <option value="S">South</option>
        </select>
        <span />

        <label htmlFor="qth-lon">Longitude (°)</label>
        <SpinButton
          id="qth-lon"
          value={form.lon}
          min={0}
          max={QTH_LIMITS.lon}
          digits={COORDINATE_DIGITS}
          step={0.01}
          page={1}
          title={QTH_TIPS.lon}
          onChange={(lon) => setForm(editCoordinates(form, { lon }))}
        />
        <select
          className="dialog-entry"
          aria-label="East / West"
          value={form.west ? "W" : "E"}
          onChange={(e) => setForm(editCoordinates(form, { west: e.target.value === "W" }))}
        >
          <option value="E">East</option>
          <option value="W">West</option>
        </select>
        <span />

        <label htmlFor="qth-locator">Locator</label>
        <input
          id="qth-locator"
          className="dialog-entry qth-locator"
          type="text"
          value={form.locator}
          maxLength={QTH_LIMITS.locator}
          title={QTH_TIPS.locator}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setForm(editLocator(form, e.target.value))}
        />
        <span />
        <span />

        <label htmlFor="qth-alt">Altitude</label>
        <SpinButton
          id="qth-alt"
          value={altShown(form.alt, imperial)}
          min={0}
          max={altMax(imperial)}
          step={1}
          page={100}
          title={QTH_TIPS.alt}
          onChange={(shown) => setForm({ ...form, alt: altFromShown(shown, imperial) })}
        />
        <span>{altUnit(imperial)}</span>
        <span />

        <label htmlFor="qth-weather">Weather St</label>
        <input
          id="qth-weather"
          className="dialog-entry qth-span2"
          type="text"
          value={form.weather}
          maxLength={QTH_LIMITS.weather}
          title={QTH_TIPS.weather}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setForm({ ...form, weather: e.target.value })}
        />
        <button type="button" className="button" title={QTH_TIPS.selectWeather} onClick={() => setSelecting("weather")}>
          Select
        </button>
      </div>
      {(clash ?? failure) !== null && (
        <p className="dialog-error" role="alert">
          {clash ?? failure}
        </p>
      )}
      <div className="dialog-buttons split">
        <button type="button" className="button" onClick={() => setForm(clearQthForm())}>
          Clear
        </button>
        <span className="grow" />
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSave}>
          OK
        </button>
      </div>
    </form>
  );

  // the list of cities is a modal of its own, a sibling of the editor so that it is not inside the form
  const shell: ReactNode =
    props.mode === "draft" ? (
      <Modal title="Edit ground station data" onEscape={onClose}>
        <div className="qth-editor">{body}</div>
      </Modal>
    ) : (
      <FloatingWindow title="Edit ground station data" onClose={onClose} width={440}>
        {body}
      </FloatingWindow>
    );
  return (
    <>
      {shell}
      {selecting !== null && <LocationSelector mode={selecting} onPick={picked} onClose={() => setSelecting(null)} />}
    </>
  );
}
