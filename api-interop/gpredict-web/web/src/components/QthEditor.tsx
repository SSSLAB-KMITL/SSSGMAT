import { useState } from "react";
import type { FormEvent } from "react";
import { errorText, putQth } from "../api";
import { sanitizeModuleName } from "../moduleName";
import {
  canSaveQth,
  clearQthForm,
  COORDINATE_DIGITS,
  editCoordinates,
  editLocator,
  EMPTY_QTH_FORM,
  formToQth,
  NO_CITY_LIST_TIP,
  NO_WEATHER_LIST_TIP,
  QTH_LIMITS,
  QTH_TIPS,
  qthNameError,
} from "../qthForm";
import type { Qth } from "../types";
import { FloatingWindow } from "./FloatingWindow";
import { LaterButton } from "./formParts";
import { SpinButton } from "./SpinButton";

interface Props {
  /** the names of the ground stations that exist */
  existing: readonly string[];
  onClose: () => void;
  /** the station was saved on the server (PUT /api/qth/{name}) */
  onSaved: (qth: Qth) => void;
}

/**
 * The "Edit ground station data" dialog (ref §10), opened by the Add button of Create new module / Edit module: Name,
 * Description, Location (with a Select button that is off, ของเรา), Latitude and Longitude with North / South and East / West,
 * the Locator that follows them and that they follow, Altitude in "m ASL", Weather St (Select off too) and the buttons Clear,
 * Cancel and OK. OK is off until a valid name is entered. A refusal of the server is shown in Thai in the dialog.
 */
export function QthEditor({ existing, onClose, onSaved }: Props) {
  const [form, setForm] = useState(EMPTY_QTH_FORM);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clash = qthNameError(form.name, existing);
  const canSave = canSaveQth(form) && clash === null && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = await putQth(formToQth(form));
      onSaved(saved);
      onClose();
    } catch (err) {
      setFailure(errorText(err));
      setBusy(false);
    }
  };

  return (
    <FloatingWindow title="Edit ground station data" onClose={onClose} width={440}>
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
          <LaterButton title={NO_CITY_LIST_TIP}>Select</LaterButton>

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
            value={form.alt}
            min={0}
            max={QTH_LIMITS.alt}
            step={1}
            page={100}
            title={QTH_TIPS.alt}
            onChange={(alt) => setForm({ ...form, alt })}
          />
          <span>m ASL</span>
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
          <LaterButton title={NO_WEATHER_LIST_TIP}>Select</LaterButton>
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
    </FloatingWindow>
  );
}
