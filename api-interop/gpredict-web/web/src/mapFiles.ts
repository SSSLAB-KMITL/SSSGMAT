// The background maps of the Map View (ref-D §11, map-selector.c, plan decisions 14): the text of the preview of a map in the "Select Map"
// dialog, where a map is fetched from, what is sent when one is uploaded, and the line for the log when a map is missing. Pure.

import { postLog } from "./api";
import type { MapEntry } from "./types";

/** The map the Map View draws when its own is missing (`MODULES/MAP_FILE` default, ref-D §11); the same name as the server's DEFAULT_MAP. */
export const DEFAULT_MAP = "nasa-bmng-07_1024.jpg";

/** The largest image the server takes (MAP_UPLOAD_MAX), in bytes: 10 MB. */
export const MAP_UPLOAD_MAX = 10 * 1024 * 1024;

/** The route that gives the image of a map by its file name (GET /api/maps/{file}; 404 when there is none). */
export const mapUrl = (file: string): string => `/api/maps/${encodeURIComponent(file)}`;

/** `x` (a float, so the digits are exact) as C's `%0.1f`: an exact tie goes to the even digit, where `toFixed` goes up. */
function oneDecimal(x: number): string {
  const tenths = x * 10; // x has at most 24 significant bits, so this is exact
  const floor = Math.floor(tenths);
  const n = tenths - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(tenths);
  return `${Math.floor(n / 10)}.${n % 10}`;
}

/**
 * The size of a file as the preview of Gpredict's file chooser writes it (map-selector.c:46-67): `%0.1f GB`, `%0.1f MB`, `%0.1f kB` above
 * the power of 1024 (strictly), else `%lu B`. C divides as a float (`size / 1024.f`), and so does this.
 */
export function fmtFileSize(bytes: number): string {
  const f = Math.fround;
  if (bytes > 1024 ** 3) return `${oneDecimal(f(f(bytes) / f(1024 * 1024 * 1024)))} GB`;
  if (bytes > 1024 ** 2) return `${oneDecimal(f(f(bytes) / f(1024 * 1024)))} MB`;
  if (bytes > 1024) return `${oneDecimal(f(f(bytes) / 1024))} kB`;
  return `${bytes} B`;
}

/** The caption under the preview (map-selector.c:100-211): "<w>x<h> pixels" and, on the next line, the size. */
export const previewCaption = (m: Pick<MapEntry, "width" | "height" | "bytes">): string => `${m.width}x${m.height} pixels\n${fmtFileSize(m.bytes)}`;

/** The Content-Type of an upload: the server wants image/png for a .png name and image/jpeg for .jpg and .jpeg, whatever the browser calls the file. */
export const uploadContentType = (name: string): "image/png" | "image/jpeg" => (name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");

/**
 * Why the file cannot be uploaded, in Thai, or null if it can: larger than MAP_UPLOAD_MAX. The server refuses a large body too, but it may do
 * so by closing the connection, which the page sees as a network error, so the size is checked before sending. (ของเรา)
 */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (file.size <= MAP_UPLOAD_MAX) return null;
  return `ภาพต้องไม่เกิน ${MAP_UPLOAD_MAX / (1024 * 1024)} MB (ไฟล์ ${file.name} มีขนาด ${fmtFileSize(file.size)})`;
}

/** `maps` with `entry` in it: it replaces the entry of the same file (the map was uploaded again), else it goes among the uploaded maps, which are by name, upper and lower case alike, after Gpredict's. */
export function withEntry(maps: readonly MapEntry[], entry: MapEntry): MapEntry[] {
  const others = maps.filter((m) => m.file !== entry.file);
  const stock = others.filter((m) => m.stock);
  const key = (m: MapEntry) => m.file.toLowerCase();
  const uploaded = [...others.filter((m) => !m.stock), entry].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.file < b.file ? -1 : 1));
  return [...stock, ...uploaded];
}

/** The file selected after `key` was pressed in the list of `files` (Up, Down, Home, End; the list stops at its ends); a key it does not use leaves `current`. */
export function moveSelection(files: readonly string[], current: string | null, key: string): string | null {
  const at = current === null ? -1 : files.indexOf(current);
  const last = files.length - 1;
  switch (key) {
    case "ArrowDown":
      return files[at < 0 ? 0 : Math.min(last, at + 1)] ?? null;
    case "ArrowUp":
      return files[at < 0 ? last : Math.max(0, at - 1)] ?? null;
    case "Home":
      return files[0] ?? null;
    case "End":
      return files[last] ?? null;
    default:
      return current;
  }
}

/** The function the line in the log names: where Gpredict writes it (gtk-sat-map.c). */
const LOG_FUNCTION = "load_map_file";

type Post = (level: 1, fn: string, text: string) => unknown;

/**
 * The maps whose file could not be loaded. Gpredict logs "Could not find map file" and "Using default map" and then draws the default; a
 * view that is drawn again and again must not fill the log, so each missing file is reported once (until `forget`). (ของเรา: the page
 * sends the line to the server's log, POST /api/log.)
 */
export class MissingMaps {
  private readonly reported = new Set<string>();

  constructor(private readonly post: Post) {}

  /**
   * `file` could not be loaded. Says so in the log (ERROR, once for each file) and gives the map to draw instead: the default, or null when
   * the file that is missing is the default itself and there is nothing left to try.
   */
  fallbackFor(file: string): string | null {
    const instead = file === DEFAULT_MAP ? null : DEFAULT_MAP;
    if (!this.reported.has(file)) {
      this.reported.add(file);
      const text = instead === null ? `Could not find map file ${file}` : `Could not find map file ${file}; using default map: ${instead}`;
      // a log line that is refused (no server, a wrong line) is nothing the view can do anything about
      void Promise.resolve(this.post(1, LOG_FUNCTION, text)).catch(() => {});
    }
    return instead;
  }

  /** `file` is there now (it was uploaded): if it goes missing again the log says so again. */
  forget(file: string): void {
    this.reported.delete(file);
  }
}

/** The missing maps of this page: every Map View shares it, so that a map that is missing is reported once whichever view finds it. */
export const missingMaps = new MissingMaps((level, fn, text) => postLog(level, fn, text));
