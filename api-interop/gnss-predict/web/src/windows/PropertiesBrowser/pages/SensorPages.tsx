// หน้าของ Sensor (spec §5.2, STK ref §G): Basic - Definition, Basic - Pointing, Basic - Description, 2D Graphics - Attributes, 3D Graphics - Attributes
// ชนิดที่ v1 มีค่าเดียว (Sensor Type = Simple Conic, Pointing Type = Fixed, Orientation Method = Az-El, About Boresight = Rotate) แสดงแบบอ่านอย่างเดียว
// ดาวแม่ (Parent) อ่านอย่างเดียวในหน้า Basic - Description: server ไม่ให้ย้าย Sensor ไปดาวอื่น (สร้าง Sensor ใหม่ที่ดาวนั้นแทน)

import { ENUMS } from "../../../api/enums.gen";
import { optionLabel, t } from "../../../labels/labels";
import { CheckRow, ColorRow, DescriptionRows, NumberRow, ReadOnlyRow, useEditorApi, type PageDef } from "../fields";
import { getAt } from "../form";
import { DESCRIPTION_FIELDS } from "./common";

/** ค่าที่ server เก็บของช่องอ่านอย่างเดียว (ไม่มี = ค่าเดียวที่ v1 รู้จัก) */
function storedText(base: Record<string, unknown>, key: string, fallback: string): string {
  const raw = getAt(base, key);
  return typeof raw === "string" ? raw : fallback;
}

function DefinitionPage() {
  const { base } = useEditorApi();
  const type = storedText(base, "basic.definition.type", ENUMS.SensorDefinitionType[0]);
  return (
    <>
      <ReadOnlyRow label={t("field.sensorType")} value={optionLabel("sensor_type", type)} />
      <NumberRow k="basic.definition.cone_half_angle" label={t("field.coneHalfAngle")} unit={t("field.unit.deg")} />
    </>
  );
}

function PointingPage() {
  const { base } = useEditorApi();
  const type = storedText(base, "basic.pointing.type", ENUMS.SensorPointingType[0]);
  const orientation = storedText(base, "basic.pointing.orientation", ENUMS.SensorOrientation[0]);
  const about = storedText(base, "basic.pointing.about_boresight", ENUMS.SensorAboutBoresight[0]);
  return (
    <>
      <ReadOnlyRow label={t("field.pointingType")} value={optionLabel("pointing_type", type)} />
      <ReadOnlyRow label={t("field.orientationMethod")} value={optionLabel("orientation", orientation)} />
      <NumberRow k="basic.pointing.azimuth" label={t("field.azimuth")} unit={t("field.unit.deg")} />
      <NumberRow k="basic.pointing.elevation" label={t("field.elevation")} unit={t("field.unit.deg")} />
      <ReadOnlyRow label={t("field.aboutBoresight")} value={optionLabel("about_boresight", about)} />
    </>
  );
}

function DescriptionPage() {
  const { base } = useEditorApi();
  return (
    <>
      <DescriptionRows prefix="basic." />
      <ReadOnlyRow label={t("field.parentObject")} value={storedText(base, "basic.parent", "—")} />
    </>
  );
}

function Attributes2dPage() {
  return (
    <>
      <CheckRow k="graphics2d.show" label={t("ob.show")} />
      <ColorRow k="graphics2d.color" label={t("field.color")} clearable={false} />
      <CheckRow k="graphics2d.fill" label={t("field.fill")} />
      <NumberRow k="graphics2d.fill_translucency" label={t("field.translucency")} />
    </>
  );
}

function Attributes3dPage() {
  return (
    <>
      <CheckRow k="graphics3d.show" label={t("ob.show")} />
      <ColorRow k="graphics3d.color" label={t("field.color")} clearable={false} />
      <CheckRow k="graphics3d.show_radial_lines" label={t("field.showRadialLines")} />
      <CheckRow k="graphics3d.show_boresight_marker" label={t("field.showBoresightMarker")} />
    </>
  );
}

export const SENSOR_PAGES: readonly PageDef[] = [
  { id: "definition", title: "page.sensor.definition", Component: DefinitionPage, fields: ["basic.definition.cone_half_angle"] },
  { id: "pointing", title: "page.sensor.pointing", Component: PointingPage, fields: ["basic.pointing.azimuth", "basic.pointing.elevation"] },
  // Basic - Description ใช้ป้ายของ object อื่น (ข้อความเดียวกัน ไม่มีคีย์ของ Sensor โดยเฉพาะ)
  { id: "description", title: "page.satellite.basicDescription", Component: DescriptionPage, fields: DESCRIPTION_FIELDS },
  { id: "attributes2d", title: "page.sensor.attributes2d", Component: Attributes2dPage, fields: ["graphics2d.show", "graphics2d.color", "graphics2d.fill", "graphics2d.fill_translucency"] },
  { id: "attributes3d", title: "page.sensor.attributes3d", Component: Attributes3dPage, fields: ["graphics3d.show", "graphics3d.color", "graphics3d.show_radial_lines", "graphics3d.show_boresight_marker"] },
];
