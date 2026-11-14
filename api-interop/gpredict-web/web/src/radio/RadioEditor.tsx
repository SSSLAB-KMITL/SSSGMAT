import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Check } from "../components/formParts";
import { Modal } from "../components/Modal";
import { SpinButton } from "../components/SpinButton";
import {
  clashText,
  cleanName,
  clearRadioForm,
  editorToRadio,
  findClash,
  HOST_MAX,
  hostError,
  NAME_MAX,
  onPttChange,
  onTypeChange,
  onVfoChange,
  PTT_LABELS,
  RADIO_TIPS,
  RADIO_TYPE_LABELS,
  RANGES,
  VFO_LABELS,
} from "./hwconfForm";
import type { RadioForm } from "./hwconfForm";
import type { RadioConf } from "./types";

interface Props {
  /** what the editor starts with: ADD_NEW_RADIO, or the radio that is edited (radioToEditor) */
  initial: RadioForm;
  /** the radios in the window, and the name of the one that is edited (null for a new radio) */
  existing: readonly RadioConf[];
  editing: string | null;
  onOk: (radio: RadioConf) => void;
  onCancel: () => void;
}

/**
 * The "Edit radio configuration" dialog (ref-R §8.2, sat-pref-rig-editor.c), a modal: Name, Host, Port, Radio type, PTT status,
 * VFO Up/Down, LO Down, LO Up, Default downlink, Default uplink and the four signalling boxes, with the buttons Clear, Cancel and Ok.
 * Ok is off while the Name is empty (like Gpredict), and (ของเรา) while the name is one of another radio or the Host is empty: the
 * server would refuse those when Preferences is closed with OK. Choosing the type, PTT or VFO applies the rules of onTypeChange, onPttChange and onVfoChange.
 */
export function RadioEditor({ initial, existing, editing, onOk, onCancel }: Props) {
  const [form, setForm] = useState(initial);
  const id = useId();
  const clash = findClash(existing, form.name, editing);
  const noHost = hostError(form.host);
  const canSave = form.name !== "" && clash === null && noHost === null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave) onOk(editorToRadio(form));
  };
  const combo = (labels: readonly string[]) =>
    labels.map((label, i) => (
      <option key={label} value={i}>
        {label}
      </option>
    ));

  return (
    <Modal title="Edit radio configuration" onEscape={onCancel}>
      <form className="dialog hw-editor" onSubmit={submit}>
        <div className="hw-grid hw-radio">
          <label className="right" htmlFor={`${id}-name`}>
            Name
          </label>
          <input
            id={`${id}-name`}
            className="dialog-entry hw-span3"
            type="text"
            value={form.name}
            maxLength={NAME_MAX}
            title={RADIO_TIPS.name}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
            onChange={(e) => setForm({ ...form, name: cleanName(e.target.value) })}
          />
          {clash !== null && (
            <p className="hw-field-error" role="alert">
              {clashText("radio", clash)}
            </p>
          )}

          <label className="right" htmlFor={`${id}-host`}>
            Host
          </label>
          <input
            id={`${id}-host`}
            className="dialog-entry hw-span3"
            type="text"
            value={form.host}
            maxLength={HOST_MAX}
            title={RADIO_TIPS.host}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
          />
          {noHost !== null && (
            <p className="hw-field-error" role="alert">
              {noHost}
            </p>
          )}

          <label className="right" htmlFor={`${id}-port`}>
            Port
          </label>
          <SpinButton
            id={`${id}-port`}
            value={form.port}
            min={RANGES.port.min}
            max={RANGES.port.max}
            title={RADIO_TIPS.port}
            onChange={(port) => setForm({ ...form, port })}
          />
          <span />

          <label className="right" htmlFor={`${id}-type`}>
            Radio type
          </label>
          <select
            id={`${id}-type`}
            className="dialog-entry hw-span2"
            value={form.type}
            title={RADIO_TIPS.type}
            onChange={(e) => setForm(onTypeChange(form, Number(e.target.value)))}
          >
            {combo(RADIO_TYPE_LABELS)}
          </select>
          <span />

          <label className="right" htmlFor={`${id}-ptt`}>
            PTT status
          </label>
          <select
            id={`${id}-ptt`}
            className="dialog-entry hw-span2"
            value={form.ptt}
            title={RADIO_TIPS.ptt}
            onChange={(e) => setForm(onPttChange(form, Number(e.target.value)))}
          >
            {combo(PTT_LABELS)}
          </select>
          <span />

          <label className="right" htmlFor={`${id}-vfo`}>
            VFO Up/Down
          </label>
          <select
            id={`${id}-vfo`}
            className="dialog-entry hw-span2"
            value={form.vfo}
            title={RADIO_TIPS.vfo}
            onChange={(e) => setForm(onVfoChange(form, Number(e.target.value)))}
          >
            {combo(VFO_LABELS)}
          </select>
          <span />

          <label className="right" htmlFor={`${id}-lo`}>
            LO Down
          </label>
          <SpinButton
            id={`${id}-lo`}
            value={form.lo}
            min={RANGES.lo.min}
            max={RANGES.lo.max}
            title={RADIO_TIPS.lo}
            onChange={(lo) => setForm({ ...form, lo })}
          />
          <span>MHz</span>

          <label className="right" htmlFor={`${id}-loup`}>
            LO Up
          </label>
          <SpinButton
            id={`${id}-loup`}
            value={form.loUp}
            min={RANGES.lo.min}
            max={RANGES.lo.max}
            title={RADIO_TIPS.loUp}
            onChange={(loUp) => setForm({ ...form, loUp })}
          />
          <span>MHz</span>

          <label className="right" htmlFor={`${id}-down`}>
            Default downlink
          </label>
          <SpinButton
            id={`${id}-down`}
            value={form.defDown}
            min={RANGES.freq.min}
            max={RANGES.freq.max}
            digits={3}
            step={0.001}
            page={0.01}
            title={RADIO_TIPS.defDown}
            onChange={(defDown) => setForm({ ...form, defDown })}
          />
          <span>MHz</span>

          <label className="right" htmlFor={`${id}-up`}>
            Default uplink
          </label>
          <SpinButton
            id={`${id}-up`}
            value={form.defUp}
            min={RANGES.freq.min}
            max={RANGES.freq.max}
            digits={3}
            step={0.001}
            page={0.01}
            title={RADIO_TIPS.defUp}
            onChange={(defUp) => setForm({ ...form, defUp })}
          />
          <span>MHz</span>

          <span className="right">Signalling</span>
          <Check checked={form.aos} title={RADIO_TIPS.aos} onChange={(aos) => setForm({ ...form, aos })}>
            AOS
          </Check>
          <Check checked={form.los} title={RADIO_TIPS.los} onChange={(los) => setForm({ ...form, los })}>
            LOS
          </Check>
          <span />
          <span />
          <Check checked={form.aoiq} title={RADIO_TIPS.aoiq} onChange={(aoiq) => setForm({ ...form, aoiq })}>
            AOIQ
          </Check>
          <Check checked={form.loiq} title={RADIO_TIPS.loiq} onChange={(loiq) => setForm({ ...form, loiq })}>
            LOIQ
          </Check>
          <span />
        </div>
        <div className="dialog-buttons split">
          <button type="button" className="button" onClick={() => setForm(clearRadioForm(form))}>
            Clear
          </button>
          <span className="grow" />
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={!canSave}>
            Ok
          </button>
        </div>
      </form>
    </Modal>
  );
}
