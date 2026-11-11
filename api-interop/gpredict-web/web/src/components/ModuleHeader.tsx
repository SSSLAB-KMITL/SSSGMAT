import { useEffect, useRef, useState } from "react";
import { formatTime, TIME_PLACEHOLDER } from "../format";
import { MinInterval } from "../throttle";

interface Props {
  /** module time of the newest tick (ISO 8601), null before the first tick */
  time: string | null;
  /** click on the "Module menu" button; the menu itself comes in Task 18 */
  onModuleMenu?: () => void;
}

/**
 * Left: the module time as %Y/%m/%d %H:%M:%S (UTC), refreshed at most once per second.
 * Right: a flat "Module menu" button (icon open-menu-symbolic, ref §1). There is no close button: Close is in the menu.
 * Give it `key={module name}` so that a new module shows its first time at once.
 */
export function ModuleHeader({ time, onModuleMenu }: Props) {
  const [shown, setShown] = useState(TIME_PLACEHOLDER);
  const gate = useRef(new MinInterval(1000));

  useEffect(() => {
    if (time !== null && gate.current.ready()) setShown(formatTime(new Date(time)));
  }, [time]);

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
