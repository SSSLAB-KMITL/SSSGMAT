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
