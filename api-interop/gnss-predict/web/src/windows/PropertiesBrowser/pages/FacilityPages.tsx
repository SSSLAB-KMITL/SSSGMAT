// หน้าของ Facility (spec §8): Basic - Position, Basic - Description, Constraints - Active, 2D Graphics - Attributes

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { t } from "../../../labels/labels";
import { msg } from "../../../labels/messages.th";
import { DescriptionRows, Group, NumberRow, ReadOnlyRow, useEditorApi, type PageDef } from "../fields";
import { getAt } from "../form";
import { Attributes2dPage, DESCRIPTION_FIELDS, attributes2dFields } from "./common";

function PositionPage() {
  return (
    <>
      <ReadOnlyRow label={t("field.positionType")} value={t("option.positionType.geodetic")} />
      <NumberRow k="basic.position.lat_deg" label={t("field.latitude")} unit={t("field.unit.deg")} />
      <NumberRow k="basic.position.lon_deg" label={t("field.longitude")} unit={t("field.unit.deg")} />
      <NumberRow k="basic.position.alt_m" label={t("field.altitude")} unit={t("field.unit.m")} />
    </>
  );
}

const DescriptionPage = () => <DescriptionRows prefix="basic." />;

const ELEVATION = "elevation";
const MIN = "constraints.elevation_angle_min_deg";
const MAX = "constraints.elevation_angle_max_deg";

/** Select Constraints to Add: v1 มีเฉพาะ Elevation Angle */
function AddConstraintDialog({ open, listed, onAdd, onClose }: { open: boolean; listed: boolean; onAdd(): void; onClose(): void }) {
  const [choice, setChoice] = useState("");
  const close = (): void => {
    setChoice("");
    onClose();
  };
  const add = (): void => {
    setChoice("");
    onAdd();
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-form" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{t("field.selectConstraintsToAdd")}</Dialog.Title>
          <div className="form">
            {listed ? (
              <p className="props-note">{msg("props.noAvailable")}</p>
            ) : (
              <select className="field pick-list" size={4} aria-label={t("field.selectConstraintsToAdd")} value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value={ELEVATION}>{t("field.elevationAngle")}</option>
              </select>
            )}
            <div className="dlg-buttons">
              <button type="button" className="btn" disabled={listed || choice !== ELEVATION} onClick={add}>
                {t("dialog.ok")}
              </button>
              <button type="button" className="btn" onClick={close}>
                {t("dialog.cancel")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * รายการ constraint ที่ใช้อยู่: Elevation Angle อยู่ในรายการเมื่อ min != 0 หรือ max != null หรือผู้ใช้ Add... ไว้ (สถานะนี้อยู่ที่ ui ของฟอร์ม ไม่ใช่ค่าของ server)
 * Remove ตั้ง min เป็น 0 และ max เป็นว่าง (null)
 */
function ConstraintsPage() {
  const api = useEditorApi();
  const [adding, setAdding] = useState(false);
  const min = getAt(api.base, MIN);
  const max = getAt(api.base, MAX);
  const active = (typeof min === "number" && min !== 0) || (max !== undefined && max !== null);
  const listed = api.ui[ELEVATION] ?? active;

  const remove = (): void => {
    api.set(MIN, "0");
    api.set(MAX, "");
    api.setUi(ELEVATION, false);
  };

  return (
    <>
      <Group title={t("field.active")}>
        <div className="pick-row">
          <ul className="pick-list field" role="listbox" aria-label={t("field.active")}>
            {listed && (
              <li role="option" aria-selected="true" className="pick-item">
                {t("field.elevationAngle")}
              </li>
            )}
          </ul>
          <div className="pick-buttons">
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              {t("dialog.add")}
            </button>
            <button type="button" className="btn" disabled={!listed} onClick={remove}>
              {t("dialog.remove")}
            </button>
          </div>
        </div>
        {!listed && <p className="props-note">{msg("props.noConstraints")}</p>}
      </Group>
      {listed && (
        <Group title={t("field.elevationAngle")}>
          <NumberRow k={MIN} label={t("field.min")} unit={t("field.unit.deg")} />
          <NumberRow k={MAX} label={t("field.max")} unit={t("field.unit.deg")} />
        </Group>
      )}
      <AddConstraintDialog
        open={adding}
        listed={listed}
        onAdd={() => {
          api.setUi(ELEVATION, true);
          setAdding(false);
        }}
        onClose={() => setAdding(false)}
      />
    </>
  );
}

export const FACILITY_PAGES: readonly PageDef[] = [
  { id: "position", title: "page.facility.basicPosition", Component: PositionPage, fields: ["basic.position.lat_deg", "basic.position.lon_deg", "basic.position.alt_m"] },
  { id: "description", title: "page.facility.basicDescription", Component: DescriptionPage, fields: DESCRIPTION_FIELDS },
  { id: "constraints", title: "page.facility.constraintsActive", Component: ConstraintsPage, fields: [MIN, MAX] },
  { id: "attributes", title: "page.facility.graphics2dAttributes", Component: () => <Attributes2dPage satellite={false} />, fields: attributes2dFields(false) },
];
