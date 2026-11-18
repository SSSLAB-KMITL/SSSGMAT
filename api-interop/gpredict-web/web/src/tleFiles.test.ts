import { describe, expect, it } from "vitest";
import { chooseDirectory, pickTleFiles, readTleFiles } from "./tleFiles";

const file = (webkitRelativePath: string) => ({ name: webkitRelativePath.split("/").pop()!, webkitRelativePath });

describe("pickTleFiles (tle-update.c:738-757: regular files of the directory itself, .tle or .txt)", () => {
  it("picks top-level tle and txt files", () => {
    const files = ["d/a.TLE", "d/b.txt", "d/c.json", "d/sub/e.tle"].map(file);
    expect(pickTleFiles(files).map((f) => f.name)).toEqual(["a.TLE", "b.txt"]);
  });

  it("does not care about the case of the extension", () => {
    const files = ["d/a.Tle", "d/b.TXT", "d/c.tXt", "d/e.tle"].map(file);
    expect(pickTleFiles(files).map((f) => f.name)).toEqual(["a.Tle", "b.TXT", "c.tXt", "e.tle"]);
  });

  it("leaves out names that only contain the extension in the middle, and files with no extension", () => {
    const files = ["d/a.tle.bak", "d/txt", "d/tle", "d/a.tlex", "d/notes.txt.old"].map(file);
    expect(pickTleFiles(files)).toEqual([]);
  });

  it("keeps the order of the files and gives back the objects it was given", () => {
    const files = ["d/z.txt", "d/a.tle"].map(file);
    const picked = pickTleFiles(files);
    expect(picked).toEqual([files[0], files[1]]);
    expect(picked[0]).toBe(files[0]);
  });

  it("takes a file that has no relative path (not chosen as a directory) as top-level", () => {
    expect(pickTleFiles([{ name: "a.tle", webkitRelativePath: "" }]).map((f) => f.name)).toEqual(["a.tle"]);
  });

  it("gives nothing for nothing", () => {
    expect(pickTleFiles([])).toEqual([]);
  });
});

describe("chooseDirectory (what the folder button shows)", () => {
  it("names the folder by the first part of the relative paths and picks its tle and txt files", () => {
    const choice = chooseDirectory(["tles/a.tle", "tles/sub/b.tle", "tles/c.dat"].map(file));
    expect(choice.folder).toBe("tles");
    expect(choice.picked.map((f) => f.name)).toEqual(["a.tle"]);
  });

  it("names a folder that has no TLE file too", () => {
    const choice = chooseDirectory(["empty/readme.md"].map(file));
    expect(choice.folder).toBe("empty");
    expect(choice.picked).toEqual([]);
  });

  it("has no folder when nothing was chosen", () => {
    expect(chooseDirectory([])).toEqual({ folder: null, picked: [] });
  });
});

describe("readTleFiles (the body of POST /api/tle/local)", () => {
  it("reads every file as text and keeps its name, in order", async () => {
    const texts: Record<string, string> = { "a.tle": "AAA", "b.txt": "BBB" };
    const picked = [file("d/a.tle"), file("d/b.txt")];
    const body = await readTleFiles(picked, async (f) => texts[f.name]!);
    expect(body).toEqual({ files: [{ name: "a.tle", text: "AAA" }, { name: "b.txt", text: "BBB" }] });
  });

  it("sends no files for no files: Gpredict then counts every satellite as missing", async () => {
    expect(await readTleFiles([], async () => "x")).toEqual({ files: [] });
  });

  it("fails with the failure of the file that could not be read", async () => {
    await expect(readTleFiles([file("d/a.tle")], async () => Promise.reject(new Error("no access")))).rejects.toThrow("no access");
  });
});
