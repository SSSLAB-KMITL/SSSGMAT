// หน้าที่ Facility และ Satellite ใช้ร่วมกัน

import { ENUMS } from "../../../api/enums.gen";
import { optionLabel, t } from "../../../labels/labels";
import { CheckRow, ChoiceRow, ColorRow, NumberRow } from "../fields";

/** 2D Graphics - Attributes: Color, (Satellite: Line Style, Line Width), Marker Style, Inherit from Scenario */
export function Attributes2dPage({ satellite }: { satellite: boolean }) {
  return (
    <>
      <ColorRow k="graphics2d.color" label={t("field.color")} />
      {satellite && (
        <>
          <ChoiceRow k="graphics2d.line_style" label={t("field.lineStyle")} options={ENUMS.LineStyle} labelOf={(c) => optionLabel("line_style", c)} nullable />
          <NumberRow k="graphics2d.line_width" label={t("field.lineWidth")} />
        </>
      )}
      <ChoiceRow k="graphics2d.marker_style" label={t("field.markerStyle")} options={ENUMS.MarkerStyle} labelOf={(c) => optionLabel("marker_style", c)} nullable />
      <CheckRow k="graphics2d.inherit" label={t("field.inheritFromScenario")} />
    </>
  );
}

export const attributes2dFields = (satellite: boolean): string[] => [
  "graphics2d.color", ...(satellite ? ["graphics2d.line_style", "graphics2d.line_width"] : []), "graphics2d.marker_style", "graphics2d.inherit",
];

/** ช่องของหน้า Basic - Description ของ object (Short และ Long Description) */
export const DESCRIPTION_FIELDS: readonly string[] = ["basic.description", "basic.long_description"];
