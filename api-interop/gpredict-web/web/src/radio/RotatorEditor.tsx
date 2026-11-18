import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "../components/Modal";
import { SpinButton } from "../components/SpinButton";
import {
  AZ_TYPE_LABELS,
  clashText,
  cleanName,
  clearRotatorForm,
  editorToRotator,
  findClash,
  HOST_MAX,
  hostError,
  NAME_MAX,
  onAzTypeChange,
  RANGES,
  ROTATOR_TIPS,
} from "./hwconfForm";
import type { RotatorForm } from "./hwconfForm";
import type { RotatorConf } from "./types";

interface Props {
  /** what the editor starts with: ADD_NEW_ROTATOR, or the rotator that is edited (rotatorToEditor) */
  initial: RotatorForm;
  /** the rotators in the window, and the name of the one that is edited (null for a new rotator) */
  existing: readonly RotatorConf[];
  editing: string | null;
  onOk: (rotator: RotatorConf) => void;
  onCancel: () => void;
}

/**
 * The "Edit rotator configuration" dialog (ref-R §8.4, sat-pref-rot-editor.c), a modal: Name, Host, Port, a separator, Az type, Min Az and
 * Max Az, Min El and Max El, the azimuth end stop position, with the buttons Clear, Cancel and Ok. Choosing an Az type presets Min Az,
 * Max Az and the end stop (onAzTypeChange). Ok is off while the Name is empty, and (ของเรา) while the name is one of another rotator or the
 * Host is empty. There is no check that Min is below Max, like Gpredict.
 */
export function RotatorEditor({ initial, existing, editing, onOk, onCancel }: Props) {
  const [form, setForm] = useState(initial);
  const id = useId();
  const clash = findClash(existing, form.name, editing);
  const noHost = hostError(form.host);
  const canSave = form.name !== "" && clash === null && noHost === null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave) onOk(editorToRotator(form));
  };

  return (
    <Modal title="Edit rotator configuration" onEscape={onCancel}>
      <form className="dialog hw-editor" onSubmit={submit}>
        <div className="hw-grid">
          <label className="right" htmlFor={`${id}-name`}>
            Name
          </label>
          <input
            id={`${id}-name`}
            className="dialog-entry hw-span3"
            type="text"
            value={form.name}
            maxLength={NAME_MAX}
            title={ROTATOR_TIPS.name}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
            onChange={(e) => setForm({ ...form, name: cleanName(e.target.value) })}
          />
          {clash !== null && (
            <p className="hw-field-error" role="alert">
              {clashText("rotator", clash)}
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
            title={ROTATOR_TIPS.host}
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
            title={ROTATOR_TIPS.port}
            onChange={(port) => setForm({ ...form, port })}
          />
          <span />
          <span />

          <hr className="props-separator hw-full" />

          <label className="right" htmlFor={`${id}-aztype`}>
            Az type
          </label>
          <select
            id={`${id}-aztype`}
            className="dialog-entry hw-span2"
            value={form.azType}
            title={ROTATOR_TIPS.azType}
            onChange={(e) => setForm(onAzTypeChange(form, e.target.value === "1" ? 1 : 0))}
          >
            {AZ_TYPE_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
          <span />

          {/* the labels of Gpredict begin with a space */}
          <label className="right hw-pre" htmlFor={`${id}-minaz`}>
            {" Min Az"}
          </label>
          <SpinButton
            id={`${id}-minaz`}
            value={form.minAz}
            min={RANGES.minAz.min}
            max={RANGES.minAz.max}
            title=""
            onChange={(minAz) => setForm({ ...form, minAz })}
          />
          <label className="right hw-pre" htmlFor={`${id}-maxaz`}>
            {" Max Az"}
          </label>
          <SpinButton
            id={`${id}-maxaz`}
            value={form.maxAz}
            min={RANGES.maxAz.min}
            max={RANGES.maxAz.max}
            title=""
            onChange={(maxAz) => setForm({ ...form, maxAz })}
          />

          <label className="right hw-pre" htmlFor={`${id}-minel`}>
            {" Min El"}
          </label>
          <SpinButton
            id={`${id}-minel`}
            value={form.minEl}
            min={RANGES.el.min}
            max={RANGES.el.max}
            title=""
            onChange={(minEl) => setForm({ ...form, minEl })}
          />
          <label className="right hw-pre" htmlFor={`${id}-maxel`}>
            {" Max El"}
          </label>
          <SpinButton
            id={`${id}-maxel`}
            value={form.maxEl}
            min={RANGES.el.min}
            max={RANGES.el.max}
            title=""
            onChange={(maxEl) => setForm({ ...form, maxEl })}
          />

          <label className="right hw-pre hw-stop-label" htmlFor={`${id}-stop`}>
            {" Azimuth end stop position"}
          </label>
          <SpinButton
            id={`${id}-stop`}
            value={form.azStop}
            min={RANGES.azStop.min}
            max={RANGES.azStop.max}
            title={ROTATOR_TIPS.azStop}
            onChange={(azStop) => setForm({ ...form, azStop })}
          />
        </div>
        <div className="dialog-buttons split">
          <button type="button" className="button" onClick={() => setForm(clearRotatorForm(form))}>
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
