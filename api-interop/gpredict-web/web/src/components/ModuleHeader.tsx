import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { TIME_PLACEHOLDER } from "../format";
import { fmtTimeNf, useNumberFormat } from "../numfmt";
import { TimeLabel } from "../timeLabel";

interface Props {
  /** module time of the newest tick (ISO 8601), null before the first tick */
  time: string | null;
  /** click on the "Module menu" button, with the corner of the button where the menu opens (ModuleMenu.tsx) */
  onModuleMenu?: (at: { x: number; y: number }) => void;
  /** the "Module menu" button, so that the open menu can tell a press on it from a press outside */
  menuButton?: RefObject<HTMLButtonElement | null>;
  /** the Module menu is open */
  menuOpen?: boolean;
}

/**
 * Left: the module time in the time format and zone of Preferences > Number Formats (by default %Y/%m/%d %H:%M:%S, UTC), changing
 * at most once per second but always showing the newest time within a second (TimeLabel; a held-back text is applied by a
 * timer, so a stopped clock or a time jump cannot leave it stale).
 * Right: a flat "Module menu" button (icon open-menu-symbolic, ref §1). There is no close button: Close is in the menu.
 * Give it `key={module name}` so that a new module shows its first time at once.
 */
export function ModuleHeader({ time, onModuleMenu, menuButton, menuOpen }: Props) {
  const [shown, setShown] = useState(TIME_PLACEHOLDER);
  const [label] = useState(() => new TimeLabel(1000));
  const nf = useNumberFormat();

  useEffect(() => {
    if (time === null) return;
    const text = fmtTimeNf(time, nf);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const step = label.update(text, Date.now());
      if (step.show !== null) setShown(step.show);
      if (step.waitMs !== null) timer = setTimeout(apply, step.waitMs);
    };
    apply();
    return () => clearTimeout(timer);
  }, [time, label, nf]);

  return (
    <div className="module-header">
      <span className="module-time">{shown}</span>
      <button
        ref={menuButton}
        type="button"
        className="button flat icon-button"
        title="Module menu"
        aria-label="Module menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen === true}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onModuleMenu?.({ x: box.left, y: box.bottom });
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}
