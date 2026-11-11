// The dialogs that are open (floating windows: several can be open, each once). Pure.

export type Dialog =
  | { kind: "open" } // File → Open module: "Select a module"
  | { kind: "tle" } // Edit → Update TLE data from network: "TLE Update"
  | { kind: "help" } // Help → Online help
  | { kind: "license" } // Help → License
  | { kind: "about" } // Help → About Gpredict Web
  | { kind: "clone"; module: string } // Module menu → Clone...
  | { kind: "delete"; module: string }; // Module menu → Delete

export const dialogKey = (d: Dialog): string => ("module" in d ? `${d.kind}:${d.module}` : d.kind);

/** The list with `d` added at the end (in front); the same list if that dialog is open already. */
export function showDialog(list: readonly Dialog[], d: Dialog): readonly Dialog[] {
  return list.some((o) => dialogKey(o) === dialogKey(d)) ? list : [...list, d];
}

export function closeDialog(list: readonly Dialog[], d: Dialog): readonly Dialog[] {
  return list.filter((o) => dialogKey(o) !== dialogKey(d));
}
