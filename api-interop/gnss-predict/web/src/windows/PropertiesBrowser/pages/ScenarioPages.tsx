// หน้าของ Scenario (spec §8): Basic - Time, Units, Description, Ionosphere, 2D Graphics - Global Attributes
// ค่าที่แก้ส่งกลับด้วย PUT ทั้งเอกสาร (W16) ผ่าน useScenario.putDoc; key ของช่องคือ path ในเอกสาร scenario.json

import { ENUMS } from "../../../api/enums.gen";
import { optionLabel, t } from "../../../labels/labels";
import { CheckRow, ChoiceRow, DescriptionRows, Group, NumberRow, ReadOnlyRow, TextRow, useEditorApi, type PageDef } from "../fields";
import { durationText, timeContextOf } from "../form";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function TimePage() {
  const { base, values } = useEditorApi();
  const ctx = timeContextOf(base);
  return (
    <>
      <Group title={t("field.analysisPeriod")}>
        <TextRow k="analysis_period.start" label={t("field.analysisStart")} />
        <TextRow k="analysis_period.stop" label={t("field.analysisStop")} />
        <ReadOnlyRow label={t("field.duration")} value={durationText(str(values["analysis_period.start"]), str(values["analysis_period.stop"]), ctx)} />
      </Group>
      <Group title={t("field.animation")}>
        <TextRow k="animation.start" label={t("field.animationStartTime")} />
        <ChoiceRow k="animation.update_mode" label={t("field.timeUpdateMode")} options={ENUMS.UpdateMode} labelOf={(c) => optionLabel("update_mode", c)} />
        <NumberRow k="animation.time_step_s" label={t("anim.timeStep")} unit={t("field.unit.sec")} />
        <NumberRow k="animation.x_real_time_multiplier" label={t("anim.xRealTimeMultiplier")} />
        <ChoiceRow k="animation.cycle" label={t("field.animationCycle")} options={ENUMS.Cycle} labelOf={(c) => optionLabel("cycle", c)} />
      </Group>
    </>
  );
}

function UnitsPage() {
  return (
    <>
      <ChoiceRow k="units.date_format" label={t("field.dateFormat")} options={ENUMS.DateFormat} labelOf={(c) => optionLabel("date_format", c)} />
      <TextRow k="units.ltz_offset" label={t("field.ltzOffset")} hint={t("field.unit.offset")} />
      <ReadOnlyRow label={t("field.distance")} value={t("option.unit.kilometers")} />
      <ReadOnlyRow label={t("field.angle")} value={t("option.unit.degrees")} />
    </>
  );
}

const DescriptionPage = () => <DescriptionRows prefix="" />;
const IonospherePage = () => <NumberRow k="ionosphere.shell_km" label={t("field.shellHeight")} />;
const GlobalAttributesPage = () => <CheckRow k="graphics2d_global.show_labels" label={t("field.showLabels")} />;

export const SCENARIO_PAGES: readonly PageDef[] = [
  {
    id: "time", title: "page.scenario.basicTime", Component: TimePage,
    fields: [
      "analysis_period.start", "analysis_period.stop", "animation.start", "animation.update_mode", "animation.time_step_s",
      "animation.x_real_time_multiplier", "animation.cycle",
    ],
  },
  { id: "units", title: "page.scenario.basicUnits", Component: UnitsPage, fields: ["units.date_format", "units.ltz_offset"] },
  { id: "description", title: "page.scenario.basicDescription", Component: DescriptionPage, fields: ["description", "long_description"] },
  { id: "ionosphere", title: "page.scenario.basicIonosphere", Component: IonospherePage, fields: ["ionosphere.shell_km"] },
  { id: "global", title: "page.scenario.graphics2dGlobalAttributes", Component: GlobalAttributesPage, fields: ["graphics2d_global.show_labels"] },
];
