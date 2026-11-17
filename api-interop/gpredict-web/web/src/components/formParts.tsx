import type { ReactNode } from "react";

interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** the tooltip */
  title?: string;
  children: ReactNode;
}

/** A GtkCheckButton: the box and its label, one tooltip for both. */
export function Check({ checked, onChange, title, children }: CheckProps) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
