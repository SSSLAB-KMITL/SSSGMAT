// When Escape closes a floating window (FloatingWindow.tsx). Pure.

export interface EscapePress {
  key: string;
  /** a control inside has used the key already (a search field clearing itself, say) */
  defaultPrevented: boolean;
  /** the window closes on Escape at all: Radio Control and Antenna Control do not (Gpredict closes them only with the close button, ref-R §1) */
  closeOnEscape: boolean;
  /** the window is the front one */
  front: boolean;
  /** a popup menu is open: Escape closes the menu first */
  popupOpen: boolean;
}

/** Escape closes the front window, unless the window keeps itself open on Escape, a popup menu is open, or a control has used the key. */
export function shouldCloseOnEscape(p: EscapePress): boolean {
  return p.key === "Escape" && !p.defaultPrevented && p.closeOnEscape && p.front && !p.popupOpen;
}
