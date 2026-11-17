import { describe, expect, it } from "vitest";
import type { MenuSpec } from "./menuSpec";
import { barMenu, MENU_TITLES } from "./menus";
import { moduleMenu } from "./moduleMenu";
import { satPopup } from "./satPopup";

/** Every item of a menu, those of its submenus too. */
function items<A>(menu: readonly MenuSpec<A>[]): MenuSpec<A>[] {
  return menu.flatMap((e) => (e.kind === "submenu" ? [e, ...items(e.items)] : [e]));
}

/**
 * The column "กดไม่ได้" of the table in spec §8.2 is empty after sub-project 4: Detach module and Full screen, its last two rows, work
 * (Pass predictions came with sub-project 2, Radio & Rotator with 3, the rest with 4). No menu has an item that cannot be chosen.
 */
describe("every Gpredict menu item can be chosen (spec §8.2)", () => {
  const sat = { norad: 25544, name: "ISS", el: 10, dir: "↑" };
  const lists = { footprint_off: [], ground_track: [], sky_track: [] };
  const menus: [string, MenuSpec<unknown>[]][] = [
    ...MENU_TITLES.map((t): [string, MenuSpec<unknown>[]] => [t, barMenu(t)]),
    ...(["docked", "window"] as const).flatMap((place) =>
      [false, true].map((fullscreen): [string, MenuSpec<unknown>[]] => [
        `Module menu (${place}${fullscreen ? ", full screen" : ""})`,
        moduleMenu({ autotrack: false, choices: [{ norad: 25544, name: "ISS" }], selected: null, place, fullscreen }),
      ]),
    ),
    ...(["list", "map", "polar", "single", "event"] as const).map((view): [string, MenuSpec<unknown>[]] => [`popup of ${view}`, satPopup(view, sat, lists)]),
  ];

  it.each(menus)("%s: every item can be chosen", (_, menu) => {
    for (const e of items(menu)) {
      if (e.kind === "item") expect(e.action, e.label).toBeDefined();
      if (e.kind === "check" || e.kind === "submenu") expect(e.disabled ?? false, e.label).toBe(false);
    }
  });

  it("has Detach module and Full screen in the Module menu, and Attach module and Exit full screen in the other states", () => {
    const labels = menus.flatMap(([, menu]) => items(menu).flatMap((e) => (e.kind === "item" ? [e.label] : [])));
    for (const label of ["Detach module", "Attach module", "Full screen", "Exit full screen"]) expect(labels, label).toContain(label);
  });
});
