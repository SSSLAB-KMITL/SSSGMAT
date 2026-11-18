// The Modules group of Preferences (ref-D §10, spec §9.2): the global values of the six pages of Module properties, which every module
// inherits until its own Module properties change a page. The same notebook as Module properties; here a change of a page writes all its
// keys to the window's draft and Reset puts them back to Gpredict's defaults ("Reset settings to the default values."). The Layout page
// has the Window Placements boxes, which only this group has. The keys and texts are in modulesPrefs.ts.

import { useState } from "react";
import type { ReactNode } from "react";
import { Check } from "../components/formParts";
import { PropsNotebook } from "../components/ModuleProperties";
import type { ModuleProps, PropsTab } from "../moduleProps";
import type { Meta } from "../types";
import { useMeta } from "../useMeta";
import { allKeys, GLOBAL_RESET_TIP, globalProps, resetPage, setPage, WINDOW_PLACEMENTS } from "./modulesPrefs";
import type { PrefsPageApi } from "./prefGroups";

/** "Window Placements:" below the layout (sat-pref-layout.c:326-379): a box is a change of the Layout page, which writes them all. */
function WindowPlacements({ api, props, meta }: { api: PrefsPageApi; props: ModuleProps; meta: Meta }) {
  return (
    <>
      <b className="props-header">Window Placements:</b>
      {WINDOW_PLACEMENTS.filter((w) => meta.global_layout_extra.includes(w.key)).map((w) => (
        <Check
          key={w.key}
          checked={api.value<boolean>(w.key)}
          title={w.tooltip}
          onChange={(on) => {
            setPage(api, props, "layout", meta);
            api.set(w.key, on);
          }}
        >
          {w.label}
        </Check>
      ))}
    </>
  );
}

function ModulesNotebook({ api }: { api: PrefsPageApi }) {
  const meta = useMeta();
  const [tab, setTab] = useState<PropsTab>("layout");
  // (ของเรา) the pages need the server's constants (GET /api/meta), which Gpredict has built in
  if (meta === null) return <p className="dialog-text">กำลังโหลดค่าของ module จาก server...</p>;
  const props = globalProps(Object.fromEntries(allKeys(meta).map((key) => [key, api.value(key)])), meta);
  return (
    <PropsNotebook
      props={props}
      meta={meta}
      tab={tab}
      setTab={setTab}
      onEdit={(page, next) => setPage(api, next, page, meta)}
      onReset={(page) => resetPage(api, page, meta)}
      resetTips={GLOBAL_RESET_TIP}
      layoutExtra={<WindowPlacements api={api} props={props} meta={meta} />}
    />
  );
}

/** The page of the Modules group (a component of its own: the window keeps it, and the tab chosen, while another group is shown). */
export function ModulesPrefsPage(api: PrefsPageApi): ReactNode {
  return <ModulesNotebook api={api} />;
}
