// Properties Browser (spec §8, STK ref §C): หน้าต่างลอยหนึ่งบานต่อ object ซ้ายเป็นรายการหน้าแบบ "กลุ่ม - หน้า" ขวาเป็นเนื้อหาของหน้า ล่างมี OK / Cancel / Apply / Help
//
// - params = { path, name }: path "*" คือ Scenario (name = ชื่อ scenario), "*/<class>/<name>" คือ object; แต่ละบานแก้ได้เฉพาะ object ของมัน
// - Apply ของ object = PATCH เฉพาะกลุ่มหน้าที่เปลี่ยน; Apply ของ Scenario = PUT ทั้งเอกสารที่แก้เฉพาะส่วนที่หน้าแก้ (W16) ทั้งสองผ่าน useScenario (คิวเขียน ETag)
// - ค่าที่ server ปฏิเสธ (422) ขึ้นที่ช่องนั้นพร้อมข้อความของ server และเลือกหน้าที่มีช่องนั้นให้; ค่าที่ UI อ่านไม่ได้ถูกหยุดก่อนส่ง
// - แท็บอื่นแก้ scenario ระหว่างที่เปิดอยู่: ดู useEditor.ts (ฟอร์มสะอาดตามเงียบ ๆ, ฟอร์มที่แก้ค้างและ object ถูกแก้ = ถามก่อน Apply)

import { useCallback, useId, useState, type KeyboardEvent } from "react";
import { apiGet } from "../../api/client";
import { ConflictBox } from "../../chrome/Dialogs";
import { runCommand } from "../../commands";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario, type ObjectPages } from "../../stores/scenario";
import { EditorContext, type EditorApi, type PageDef } from "./fields";
import { OBJECT_SPECS, SCENARIO_SPECS, mergePatch, sectionsOf, timeContextOf, type ObjectClass, type Tree } from "./form";
import { CONSTELLATION_PAGES } from "./pages/ConstellationPages";
import { FACILITY_PAGES } from "./pages/FacilityPages";
import { SATELLITE_PAGES } from "./pages/SatellitePages";
import { SCENARIO_PAGES } from "./pages/ScenarioPages";
import { useEditor, type EditorConfig } from "./useEditor";

const enc = encodeURIComponent;

type Target = { kind: "scenario"; name: string } | { kind: "object"; cls: ObjectClass; name: string; path: string };

const OBJECT_PAGES: Record<ObjectClass, readonly PageDef[]> = { Facility: FACILITY_PAGES, Satellite: SATELLITE_PAGES, Constellation: CONSTELLATION_PAGES };
const isObjectClass = (x: string | undefined): x is ObjectClass => x === "Facility" || x === "Satellite" || x === "Constellation";

function targetOf(params: { path?: unknown; name?: unknown } | undefined): Target | null {
  const path = typeof params?.path === "string" ? params.path : null;
  if (path === "*") return { kind: "scenario", name: typeof params?.name === "string" ? params.name : (useScenario.getState().name ?? "") };
  const [star, cls, name, ...rest] = path?.split("/") ?? [];
  return star === "*" && isObjectClass(cls) && name !== undefined && name !== "" && rest.length === 0 ? { kind: "object", cls, name, path: path ?? "" } : null;
}

const EMPTY_PAGES: Record<string, Record<string, unknown>> = { basic: {}, graphics2d: {}, graphics3d: {}, constraints: {} };

const mergeInto = (draft: unknown, patch: Tree): void => mergePatch(draft as Tree, patch);

const pagesOf = (target: Target): readonly PageDef[] => (target.kind === "scenario" ? SCENARIO_PAGES : OBJECT_PAGES[target.cls]);

function configFor(target: Target, showPage: (id: string) => void): EditorConfig {
  const pages = pagesOf(target);
  if (target.kind === "scenario") {
    return {
      identity: "*",
      specs: SCENARIO_SPECS,
      pages,
      object: null,
      load: async () => {
        const doc = useScenario.getState().doc;
        if (doc === null) throw new Error("no scenario is open");
        return sectionsOf(doc);
      },
      save: (patch) => useScenario.getState().putDoc((draft) => mergeInto(draft, patch)),
      timeContext: timeContextOf,
      watches: (next, prev) => next.doc !== prev.doc,
      showPage,
    };
  }
  const { cls, name, path } = target;
  return {
    identity: path,
    specs: OBJECT_SPECS[cls],
    pages,
    object: path,
    load: async (signal) => {
      const scenario = useScenario.getState().name;
      if (scenario === null) throw new Error("no scenario is open");
      const { data } = await apiGet<Tree>(`/scenarios/${enc(scenario)}/objects/${cls}/${enc(name)}`, { signal });
      return { ...EMPTY_PAGES, ...data };
    },
    save: (patch) => useScenario.getState().patchObject(cls, name, patch as ObjectPages),
    timeContext: () => ({ format: "UTCG", offset: "+07:00" }),
    watches: (next, prev) => next.etag !== prev.etag,
    showPage,
  };
}

