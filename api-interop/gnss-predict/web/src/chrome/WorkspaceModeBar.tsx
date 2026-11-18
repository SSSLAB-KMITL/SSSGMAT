import { useId } from "react";
import { useLayout } from "../stores/layout";
import { useScenario } from "../stores/scenario";
import { useWorkspaceMode } from "../stores/workspaceMode";

let requestId = 0;

export function WorkspaceModeBar() {
  const id = useId();
  const mode = useWorkspaceMode(s => s.mode);
  const mounted = useLayout(s => s.api !== null);
  const scenarioOpen = useScenario(s => s.name !== null);
  const general = mode === "satellites";
  const chooseSatellites = () => {
    useLayout.getState().openPanel("satelliteCatalog", {
      catalogMode: mode, requestId: ++requestId,
      ...(general ? { importFormat: "gpredict_local", expandImport: true } : {}),
    });
  };
  return <div className="workspace-mode-bar" role="group" aria-label="โหมดการทำงาน">
    <label htmlFor={id}>โหมดการทำงาน</label>
    <select id={id} value={mode} onChange={e => useWorkspaceMode.getState().setMode(e.target.value === "satellites" ? "satellites" : "gnss")}>
      <option value="gnss">GNSS</option>
      <option value="satellites">ดาวเทียมทั่วไป / Gpredict</option>
    </select>
    <button type="button" disabled={!mounted} onClick={() => useLayout.getState().openPanel("newScenarioWizard")}>สร้าง Scenario</button>
    <button type="button" disabled={!mounted || !scenarioOpen} onClick={chooseSatellites}>
      {general ? "เลือกดาว / นำเข้าจาก Gpredict" : "เลือกดาว GNSS"}
    </button>
    <button type="button" disabled={!mounted} onClick={() => useLayout.getState().openPanel("satelliteCatalog", { catalogMode: "satellites", priorityOpen: true, requestId: ++requestId })}>ดาวไทย / รายการสำคัญ</button>
    <span className="workspace-mode-hint">{general ? "วงโคจร · Access · นำเข้าดาวสูงสุด 999 ดวง" : "GPS · GLONASS · Galileo · BeiDou · DOP / IPP"}</span>
  </div>;
}
