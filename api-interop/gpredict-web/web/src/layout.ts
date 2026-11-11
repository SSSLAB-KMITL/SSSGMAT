// Layout codes (ref §3): groups of five integers type;left;right;top;bottom on an invisible, homogeneous grid.

import type { ViewCell } from "./types";

/** View types of a layout code. */
export const VIEW = { List: 0, Map: 1, Polar: 2, SingleSat: 3, EventList: 4 } as const;

/** Names of the views as Gpredict calls them (ref §3: "List", "Map", "Polar", "Single sat", Event list "Upcoming passes"). */
export const VIEW_LABELS: Record<number, string> = {
  [VIEW.List]: "List",
  [VIEW.Map]: "Map",
  [VIEW.Polar]: "Polar",
  [VIEW.SingleSat]: "Single sat",
  [VIEW.EventList]: "Event list",
};

const INTEGER = /^[0-9]+$/;

/** Same rules as the server's parse_layout; throws Error on a bad code (the server would answer MODULE_INVALID). */
export function parseLayout(code: string): ViewCell[] {
  const parts = code.split(";");
  if (!parts.every((p) => INTEGER.test(p))) throw new Error("layout code must be non-negative integers separated by ;");
  if (parts.length % 5 !== 0) throw new Error("layout code must be groups of 5 integers (type;left;right;top;bottom)");
  const cells: ViewCell[] = [];
  for (let i = 0; i < parts.length; i += 5) {
    const [type, left, right, top, bottom] = parts.slice(i, i + 5).map(Number) as [number, number, number, number, number];
    if (!(type in VIEW_LABELS)) throw new Error(`no view type ${type} (0-4)`);
    if (left >= right || top >= bottom) throw new Error(`cell ${i / 5 + 1} needs left < right and top < bottom`);
    cells.push({ type, left, right, top, bottom });
  }
  return cells;
}

export interface GridArea {
  type: number;
  /** CSS grid-column (1-based lines) */
  gridColumn: string;
  /** CSS grid-row (1-based lines) */
  gridRow: string;
}

export interface Grid {
  columns: number;
  rows: number;
  areas: GridArea[];
}

/** Cells to a CSS grid: every column and row the same size, `right` and `bottom` being exclusive grid lines. */
export function gridFor(cells: ViewCell[]): Grid {
  return {
    columns: Math.max(0, ...cells.map((c) => c.right)),
    rows: Math.max(0, ...cells.map((c) => c.bottom)),
    areas: cells.map((c) => ({
      type: c.type,
      gridColumn: `${c.left + 1} / ${c.right + 1}`,
      gridRow: `${c.top + 1} / ${c.bottom + 1}`,
    })),
  };
}
