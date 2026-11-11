import { memo } from "react";
import { dialogKey } from "../dialogs";
import type { Dialog } from "../dialogs";
import { CloneDialog, DeleteDialog } from "./CloneDialog";
import { AboutDialog, LicenseDialog, OnlineHelpDialog } from "./HelpDialogs";
import { OpenModuleDialog } from "./OpenModuleDialog";
import { TleUpdateDialog } from "./TleUpdateDialog";

interface Props {
  dialogs: readonly Dialog[];
  /** the modules that are open, in tab order */
  open: readonly string[];
  /** the names of all the modules */
  modules: readonly string[];
  hide: (d: Dialog) => void;
  onOpened: (name: string, open: string[]) => void;
  onCloned: (name: string, opened: boolean, open: string[]) => void;
  onDeleted: (name: string) => void;
  onTleUpdated: () => void;
}

/** The floating windows of the dialogs that are open. Only re-rendered when one of its props changes, not on every tick. */
export const Dialogs = memo(function Dialogs({ dialogs, open, modules, hide, onOpened, onCloned, onDeleted, onTleUpdated }: Props) {
  return (
    <>
      {dialogs.map((d) => {
        const close = () => hide(d);
        switch (d.kind) {
          case "open":
            return <OpenModuleDialog key={dialogKey(d)} open={open} onClose={close} onOpened={onOpened} />;
          case "tle":
            return <TleUpdateDialog key={dialogKey(d)} onClose={close} onUpdated={onTleUpdated} />;
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
