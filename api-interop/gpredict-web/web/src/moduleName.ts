// Names of modules (ref §2, §3): 1 to 25 of 0..9, a..z, A..Z, - and _ (the server's ^[A-Za-z0-9_-]{1,25}$). Pure.

export const MODULE_NAME_MAX = 25;

/** Tooltip of the name entry of Gpredict's Clone Module dialog (gtk-sat-module-popup.c). */
export const NAME_TIP = "Enter a short name for this module.\nAllowed characters: 0..9, a..z, A..Z, - and _";

const ILLEGAL = /[^A-Za-z0-9_-]/g;
const NAME = /^[A-Za-z0-9_-]{1,25}$/;

/** What Gpredict's entry leaves of the text: a character that is not allowed is deleted as it is typed; at most 25 characters. */
export function sanitizeModuleName(text: string): string {
  return text.replace(ILLEGAL, "").slice(0, MODULE_NAME_MAX);
}

export function isModuleName(name: string): boolean {
  return NAME.test(name);
}

const BAD_NAME = "ชื่อ module ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว";

/**
 * (ของเรา) Why the Clone dialog cannot use `name`, in Thai, or null if it can - or if it is empty, which only switches OK off like
 * in Gpredict. The server compares names without regard to case (two files differing in case clash on some disks).
 */
export function cloneNameError(name: string, existing: readonly string[]): string | null {
  if (name === "") return null;
  if (!isModuleName(name)) return BAD_NAME;
  const clash = existing.find((n) => n.toLowerCase() === name.toLowerCase());
  return clash === undefined ? null : `มี module ชื่อ ${clash} อยู่แล้ว`;
}
