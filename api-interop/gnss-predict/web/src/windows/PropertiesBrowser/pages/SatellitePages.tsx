// หน้าของ Satellite (spec §8): Basic - Orbit, Basic - Description, 2D Graphics - Attributes / Pass / Swath, 3D Graphics - Orbit System
// Basic - Orbit และข้อมูลของดาว (PRN, SVN, Block, ชื่อ CelesTrak, ธง) อ่านอย่างเดียว: มาจาก catalog ของ snapshot ที่ scenario ใช้ ผ่าน NORAD (W9)

import { ENUMS } from "../../../api/enums.gen";
import { satelliteInfo } from "../../../data/catalog";
import { optionLabel, t } from "../../../labels/labels";
import { msg } from "../../../labels/messages.th";
import { useScenario } from "../../../stores/scenario";
import { formatTime } from "../../../time/format";
import { parseIsoUtc } from "../../../time/parse";
import { flagLine } from "../../ObjectBrowser/tree";
import { CheckRow, ChoiceRow, DescriptionRows, Group, NumberRow, ReadOnlyRow, useEditorApi, type PageDef } from "../fields";
import { getAt, swathTypeLabel, timeContextOf, type Tree } from "../form";
import { Attributes2dPage, DESCRIPTION_FIELDS, attributes2dFields } from "./common";

const UNKNOWN = "—";

/** ข้อมูลของดาวใน catalog (ผ่าน NORAD ของหน้า); catalog เปลี่ยนแล้ววาดใหม่ */
function useSatelliteInfo(base: Tree) {
  useScenario((s) => s.catalog);
  const norad = getAt(base, "basic.norad");
  return { norad: typeof norad === "number" ? norad : null, info: typeof norad === "number" ? satelliteInfo(norad) : undefined };
}

function OrbitPage() {
  const { base } = useEditorApi();
  const { norad, info } = useSatelliteInfo(base);
  const doc = useScenario((s) => s.doc);
  const ctx = timeContextOf((doc ?? {}) as unknown as Tree);
  const epoch = info === undefined ? null : parseIsoUtc(info.omm_epoch);
  return (
    <>
      <ReadOnlyRow label={t("field.propagator")} value={t("option.propagator.sgp4")} />
      <ReadOnlyRow label={t("field.tleSource")} value={doc?.orbit_snapshot ?? UNKNOWN} />
      <ReadOnlyRow label={t("field.sscNumber")} value={norad === null ? UNKNOWN : String(norad)} />
      <ReadOnlyRow label={t("field.epoch")} value={epoch === null ? (info?.omm_epoch ?? UNKNOWN) : formatTime(epoch, ctx.format, ctx.offset)} />
      <ReadOnlyRow label={t("field.dataAge")} value={info === undefined || !Number.isFinite(info.age_days) ? UNKNOWN : `${info.age_days.toFixed(2)} ${t("field.unit.days")}`} />
      <p className="props-note">{msg("note.readOnly")}</p>
      {info === undefined && <p className="props-note">{msg("props.noCatalog")}</p>}
    </>
  );
}

function DescriptionPage() {
  const { base } = useEditorApi();
  const { norad, info } = useSatelliteInfo(base);
  return (
    <>
      <ReadOnlyRow label={t("field.prn")} value={info?.prn ?? UNKNOWN} />
      <ReadOnlyRow label={t("field.svn")} value={info?.svn ?? UNKNOWN} />
      <ReadOnlyRow label={t("field.norad")} value={norad === null ? UNKNOWN : String(norad)} />
      <ReadOnlyRow label={t("field.block")} value={info?.block ?? UNKNOWN} />
      <ReadOnlyRow label={t("field.celestrakName")} value={info?.celestrak_name ?? UNKNOWN} />
      <Group title={t("field.flags")}>
        {info === undefined || info.flags.length === 0 ? (
          <p className="props-note">{info === undefined ? msg("props.noCatalog") : msg("props.noFlags")}</p>
        ) : (
          <ul className="props-flags">
            {info.flags.map((flag) => (
              <li key={flag}>{flagLine(flag)}</li>
            ))}
          </ul>
        )}
      </Group>
      <DescriptionRows prefix="basic." />
    </>
  );
}

