import { describe, expect, it, vi } from "vitest";
import {
  cityCells,
  locationsLoader,
  locationText,
  locationTree,
  moveCursor,
  nodeCells,
  parentKey,
  parseLocations,
  SELECT_COLUMNS,
  SELECT_LOCATION_BUTTONS,
  SELECT_LOCATION_TITLE,
  visibleNodes,
} from "./locations";
import type { LocationRow } from "./locations";
import { DEFAULT_NF } from "./numfmt";
import type { NumberFormat } from "./numfmt";
import type { LocationsAnswer } from "./types";

const nf = (over: Partial<NumberFormat> = {}): NumberFormat => ({ ...DEFAULT_NF, ...over });

const ANSWER: LocationsAnswer = {
  source: "https://tgftp.nws.noaa.gov/data/nsd_cccc.txt",
  downloaded: "2026-11-14T12:05:40Z",
  locations: [
    ["Asia", "Thailand", "Bangkok", 13.916667, 100.6, 3, "VTBD"],
    ["Asia", "Thailand", "Chiang Mai", 18.783333, 98.983333, 312, "VTCC"],
    ["Europe", "Denmark", "Copenhagen", 55.616667, 12.65, 5, "EKCH"],
  ],
};

const rows = (): LocationRow[] => parseLocations(ANSWER);

describe("the rows", () => {
  it("names the fields of each row of GET /api/locations", () => {
    expect(rows()[1]).toEqual({
      continent: "Asia",
      country: "Thailand",
      city: "Chiang Mai",
      lat: 18.783333,
      lon: 98.983333,
      alt_m: 312,
      icao: "VTCC",
    });
    expect(rows()).toHaveLength(3);
  });

  it("writes the Location text as <city>, <country>", () => {
    expect(locationText(rows()[1]!)).toBe("Chiang Mai, Thailand");
  });
});

describe("the tree", () => {
  it("location tree", () => {
    const tree = locationTree(rows());
    expect(tree.map((c) => c.continent)).toEqual(["Asia", "Europe"]);
    expect(tree[0]!.countries.map((c) => c.country)).toEqual(["Thailand"]);
    const thailand = tree[0]!.countries[0]!;
    expect(thailand.cities.map((c) => c.city)).toEqual(["Bangkok", "Chiang Mai"]);
    expect(thailand.cities[1]).toMatchObject({ icao: "VTCC", alt_m: 312 });
    expect(tree[1]!.countries[0]!.cities.map((c) => c.city)).toEqual(["Copenhagen"]);
  });

  it("lists a country under each continent it is in, because continents follow the WMO regions", () => {
    const tree = locationTree(
      parseLocations({
        ...ANSWER,
        locations: [
          ["Asia", "Russia", "Novosibirsk", 55, 82.9, 120, "UNNT"],
          ["Europe", "Russia", "Moscow", 55.8, 37.6, 156, "UUEE"],
          ["Europe", "Russia", "Saint Petersburg", 59.8, 30.3, 24, "ULLI"],
        ],
      }),
    );
    expect(tree.map((c) => [c.continent, c.countries.map((k) => [k.country, k.cities.length])])).toEqual([
      ["Asia", [["Russia", 1]]],
      ["Europe", [["Russia", 2]]],
    ]);
  });

  it("is empty for no rows", () => {
    expect(locationTree([])).toEqual([]);
  });
});

describe("the rows on show", () => {
  it("shows the continents closed, as Gpredict's tree starts", () => {
    const nodes = visibleNodes(locationTree(rows()), new Set());
    expect(nodes.map((n) => [n.kind, n.label, n.depth])).toEqual([
      ["continent", "Asia", 0],
      ["continent", "Europe", 0],
    ]);
  });

  it("shows the countries of an opened continent, and the cities of an opened country", () => {
    const tree = locationTree(rows());
    const closed = visibleNodes(tree, new Set());
    const asia = closed[0]!.key;
    const countries = visibleNodes(tree, new Set([asia]));
    expect(countries.map((n) => [n.kind, n.label, n.depth])).toEqual([
      ["continent", "Asia", 0],
      ["country", "Thailand", 1],
      ["continent", "Europe", 0],
    ]);
    const thailand = countries[1]!.key;
    const cities = visibleNodes(tree, new Set([asia, thailand]));
    expect(cities.map((n) => [n.kind, n.label, n.depth])).toEqual([
      ["continent", "Asia", 0],
      ["country", "Thailand", 1],
      ["city", "Bangkok", 2],
      ["city", "Chiang Mai", 2],
      ["continent", "Europe", 0],
    ]);
    expect(cities[3]).toMatchObject({ kind: "city", row: { icao: "VTCC" } });
  });

  it("does not show the cities of an opened country whose continent is closed", () => {
    const tree = locationTree(rows());
    const asia = visibleNodes(tree, new Set())[0]!.key;
    const thailand = visibleNodes(tree, new Set([asia]))[1]!.key;
    expect(visibleNodes(tree, new Set([thailand])).map((n) => n.label)).toEqual(["Asia", "Europe"]);
  });

  it("gives every row its own key, also for the same country under two continents and the same city twice", () => {
    const tree = locationTree(
      parseLocations({
        ...ANSWER,
        locations: [
          ["Asia", "Russia", "Omsk", 55, 73, 120, "UNOO"],
          ["Asia", "Russia", "Omsk", 55.1, 73.1, 120, "UNOO"],
          ["Europe", "Russia", "Moscow", 55.8, 37.6, 156, "UUEE"],
        ],
      }),
    );
    const all = visibleNodes(tree, openAll(tree));
    expect(all).toHaveLength(2 + 2 + 3); // two continents, two countries, three cities
    expect(new Set(all.map((n) => n.key)).size).toBe(all.length);
  });
});

