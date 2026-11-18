// Edit → Update TLE data from local files (ref-D §6, menubar.c:656-798, tle-update.c:738-757): which files of the chosen folder are read and the body
// of the request that sends them. The browser gives a folder as a flat list of all the files under it, each with its path relative to the
// folder's parent (`webkitRelativePath`), so this finds the top-level ones. Pure: components/TleFilesDialog.tsx shows it.

/** What this needs of a `File`. */
export interface FileEntry {
  name: string;
  /** "folder/name" for a file of a chosen folder, "folder/sub/name" below it; empty for a file that was not chosen as part of a folder */
  webkitRelativePath: string;
}

const TLE_NAME = /\.(tle|txt)$/i;

/**
 * The files Gpredict reads: the ones directly in the folder (not in a folder below it) whose name ends in `.tle` or `.txt`, whatever the case
 * (`:738-757`). In the order given, and the objects themselves.
 */
export function pickTleFiles<T extends FileEntry>(files: readonly T[]): T[] {
  return files.filter((f) => f.webkitRelativePath.split("/").length <= 2 && TLE_NAME.test(f.name));
}

/** What the folder button shows and the update reads. */
export interface DirectoryChoice<T extends FileEntry> {
  /** the name of the folder, null when nothing was chosen */
  folder: string | null;
  picked: T[];
}

/** The choice for what `<input webkitdirectory>` gave: the folder's name (the first part of any path, so also for a folder with no TLE file) and its TLE files. */
export function chooseDirectory<T extends FileEntry>(files: readonly T[]): DirectoryChoice<T> {
  const path = files[0]?.webkitRelativePath ?? "";
  return { folder: path.includes("/") ? path.split("/")[0]! : null, picked: pickTleFiles(files) };
}

/** The body of POST /api/tle/local: each file's name and its text (`read` gives it; a file that cannot be read rejects the whole). */
export async function readTleFiles<T extends FileEntry>(picked: readonly T[], read: (file: T) => Promise<string>): Promise<{ files: { name: string; text: string }[] }> {
  const texts = await Promise.all(picked.map(read));
  return { files: picked.map((f, i) => ({ name: f.name, text: texts[i]! })) };
}
