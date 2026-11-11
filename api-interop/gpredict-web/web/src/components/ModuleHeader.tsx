import { useEffect, useState } from "react";
import { formatTime, TIME_PLACEHOLDER } from "../format";
import { TimeLabel } from "../timeLabel";

interface Props {
  /** module time of the newest tick (ISO 8601), null before the first tick */
  time: string | null;
  /** click on the "Module menu" button; the menu itself comes in Task 18 */
  onModuleMenu?: () => void;
}

/**
 * Left: the module time as %Y/%m/%d %H:%M:%S (UTC), changing at most once per second but always showing the newest time
 * within a second (TimeLabel; a held-back text is applied by a timer, so a stopped clock or a time jump cannot leave it stale).
 * Right: a flat "Module menu" button (icon open-menu-symbolic, ref §1). There is no close button: Close is in the menu.
 * Give it `key={module name}` so that a new module shows its first time at once.
 */
export function ModuleHeader({ time, onModuleMenu }: Props) {
  const [shown, setShown] = useState(TIME_PLACEHOLDER);
  const [label] = useState(() => new TimeLabel(1000));

  useEffect(() => {
    if (time === null) return;
    const text = formatTime(new Date(time));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const step = label.update(text, Date.now());
      if (step.show !== null) setShown(step.show);
      if (step.waitMs !== null) timer = setTimeout(apply, step.waitMs);
    };
    apply();
    return () => clearTimeout(timer);
  }, [time, label]);

  return (
    <div className="module-header">
      <span className="module-time">{shown}</span>
      <button
        type="button"
        className="button flat icon-button"
        title="Module menu"
        aria-label="Module menu"
        aria-haspopup="menu"
        onClick={onModuleMenu}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}