/** the keys of every continent and every country: what is open when the whole tree is expanded */
function openAll(tree: ReturnType<typeof locationTree>): ReadonlySet<string> {
  let open = new Set<string>();
  for (let level = 0; level < 2; level++) open = new Set(visibleNodes(tree, open).filter((n) => n.kind !== "city").map((n) => n.key));
  return open;
}

describe("moving the cursor", () => {
  const tree = locationTree(rows());
  const asia = visibleNodes(tree, new Set())[0]!.key;
  const thailand = visibleNodes(tree, new Set([asia]))[1]!.key;
  const nodes = visibleNodes(tree, new Set([asia, thailand]));

  it("goes down and up the rows that are shown and stops at the ends", () => {
    expect(moveCursor(nodes, nodes[0]!.key, 1)).toBe(nodes[1]!.key);
    expect(moveCursor(nodes, nodes[2]!.key, -1)).toBe(nodes[1]!.key);
    expect(moveCursor(nodes, nodes[0]!.key, -1)).toBe(nodes[0]!.key);
    expect(moveCursor(nodes, nodes[nodes.length - 1]!.key, 1)).toBe(nodes[nodes.length - 1]!.key);
  });

  it("starts at the first row going down and the last going up when there is no cursor", () => {
    expect(moveCursor(nodes, null, 1)).toBe(nodes[0]!.key);
    expect(moveCursor(nodes, null, -1)).toBe(nodes[nodes.length - 1]!.key);
  });

  it("has nowhere to go with no rows, or from a row that is no longer shown", () => {
    expect(moveCursor([], null, 1)).toBeNull();
    expect(moveCursor(nodes, "gone", 1)).toBe(nodes[0]!.key);
  });
});

describe("the parent of a row", () => {
  it("is the country of a city and the continent of a country; a continent has none", () => {
    const tree = locationTree(rows());
    const asia = visibleNodes(tree, new Set())[0]!;
    const countries = visibleNodes(tree, new Set([asia.key]));
    const thailand = countries[1]!;
    const cities = visibleNodes(tree, new Set([asia.key, thailand.key]));
    expect(parentKey(asia)).toBeNull();
    expect(parentKey(thailand)).toBe(asia.key);
    expect(parentKey(cities[2]!)).toBe(thailand.key);
  });
});

describe("the dialog (loc-tree.c)", () => {
  it("has Gpredict's title and buttons", () => {
    expect(SELECT_LOCATION_TITLE).toBe("Select Location");
    expect(SELECT_LOCATION_BUTTONS).toEqual({ cancel: "Cancel", ok: "OK" });
  });

  it("shows Location, Lat, Lon, Alt and WX for the Select of Location, and Location and WX for the Select of Weather St", () => {
    expect(SELECT_COLUMNS.location).toEqual(["Location", "Lat", "Lon", "Alt", "WX"]);
    expect(SELECT_COLUMNS.weather).toEqual(["Location", "WX"]);
  });

  it("writes a city's cells: lat and lon as %.4f° with the side, altitude as a whole number, the weather station", () => {
    const chiangMai = rows()[1]!;
    expect(cityCells(chiangMai, "location", nf())).toEqual(["Chiang Mai", "18.7833° ", "98.9833° ", "312", "VTCC"]);
    expect(cityCells(chiangMai, "location", nf({ nsew: true }))).toEqual(["Chiang Mai", "18.7833°N", "98.9833°E", "312", "VTCC"]);
    expect(cityCells(chiangMai, "weather", nf())).toEqual(["Chiang Mai", "VTCC"]);
  });

  it("shows a west or south city with its sign, or as W and S", () => {
    const row: LocationRow = { continent: "South America", country: "Argentina", city: "Ushuaia", lat: -54.8, lon: -68.3, alt_m: 14, icao: "SAWH" };
    expect(cityCells(row, "location", nf())).toEqual(["Ushuaia", "-54.8000° ", "-68.3000° ", "14", "SAWH"]);
    expect(cityCells(row, "location", nf({ nsew: true }))).toEqual(["Ushuaia", "54.8000°S", "68.3000°W", "14", "SAWH"]);
  });

  it("leaves the number cells of a continent and a country empty", () => {
    const tree = locationTree(rows());
    const asia = visibleNodes(tree, new Set())[0]!.key;
    const open = visibleNodes(tree, new Set([asia]));
    expect(nodeCells(open[0]!, "location", nf())).toEqual(["Asia", "", "", "", ""]);
    expect(nodeCells(open[1]!, "location", nf())).toEqual(["Thailand", "", "", "", ""]);
    expect(nodeCells(open[1]!, "weather", nf())).toEqual(["Thailand", ""]);
  });
});

describe("reading the list", () => {
  it("asks the server once, and keeps the answer for the next dialog", async () => {
    const get = vi.fn().mockResolvedValue(ANSWER);
    const load = locationsLoader(get);
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toHaveLength(3);
    expect(b).toBe(a);
    expect(await load()).toBe(a);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(ANSWER);
    const load = locationsLoader(get);
    await expect(load()).rejects.toThrow("down");
    expect(await load()).toHaveLength(3);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
