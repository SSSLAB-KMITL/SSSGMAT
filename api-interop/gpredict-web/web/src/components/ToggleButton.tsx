interface Props {
  title: string;
  /** the state the server has: the button is shown pressed in */
  pressed: boolean;
  /** greyed out, and a press does nothing */
  disabled?: boolean;
  onToggle: (on: boolean) => void;
  children: string;
}

/** A GtkToggleButton (Radio Control and Antenna Control): it shows the state the server has, and a press asks for the other one. */
export function ToggleButton({ title, pressed, disabled = false, onToggle, children }: Props) {
  return (
    <button type="button" className="button rc-toggle" title={title} aria-pressed={pressed} disabled={disabled} onClick={() => onToggle(!pressed)}>
      {children}
    </button>
  );
}
