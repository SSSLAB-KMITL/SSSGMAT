import { memo } from "react";
import { updateTle } from "../api";
import { dialogKey } from "../dialogs";
import type { Dialog } from "../dialogs";
import { PreferencesDialog } from "../prefs/PreferencesDialog";
import { TrspUpdateDialog } from "../radio/TrspUpdateDialog";
import type { ModuleConfig, ModulePins } from "../types";
import { CloneDialog, DeleteDialog } from "./CloneDialog";
import { AboutDialog, LicenseDialog, OnlineHelpDialog } from "./HelpDialogs";
import { LogBrowser } from "./LogBrowser";
import { ModuleDialog } from "./ModuleDialog";
import { OpenModuleDialog } from "./OpenModuleDialog";
import { TleFilesDialog } from "./TleFilesDialog";
import { TleUpdateDialog } from "./TleUpdateDialog";

interface Props {
  dialogs: readonly Dialog[];
  /** the modules that are open, in tab order */
  open: readonly string[];
  /** the names of all the modules */
  modules: readonly string[];
  /** the module whose tab is shown, its configuration (null until it has arrived) and the page's one `save` of it */
  current: string | null;
  config: ModuleConfig | null;
  saveConfig: (change: (config: ModuleConfig) => ModuleConfig, opts?: ModulePins) => Promise<void>;
  /** read the shown module's configuration again (Edit module's OK, which re-creates the module) */
  reloadConfig: () => void;
  hide: (d: Dialog) => void;
  /** File → New module made and opened `name` (`open` are the open modules then) */
  onCreated: (name: string, open: string[]) => void;
  /** File → New module saved a module: the list of modules changed */
  onModuleSaved: () => void;
  onOpened: (name: string, open: string[]) => void;
  onCloned: (name: string, opened: boolean, open: string[]) => void;
  onDeleted: (name: string) => void;
  onTleUpdated: () => void;
}

/** The floating windows of the dialogs that are open. Only re-rendered when one of its props changes, not on every tick. */
export const Dialogs = memo(function Dialogs({
  dialogs,
  open,
  modules,
  current,
  config,
  saveConfig,
  reloadConfig,
  hide,
  onCreated,
  onModuleSaved,
  onOpened,
  onCloned,
  onDeleted,
  onTleUpdated,
}: Props) {
  return (
    <>
      {dialogs.map((d) => {
        const close = () => hide(d);
        switch (d.kind) {
          case "newModule":
            return <ModuleDialog key={dialogKey(d)} target={{ kind: "new", onCreated, onSaved: onModuleSaved }} onClose={close} />;
          case "editModule":
            // it edits the module of the tab that is shown, through the page's one `save` of that module's configuration
            return d.module === current && config !== null ? (
              <ModuleDialog key={dialogKey(d)} target={{ kind: "edit", config, save: saveConfig, reload: reloadConfig }} onClose={close} />
            ) : null;
          case "open":
            return <OpenModuleDialog key={dialogKey(d)} open={open} onClose={close} onOpened={onOpened} />;
          case "logBrowser":
            return <LogBrowser key={dialogKey(d)} onClose={close} />;
          case "tle":
            return <TleUpdateDialog key={dialogKey(d)} source="network" run={updateTle} onClose={close} onUpdated={onTleUpdated} />;
          case "tleFiles":
            return <TleFilesDialog key={dialogKey(d)} onClose={close} onUpdated={onTleUpdated} />;
          case "trsp":
            return <TrspUpdateDialog key={dialogKey(d)} onClose={close} />;
          case "preferences":
            return <PreferencesDialog key={dialogKey(d)} onClose={close} />;
          case "help":
            return <OnlineHelpDialog key={dialogKey(d)} onClose={close} />;
          case "license":
            return <LicenseDialog key={dialogKey(d)} onClose={close} />;
          case "about":
            return <AboutDialog key={dialogKey(d)} onClose={close} />;
          case "clone":
            return <CloneDialog key={dialogKey(d)} module={d.module} existing={modules} onClose={close} onCloned={onCloned} />;
          case "delete":
            return <DeleteDialog key={dialogKey(d)} module={d.module} onClose={close} onDeleted={onDeleted} />;
        }
      })}
    </>
  );
});
