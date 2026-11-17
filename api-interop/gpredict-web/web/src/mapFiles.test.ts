import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAP,
  fmtFileSize,
  MAP_UPLOAD_MAX,
  MissingMaps,
  mapUrl,
  moveSelection,
  previewCaption,
  uploadContentType,
  uploadProblem,
  withEntry,
} from "./mapFiles";
import type { MapEntry } from "./types";

describe("fmtFileSize (map-selector.c get_map_humanize_size)", () => {
  it("file size", () => {
    expect(fmtFileSize(1024)).toBe("1024 B");
    expect(fmtFileSize(1025)).toBe("1.0 kB");
    expect(fmtFileSize(94680)).toBe("92.5 kB");
  });

  it("goes up a unit only above the power of 1024 (strict >)", () => {
    expect(fmtFileSize(0)).toBe("0 B");
    expect(fmtFileSize(1023)).toBe("1023 B");
    expect(fmtFileSize(1024 * 1024)).toBe("1024.0 kB");
    expect(fmtFileSize(1024 * 1024 + 1)).toBe("1.0 MB");
    expect(fmtFileSize(1024 ** 3)).toBe("1024.0 MB");
    expect(fmtFileSize(1024 ** 3 + 1)).toBe("1.0 GB"); // (a float in C, which cannot tell 1024^3 + 1 from 1024^3)
    expect(fmtFileSize(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("rounds an exact tie to even as printf does, not up as toFixed does", () => {
    expect(fmtFileSize(1280)).toBe("1.2 kB"); // 1.25
    expect(fmtFileSize(1792)).toBe("1.8 kB"); // 1.75
    expect(fmtFileSize(1536)).toBe("1.5 kB");
    expect(fmtFileSize(Math.round(2.25 * 1024 * 1024))).toBe("2.2 MB");
  });

  it("is the size of the stock maps as the file chooser of Gpredict shows it", () => {
    expect(fmtFileSize(1_572_864)).toBe("1.5 MB");
    expect(fmtFileSize(371_000)).toBe("362.3 kB");
  });
});

describe("previewCaption", () => {
  it("is <w>x<h> pixels, a line break and the size", () => {
    expect(previewCaption({ width: 1024, height: 512, bytes: 94680 })).toBe("1024x512 pixels\n92.5 kB");
    expect(previewCaption({ width: 800, height: 400, bytes: 900 })).toBe("800x400 pixels\n900 B");
  });
});

describe("mapUrl", () => {
  it("is the route of the server, with the name as one segment", () => {
    expect(mapUrl("nasa-bmng-07_1024.jpg")).toBe("/api/maps/nasa-bmng-07_1024.jpg");
    expect(mapUrl("a b.png")).toBe("/api/maps/a%20b.png");
  });
});

describe("uploadContentType", () => {
  it("follows the extension of the name, not what the browser says of the file", () => {
    expect(uploadContentType("a.png")).toBe("image/png");
    expect(uploadContentType("A.PNG")).toBe("image/png");
    expect(uploadContentType("a.jpg")).toBe("image/jpeg");
    expect(uploadContentType("a.JPEG")).toBe("image/jpeg");
  });
});

describe("uploadProblem", () => {
  it("accepts a file of up to 10 MB and says in Thai why it does not take a larger one", () => {
    expect(MAP_UPLOAD_MAX).toBe(10 * 1024 * 1024);
    expect(uploadProblem({ name: "a.jpg", size: MAP_UPLOAD_MAX })).toBeNull();
    expect(uploadProblem({ name: "a.jpg", size: MAP_UPLOAD_MAX + 1 })).toBe("ภาพต้องไม่เกิน 10 MB (ไฟล์ a.jpg มีขนาด 10.0 MB)");
  });

  it("names the size of a file that is far too big", () => {
    expect(uploadProblem({ name: "big.png", size: 52_428_800 })).toBe("ภาพต้องไม่เกิน 10 MB (ไฟล์ big.png มีขนาด 50.0 MB)");
  });
});

describe("a map file that is missing (plan decision 14)", () => {
  const MISSING = "Could not find map file gone.jpg; using default map: nasa-bmng-07_1024.jpg";

  it("missing map falls back to the default", () => {
    const post = vi.fn();
    const maps = new MissingMaps(post);
    expect(maps.fallbackFor("gone.jpg")).toBe("nasa-bmng-07_1024.jpg");
    expect(maps.fallbackFor("gone.jpg")).toBe(DEFAULT_MAP); // the next redraw or the next view: the same, and no second line in the log
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(1, "load_map_file", MISSING);
  });

  it("sends one ERROR for each file that is missing", () => {
    const post = vi.fn();
    const maps = new MissingMaps(post);
    maps.fallbackFor("one.jpg");
    maps.fallbackFor("two.png");
    maps.fallbackFor("one.jpg");
    expect(post.mock.calls.map((c) => c[2])).toEqual([
      "Could not find map file one.jpg; using default map: nasa-bmng-07_1024.jpg",
      "Could not find map file two.png; using default map: nasa-bmng-07_1024.jpg",
    ]);
  });

  it("has nothing to fall back to when the default is the one that is missing, but says so once", () => {
    const post = vi.fn();
    const maps = new MissingMaps(post);
    expect(maps.fallbackFor(DEFAULT_MAP)).toBeNull();
    expect(maps.fallbackFor(DEFAULT_MAP)).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(1, "load_map_file", `Could not find map file ${DEFAULT_MAP}`);
  });

  it("says it again after the file was uploaded and is missing again", () => {
    const post = vi.fn();
    const maps = new MissingMaps(post);
    maps.fallbackFor("gone.jpg");
    maps.forget("gone.jpg");
    maps.fallbackFor("gone.jpg");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("does not fail when the log cannot be written (the server is away, a rejected line)", async () => {
    const post = vi.fn(() => Promise.reject(new Error("down")));
    const maps = new MissingMaps(post);
    expect(maps.fallbackFor("gone.jpg")).toBe(DEFAULT_MAP);
    await Promise.resolve(); // an unhandled rejection would fail the run
    expect(post).toHaveBeenCalledTimes(1);
  });
});

const entry = (file: string, stock = false): MapEntry => ({ file, stock, width: 2, height: 1, bytes: 10 });

describe("withEntry (the list of the Select Map dialog after an upload)", () => {
  const list = [entry("earth_800.png", true), entry("nasa-topo_800.png", true), entry("beta.jpg"), entry("Delta.png")];

  it("adds a map among the uploaded ones, by name without regard to case, after Gpredict's", () => {
    expect(withEntry(list, entry("alpha.jpg")).map((m) => m.file)).toEqual(["earth_800.png", "nasa-topo_800.png", "alpha.jpg", "beta.jpg", "Delta.png"]);
    expect(withEntry(list, entry("zulu.png")).map((m) => m.file)).toEqual(["earth_800.png", "nasa-topo_800.png", "beta.jpg", "Delta.png", "zulu.png"]);
    expect(withEntry(list, entry("charlie.jpg")).map((m) => m.file)).toEqual(["earth_800.png", "nasa-topo_800.png", "beta.jpg", "charlie.jpg", "Delta.png"]);
  });

  it("replaces the entry of a map that was uploaded again (new size), and changes nothing else", () => {
    const again = { ...entry("beta.jpg"), width: 4096, bytes: 999 };
    const next = withEntry(list, again);
    expect(next).toHaveLength(list.length);
    expect(next.find((m) => m.file === "beta.jpg")).toEqual(again);
    expect(list.find((m) => m.file === "beta.jpg")!.width).toBe(2); // the list given is not changed
  });
});

describe("moveSelection (the keys of the list)", () => {
  const files = ["a", "b", "c"];

  it("moves one up or down and stops at the ends", () => {
    expect(moveSelection(files, "a", "ArrowDown")).toBe("b");
    expect(moveSelection(files, "b", "ArrowUp")).toBe("a");
    expect(moveSelection(files, "a", "ArrowUp")).toBe("a");
    expect(moveSelection(files, "c", "ArrowDown")).toBe("c");
  });

  it("Home and End go to the first and the last, and a key it does not know leaves the selection", () => {
    expect(moveSelection(files, "b", "Home")).toBe("a");
    expect(moveSelection(files, "b", "End")).toBe("c");
    expect(moveSelection(files, "b", "x")).toBe("b");
    expect(moveSelection(files, null, "x")).toBeNull();
  });

  it("with nothing selected Down takes the first and Up the last", () => {
    expect(moveSelection(files, null, "ArrowDown")).toBe("a");
    expect(moveSelection(files, null, "ArrowUp")).toBe("c");
    expect(moveSelection([], null, "ArrowDown")).toBeNull();
  });
});
