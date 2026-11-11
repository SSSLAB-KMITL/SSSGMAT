import { useEffect, useMemo, useState } from "react";
import { ApiError, errorText, getModules, getQthList, getSatellite, openModule, putModule } from "../api";
import {
  editModuleChange,
  hasModuleChanges,
  newModuleConfig,
  NO_SATS_ERROR,
  qthChoices,
  sortedSats,
  validateModuleForm,
} from "../moduleForm";
import type { ModuleDraft, SelectedSat } from "../moduleForm";
import { MODULE_NAME_MAX, NAME_TIP, sanitizeModuleName } from "../moduleName";
import { propsOf } from "../moduleProps";
import type { ModuleProps } from "../moduleProps";
import { loadSatNames } from "../satNames";
import type { ModuleConfig, Qth } from "../types";
import { useMeta } from "../useMeta";
import { FloatingWindow } from "./FloatingWindow";
import { ModuleProperties } from "./ModuleProperties";
import { QthEditor } from "./QthEditor";
import { SatSelector } from "./SatSelector";

/** What the dialog does: make a new module (File → New module) or change an open one (Module menu → Configure). */
export type ModuleTarget =
  | {
      kind: "new";
      /** the module was saved and opened (`open` are the open modules then, in tab order) */
      onCreated: (name: string, open: string[]) => void;
      /** the module was saved (the list of modules changed, whether or not it could be opened) */
      onSaved: () => void;
    }
  | {
      kind: "edit";
      /** the open module's configuration as it is now */
      config: ModuleConfig;
      /** the page's one `save` of the open module's configuration (useModuleConfig): the only way to write it */
      save: (change: (config: ModuleConfig) => ModuleConfig) => Promise<void>;
    };

interface Props {
  target: ModuleTarget;
  onClose: () => void;
}

/** Which window opened from the dialog is on top of it, if any. */
type Child = "properties" | "qth" | "overwrite" | null;

/**
 * "Create new module" (File → New module) and "Edit module" (Module menu → Configure), ref §3: the module name (at most 25
 * characters, read only when editing), the Ground station combo with its Add button, the satellite selector, and the buttons
 * Properties, Cancel and OK.
 *
 * New: OK needs at least one satellite, asks before it overwrites a closed module of that name (a module that is open is
 * refused, ของเรา), then PUT /api/modules/{name} and POST .../open. Edit: OK changes the open module only through the page's
 * `save` (an instruction that replaces the ground station, the satellites and the properties that differ), never with a PUT
 * of its own. A refusal of the server is shown in Thai in the dialog.
 */