export function PropertiesBrowser({ params, panelId = "propertiesBrowser" }: Partial<PanelProps>) {
  const target = targetOf(params);
  if (target === null) {
    return (
      <div className="props">
        <p className="form-error" role="alert">
          {msg("props.unknownObject", { path: String(params?.path ?? "") })}
        </p>
      </div>
    );
  }
  // หน้าต่างหนึ่งบานต่อ object: เปลี่ยน object = เริ่มใหม่ทั้งหมด (key)
  return <Window key={target.kind === "scenario" ? "*" : target.path} target={target} panelId={panelId} />;
}

function Window({ target, panelId }: { target: Target; panelId: string }) {
  const pages = pagesOf(target);
  const [pageId, setPageId] = useState(pages[0].id);
  const showPage = useCallback((id: string) => setPageId(id), []);
  const config = configFor(target, showPage);
  const editor = useEditor(config);
  const prefix = useId();

  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const tabId = (id: string) => `${prefix}-tab-${id}`;
  const panelDomId = `${prefix}-panel`;

  const moveTab = (event: KeyboardEvent, index: number): void => {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    const to = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : step === 0 ? null : (index + step + pages.length) % pages.length;
    if (to === null) return;
    event.preventDefault();
    setPageId(pages[to].id);
    document.getElementById(tabId(pages[to].id))?.focus();
  };

  const close = (): void => useLayout.getState().closePanel(panelId);
  const ok = async (): Promise<void> => {
    if (await editor.apply()) close();
  };

  const ready = editor.status === "ready" && editor.base !== null;
  const api: EditorApi | null = ready
    ? { base: editor.base as Tree, values: editor.values, errors: editor.errors, set: editor.set, ui: editor.ui, setUi: editor.setUi }
    : null;

  return (
    <div className="props">
      <div className="props-body">
        <div className="props-tabs" role="tablist" aria-orientation="vertical" aria-label={t("window.propertiesBrowser")}>
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={tabId(p.id)}
              className="props-tab"
              aria-selected={p.id === page.id}
              aria-controls={panelDomId}
              tabIndex={p.id === page.id ? 0 : -1}
              onClick={() => setPageId(p.id)}
              onKeyDown={(e) => moveTab(e, i)}
            >
              {t(p.title)}
            </button>
          ))}
        </div>
        <div className="props-page" role="tabpanel" id={panelDomId} aria-labelledby={tabId(page.id)}>
          {editor.status === "loading" && <p className="props-note">{msg("props.loading")}</p>}
          {editor.status === "failed" && (
            <p className="form-error" role="alert">
              {msg("props.loadFailed", { name: target.name, message: editor.loadError ?? "" })}
            </p>
          )}
          {api !== null && (
            <EditorContext.Provider value={api}>
              <fieldset className="props-fields" disabled={editor.busy}>
                <page.Component />
              </fieldset>
            </EditorContext.Provider>
          )}
        </div>
      </div>
      {editor.conflicted && (
        <p className="props-note props-conflict" role="status">
          {msg("props.conflicted")}
        </p>
      )}
      {editor.general !== null && (
        <p className="form-error props-general" role="alert">
          {editor.general}
        </p>
      )}
      <div className="props-buttons">
        <button type="button" className="btn" disabled={!ready || editor.busy} onClick={() => void ok()}>
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button type="button" className="btn" disabled={!ready || editor.busy || !editor.dirty} onClick={() => void editor.apply()}>
          {t("dialog.apply")}
        </button>
        <button type="button" className="btn" onClick={() => runCommand("help.stkReference")}>
          {t("dialog.help")}
        </button>
      </div>
      <ConflictBox open={editor.conflictOpen} onReload={editor.reload} onCancel={editor.dismissConflict} />
    </div>
  );
}

/** ลงทะเบียน Properties Browser เป็นหน้าต่างชนิด propertiesBrowser (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด กุญแจต่อ object และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerPropertiesBrowserPanel(): void {
  const base = getPanelDef("propertiesBrowser");
  if (base === undefined) throw new Error('panel kind "propertiesBrowser" is not registered');
  registerPanel("propertiesBrowser", { ...base, component: PropertiesBrowser });
}
