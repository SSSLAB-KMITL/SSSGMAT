import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { FloatingWindow } from "../components/FloatingWindow";
import { usePrefs } from "../prefs/prefsStore";
import { PassAzElPlot } from "./PassAzElPlot";
import { PassPolarPlot } from "./PassPolarPlot";
import { rowCell, SINGLE_COLUMNS } from "./passCells";
import { columnTitles, detailsTitle, visibleColumns } from "./passWindows";
import { printLines, printPass } from "./printPass";
import { SavePassDialog } from "./SavePassDialog";
import type { PassInfo, PassQth, PassSat } from "./types";

const SINGLE_COLUMNS_KEY = "PREDICT/SINGLE_PASS_COL";

type TabId = "data" | "polar" | "azel";

// (ของเรา) Gpredict's tab labels have a theme icon (`format-justify-fill`) and two PNG files; these small drawings stand for them
const ICONS: Record<TabId, ReactNode> = {
  data: <path d="M1 3h12M1 5.7h12M1 8.3h12M1 11h12" />,
  polar: (
    <>
      <circle cx="7" cy="7" r="5.5" />
      <circle cx="7" cy="7" r="2.8" />
      <path d="M7 0.5v13M0.5 7h13" />
    </>
  ),
  azel: <path d="M1 1v12h12M2.5 11c2-6 4-8 5-8s2.5 3 4 8" />,
};

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "polar", label: "Polar" },
  { id: "azel", label: "Az/El" },
];

interface Props {
  answer: { sat: PassSat; qth: PassQth; pass: PassInfo };
  onClose: () => void;
  /** where the window opens, in client px */
  position: { x: number; y: number };
}

/**
 * A Pass details window (ref-P §2, spec §5): not modal, so several can be open. Three tabs, "Data" (the table of the pass with the
 * columns that are on in Single Pass), "Polar" and "Az/El"; and the buttons Print, Save and Close (the default: it has the focus,
 * so Enter closes). There is no header or summary text: the title is all there is (`Pass details for %s (orbit %d)`).
 *
 * - Print opens the browser's print dialog for the table (printPass.ts). Save opens "Save Pass Details".
 * - The columns come from Preferences; until they have arrived the table is empty and Print and Save wait.
 * - The tabs are one on top of the other, so the window does not change its size when the tab does (as the notebook of GTK, which is
 *   as big as its biggest page). The plots' minimum sizes are 200 x 200 (Polar) and 300 x 300 (Az/El), in styles.css.
 */
export function PassDetails({ answer, onClose, position }: Props) {
  const { sat, qth, pass } = answer;
  const prefs = usePrefs();
  const titles = prefs === null ? null : columnTitles(prefs.values[SINGLE_COLUMNS_KEY]);
  const columns = visibleColumns(SINGLE_COLUMNS, titles ?? []);
  const [tab, setTab] = useState<TabId>("data");
  const [saving, setSaving] = useState(false);
  const title = detailsTitle(sat, pass);

  const print = () => {
    if (titles !== null) printPass(title, printLines(answer, titles));
  };
  const tabKey = (e: ReactKeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target.id);
      (e.currentTarget.parentElement?.querySelector(`[data-tab="${target.id}"]`) as HTMLElement | null)?.focus();
    }
  };

  return (
    <>
      <FloatingWindow title={title} onClose={onClose} initialPosition={position}>
        <div className="dialog pass-window">
          <div className="dtabs" role="tablist">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                aria-selected={t.id === tab}
                tabIndex={t.id === tab ? 0 : -1}
                className={t.id === tab ? "dtab pass-tab active" : "dtab pass-tab"}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => tabKey(e, i)}
              >
                <svg className="pass-tab-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                  {ICONS[t.id]}
                </svg>
                {t.label}
              </button>
            ))}
          </div>
          <div className="pass-panels">
            <div className="pass-panel data" role="tabpanel" aria-hidden={tab !== "data"}>
              <table className="sat-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.title}>{c.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pass.rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.title} className={`align-${c.align}`}>
                          {rowCell(row, c.title)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pass-panel polar" role="tabpanel" aria-hidden={tab !== "polar"}>
              <div className="pass-plot">
                <PassPolarPlot pass={pass} qthName={qth.name} />
              </div>
            </div>
            <div className="pass-panel azel" role="tabpanel" aria-hidden={tab !== "azel"}>
              <div className="pass-plot">
                <PassAzElPlot pass={pass} />
              </div>
            </div>
          </div>
          <div className="dialog-buttons">
            <button type="button" className="button" disabled={titles === null} onClick={print}>
              Print
            </button>
            <button type="button" className="button" disabled={titles === null} onClick={() => setSaving(true)}>
              Save
            </button>
            <button type="button" className="button" data-autofocus onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </FloatingWindow>
      {/* outside the window: a modal inside it would sit under the windows in front of it */}
      {saving && titles !== null && <SavePassDialog kind="one" answer={answer} columns={titles} onClose={() => setSaving(false)} />}
    </>
  );
}
