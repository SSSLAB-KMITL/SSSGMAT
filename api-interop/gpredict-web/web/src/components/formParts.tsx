import type { ReactNode } from "react";

interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** the tooltip */
  title?: string;
  /** a feature of a later sub-project: shown, not usable, `title` says which sub-project has it (spec §8.2) */
  later?: boolean;
  children: ReactNode;
}

/** A GtkCheckButton: the box and its label, one tooltip for both. */
export function Check({ checked, onChange, title, later = false, children }: CheckProps) {
  return (
    <label className={later ? "check later" : "check"} title={title}>
      <input type="checkbox" checked={checked} disabled={later} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

interface LaterButtonProps {
  /** the tooltip: which sub-project has the feature, or why it is not there (it stays visible: a disabled button shows none everywhere) */
  title: string;
  className?: string;
  children: ReactNode;
}

/**
 * A button that is shown and cannot be pressed (spec §8.2). It is `aria-disabled` and not `disabled` so that its tooltip
 * shows in every browser; pressing it does nothing.
 */
export function LaterButton({ title, className = "", children }: LaterButtonProps) {
  return (
    <button
      type="button"
      className={`button later ${className}`.trim()}
      aria-disabled="true"
      title={title}
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}