export function ModuleDialog({ target, onClose }: Props) {
  const meta = useMeta();
  const editing = target.kind === "edit";
  const config = target.kind === "edit" ? target.config : null;

  // what the dialog opened with (Edit module): the changes are the differences from this
  const [initial] = useState<ModuleDraft | null>(() =>
    config === null ? null : { qth: config.qth, satellites: [...config.satellites], props: propsOf(config) },
  );

  const [name, setName] = useState(config?.name ?? "");
  const [qth, setQth] = useState<string | null>(config?.qth ?? null);
  const [qthNames, setQthNames] = useState<string[]>([]);
  const [sats, setSats] = useState<readonly SelectedSat[]>([]);
  const [namesLoaded, setNamesLoaded] = useState(!editing); // Edit module: the names of the satellites have been read
  const [edited, setEdited] = useState<ModuleProps | null>(null); // the properties after OK of Module properties
  const [child, setChild] = useState<Child>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false); // New: the module was saved but could not be opened; OK tries to open it again

  // the ground stations
  useEffect(() => {
    let alive = true;
    getQthList().then(
      (r) => alive && setQthNames(r.qth.map((q) => q.name)),
      (e: unknown) => alive && setFailure(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Edit module: the module keeps NORAD numbers, the list shows names
  useEffect(() => {
    if (config === null) return;
    let alive = true;
    loadSatNames(config.satellites, getSatellite).then((r) => {
      if (!alive) return;
      setSats(sortedSats(r.sats));
      setNamesLoaded(true);
      // a satellite the index does not know (404) is listed by its number and the server will say so on OK; anything else is shown now
      const other = r.failures.find((f) => !(f.error instanceof ApiError && f.error.status === 404));
      if (other !== undefined) setFailure(errorText(other.error));
    });
    return () => {
      alive = false;
    };
    // (only for the configuration the dialog opened with)
  }, []);

  const choices = useMemo(() => qthChoices(qth !== null && !qthNames.includes(qth) ? [...qthNames, qth] : qthNames), [qthNames, qth]);
  const props = edited ?? initial?.props ?? (meta === null ? null : propsOf(meta.module_defaults));

  const finish = async (confirmed: boolean) => {
    setFailure(null);
    setBusy(true);
    try {
      if (target.kind === "edit") await applyEdit(target);
      else await create(target, confirmed);
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Edit module, OK */
  const applyEdit = async (t: Extract<ModuleTarget, { kind: "edit" }>) => {
    if (sats.length === 0) {
      setFailure(NO_SATS_ERROR);
      return;
    }
    const draft: ModuleDraft = { qth, satellites: sats.map((s) => s.norad), props: props! };
    if (!hasModuleChanges(initial!, draft)) {
      onClose();
      return;
    }
    await t.save(editModuleChange(initial!, draft));
    onClose();
  };

  /** New module, OK (`confirmed`: the user said yes to overwriting) */
  const create = async (t: Extract<ModuleTarget, { kind: "new" }>, confirmed: boolean) => {
    if (!saved) {
      // the list the page holds may be out of date (another browser tab): ask the server now
      const now = await getModules();
      const verdict = validateModuleForm({ name, satellites: sats }, now.modules, now.open);
      if (verdict.error !== undefined) {
        setFailure(verdict.error);
        return;
      }
      if (verdict.confirmOverwrite !== undefined && !confirmed) {
        setQuestion(verdict.confirmOverwrite);
        setChild("overwrite");
        return;
      }
      await putModule(newModuleConfig({ name, qth, satellites: sats }, props!, meta!.module_defaults));
      setSaved(true);
      t.onSaved();
    }
    try {
      const r = await openModule(name);
      t.onCreated(name, r.open);
      onClose();
    } catch (e) {
      setFailure(`บันทึก module ${name} แล้ว แต่เปิดไม่ได้: ${errorText(e)}`);
    }
  };

  const qthSaved = (q: Qth) => {
    setQthNames((names) => (names.includes(q.name) ? names : [...names, q.name]));
    setQth(q.name);
  };

  const locked = child !== null || saved; // a window on top of the dialog, or the module is saved already
  const canOk = namesLoaded && props !== null && !busy && child === null && (editing || name !== "");

  return (
    <>
      <FloatingWindow title={editing ? "Edit module" : "Create new module"} onClose={onClose} width={800}>
        <form
          className="dialog module-dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (canOk) void finish(false);
          }}
        >
          <fieldset className="module-fields" disabled={locked}>
            <div className="module-top">
              <label htmlFor="module-name">Module name</label>
              <input
                id="module-name"
                className="dialog-entry"
                type="text"
                value={name}
                maxLength={MODULE_NAME_MAX}
                readOnly={editing}
                title={editing ? undefined : NAME_TIP}
                autoComplete="off"
                spellCheck={false}
                data-autofocus={editing ? undefined : true}
                onChange={(e) => setName(sanitizeModuleName(e.target.value))}
              />
              <label htmlFor="module-qth">Ground station</label>
              <div className="module-qth">
                <select
                  id="module-qth"
                  className="dialog-entry"
                  title="Select a ground station for this module."
                  value={qth ?? ""}
                  onChange={(e) => setQth(e.target.value === "" ? null : e.target.value)}
                >
                  {choices.map((c) => (
                    <option key={c.value ?? ""} value={c.value ?? ""}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="button" title="Add a new ground station" onClick={() => setChild("qth")}>
                  Add
                </button>
              </div>
            </div>
            <hr className="props-separator" />
            <b className="props-header">Satellites</b>
            <SatSelector groups={meta?.tle_groups ?? []} selected={sats} onChange={setSats} loading={!namesLoaded} />
          </fieldset>
          {meta === null && <p className="dialog-text">กำลังโหลดค่าตั้งต้นของ module จาก server...</p>}
          {failure !== null && (
            <p className="dialog-error" role="alert">
              {failure}
            </p>
          )}
          <div className="dialog-buttons split">
            <button
              type="button"
              className="button"
              disabled={locked || meta === null || props === null}
              onClick={() => setChild("properties")}
            >
              Properties
            </button>
            <span className="grow" />
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={!canOk}>
              OK
            </button>
          </div>
        </form>
      </FloatingWindow>
      {child === "properties" && meta !== null && props !== null && (
        <ModuleProperties
          initial={props}
          meta={meta}
          onCancel={() => setChild(null)}
          onOK={(p) => {
            setEdited(p);
            setChild(null);
          }}
        />
      )}
      {child === "qth" && <QthEditor existing={qthNames} onClose={() => setChild(null)} onSaved={qthSaved} />}
      {child === "overwrite" && question !== null && (
        <FloatingWindow title="Overwrite module" onClose={() => setChild(null)}>
          <div className="dialog">
            <p className="dialog-text">{question}</p>
            <div className="dialog-buttons">
              <button type="button" className="button" data-autofocus onClick={() => setChild(null)}>
                No
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setChild(null);
                  void finish(true);
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