/** Lead/Trail: ช่องค่าขึ้นเฉพาะ Time (วินาที) และ Percent */
function PassPage() {
  const { values, errors } = useEditorApi();
  const lead = values["graphics2d.pass.lead_type"];
  const trail = values["graphics2d.pass.trail_type"];
  // ช่องค่าที่ซ่อนอยู่แต่ผิด (พิมพ์ผิดแล้วเปลี่ยนชนิด) ต้องเห็นข้อความ จึงแสดงต่อไปจนกว่าจะแก้
  return (
    <>
      <ChoiceRow k="graphics2d.pass.lead_type" label={t("field.leadType")} options={ENUMS.LeadType} labelOf={(c) => optionLabel("lead_type", c)} />
      {(lead === "Time" || errors["graphics2d.pass.lead_time_s"] !== undefined) && <NumberRow k="graphics2d.pass.lead_time_s" label={t("field.leadTime")} unit={t("field.unit.sec")} />}
      {(lead === "Percent" || errors["graphics2d.pass.lead_percent"] !== undefined) && <NumberRow k="graphics2d.pass.lead_percent" label={t("field.leadPercent")} unit={t("field.unit.percent")} />}
      <ChoiceRow k="graphics2d.pass.trail_type" label={t("field.trailType")} options={ENUMS.TrailType} labelOf={(c) => optionLabel("trail_type", c)} />
      {(trail === "Time" || errors["graphics2d.pass.trail_time_s"] !== undefined) && <NumberRow k="graphics2d.pass.trail_time_s" label={t("field.trailTime")} unit={t("field.unit.sec")} />}
      {(trail === "Percent" || errors["graphics2d.pass.trail_percent"] !== undefined) && <NumberRow k="graphics2d.pass.trail_percent" label={t("field.trailPercent")} unit={t("field.unit.percent")} />}
      <ChoiceRow k="graphics2d.pass.visible_sides" label={t("field.visibleSides")} options={ENUMS.VisibleSides} labelOf={(c) => optionLabel("visible_sides", c)} />
      <p className="props-note">{msg("note.visibleSidesBoth")}</p>
      <CheckRow k="graphics2d.pass.show_pass_labels" label={t("field.showPassLabels")} />
      <CheckRow k="graphics2d.pass.show_path_labels" label={t("field.showPathLabels")} />
      <p className="props-note">{msg("note.passLabelsStored")}</p>
    </>
  );
}

function SwathPage() {
  return (
    <>
      <ChoiceRow k="graphics2d.swath.type" label={t("field.swathType")} options={["Ground Elevation"]} labelOf={swathTypeLabel} />
      <NumberRow k="graphics2d.swath.elevation_deg" label={t("field.groundElevation")} unit={t("field.unit.deg")} />
      <ChoiceRow k="graphics2d.swath.options" label={t("field.swathOptions")} options={ENUMS.SwathOptions} labelOf={(c) => optionLabel("swath_options", c)} />
    </>
  );
}

function OrbitSystemPage() {
  return <ChoiceRow k="graphics3d.orbit_system" label={t("field.orbitSystem")} options={ENUMS.OrbitSystem} labelOf={(c) => optionLabel("orbit_system", c)} />;
}

export const SATELLITE_PAGES: readonly PageDef[] = [
  { id: "orbit", title: "page.satellite.basicOrbit", Component: OrbitPage, fields: [] },
  { id: "description", title: "page.satellite.basicDescription", Component: DescriptionPage, fields: DESCRIPTION_FIELDS },
  { id: "attributes", title: "page.satellite.graphics2dAttributes", Component: () => <Attributes2dPage satellite />, fields: attributes2dFields(true) },
  {
    id: "pass", title: "page.satellite.graphics2dPass", Component: PassPage,
    fields: [
      "graphics2d.pass.lead_type", "graphics2d.pass.lead_time_s", "graphics2d.pass.lead_percent", "graphics2d.pass.trail_type",
      "graphics2d.pass.trail_time_s", "graphics2d.pass.trail_percent", "graphics2d.pass.visible_sides", "graphics2d.pass.show_pass_labels",
      "graphics2d.pass.show_path_labels",
    ],
  },
  { id: "swath", title: "page.satellite.graphics2dSwath", Component: SwathPage, fields: ["graphics2d.swath.type", "graphics2d.swath.elevation_deg", "graphics2d.swath.options"] },
  { id: "orbitSystem", title: "page.satellite.graphics3dOrbitSystem", Component: OrbitSystemPage, fields: ["graphics3d.orbit_system"] },
];
