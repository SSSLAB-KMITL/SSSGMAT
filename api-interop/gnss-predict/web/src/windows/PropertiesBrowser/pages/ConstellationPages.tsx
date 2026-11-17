// หน้าของ Constellation (spec §8): Basic - Definition (Available / Assigned Objects) และ Basic - Description (+ สีของสมาชิก)
// รายการสมาชิกเรียงตามที่ผู้ใช้ย้าย: ตัวที่ย้ายเข้าต่อท้าย Assigned ตามลำดับที่เห็นใน Available

import { useId, useMemo, useState } from "react";
import { t } from "../../../labels/labels";
import { useScenario } from "../../../stores/scenario";
import { ColorRow, DescriptionRows, useEditorApi, type PageDef } from "../fields";
import { DESCRIPTION_FIELDS } from "./common";

const KEY = "basic.assigned_objects";
const nameOf = (path: string): string => path.split("/").at(-1) ?? path;
const selectedOf = (el: HTMLSelectElement): string[] => Array.from(el.selectedOptions, (o) => o.value);

/** ดาวของ scenario ที่เปิดอยู่ (path ตามลำดับในเอกสาร) */
function useSatellitePaths(): string[] {
  const doc = useScenario((s) => s.doc);
  return useMemo(() => (doc?.objects ?? []).filter((o) => o.class === "Satellite").map((o) => `*/Satellite/${o.name}`), [doc]);
}

function DefinitionPage() {
  const api = useEditorApi();
  const satellites = useSatellitePaths();
  const [filter, setFilter] = useState("");
  const [pickedAvailable, setPickedAvailable] = useState<string[]>([]);
  const [pickedAssigned, setPickedAssigned] = useState<string[]>([]);
  const ids = { available: useId(), assigned: useId(), filter: useId() };

  const raw = api.values[KEY];
  const assigned = useMemo(() => (Array.isArray(raw) ? raw : []), [raw]);
  const available = satellites.filter((p) => !assigned.includes(p));
  const needle = filter.trim().toLowerCase();
  // Selection Filter กรองรายการ Available (ที่จะเลือกมาใส่) ค้นตามชื่อ ไม่สนตัวพิมพ์
  const shown = needle === "" ? available : available.filter((p) => nameOf(p).toLowerCase().includes(needle));

  const assign = (paths: string[]): void => {
    if (paths.length === 0) return;
    api.set(KEY, [...assigned, ...paths]);
    setPickedAvailable([]);
  };
  const unassign = (paths: string[]): void => {
    if (paths.length === 0) return;
    api.set(KEY, assigned.filter((p) => !paths.includes(p)));
    setPickedAssigned([]);
  };

  return (
    <div className="definition">
      <div className="definition-filter">
        <label htmlFor={ids.filter}>{t("field.selectionFilter")}</label>
        <input id={ids.filter} className="field" type="text" value={filter} spellCheck={false} autoComplete="off" onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="definition-lists">
        <div className="definition-list">
          <label htmlFor={ids.available}>{t("field.availableObjects")}</label>
          <select
            id={ids.available}
            className="field pick-list"
            multiple
            size={10}
            value={pickedAvailable.filter((p) => shown.includes(p))}
            onChange={(e) => setPickedAvailable(selectedOf(e.target))}
          >
            {shown.map((p) => (
              <option key={p} value={p}>
                {nameOf(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="pick-buttons">
          <button type="button" className="btn" aria-label={t("dialog.assign")} title={t("dialog.assign")} disabled={pickedAvailable.length === 0} onClick={() => assign(shown.filter((p) => pickedAvailable.includes(p)))}>
            →
          </button>
          <button type="button" className="btn" aria-label={t("dialog.unassign")} title={t("dialog.unassign")} disabled={pickedAssigned.length === 0} onClick={() => unassign(assigned.filter((p) => pickedAssigned.includes(p)))}>
            ←
          </button>
          <button type="button" className="btn" aria-label={t("dialog.assignAll")} title={t("dialog.assignAll")} disabled={shown.length === 0} onClick={() => assign(shown)}>
            ⇒
          </button>
          <button type="button" className="btn" aria-label={t("dialog.unassignAll")} title={t("dialog.unassignAll")} disabled={assigned.length === 0} onClick={() => unassign(assigned)}>
            ⇐
          </button>
        </div>
        <div className="definition-list">
          <label htmlFor={ids.assigned}>{t("field.assignedObjects")}</label>
          <select
            id={ids.assigned}
            className="field pick-list"
            multiple
            size={10}
            aria-invalid={api.errors[KEY] === undefined ? undefined : true}
            value={pickedAssigned.filter((p) => assigned.includes(p))}
            onChange={(e) => setPickedAssigned(selectedOf(e.target))}
          >
            {assigned.map((p) => (
              <option key={p} value={p}>
                {nameOf(p)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {api.errors[KEY] !== undefined && (
        <div className="form-error" role="alert">
          {api.errors[KEY]}
        </div>
      )}
    </div>
  );
}

/** Description + สีของสมาชิก (เพิ่มเอง): สีของ Constellation ที่ใช้กับดาวสมาชิก */
function DescriptionPage() {
  return (
    <>
      <DescriptionRows prefix="basic." />
      <ColorRow k="basic.color" label={t("field.memberColors")} />
    </>
  );
}

export const CONSTELLATION_PAGES: readonly PageDef[] = [
  { id: "definition", title: "page.constellation.basicDefinition", Component: DefinitionPage, fields: [KEY] },
  { id: "description", title: "page.constellation.basicDescription", Component: DescriptionPage, fields: [...DESCRIPTION_FIELDS, "basic.color"] },
];

