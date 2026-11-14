// Pure helpers of the module notebook.

export const APP_TITLE = "Gpredict Web";

/**
 * Window title: "Gpredict Web" / "Gpredict Web: <tab label>" (ของเรา: Gpredict itself shows "Gpredict" / "Gpredict: <tab label>",
 * but this is not the Gpredict program).
 */
export function windowTitle(tab: string | null): string {
  return tab === null ? APP_TITLE : `${APP_TITLE}: ${tab}`;
}

/** The tab to show: the chosen one while it is still open, otherwise the first open tab (null if none). */
export function activeTab(open: readonly string[], chosen: string | null): string | null {
  if (chosen !== null && open.includes(chosen)) return chosen;
  return open[0] ?? null;
}

/** Order after dragging tab `dragged` onto tab `target`: the dragged tab takes the target's place. */
export function reorderTabs(order: readonly string[], dragged: string, target: string): string[] {
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next;
}

/** The tabs of the main page: the open modules in session order, without the ones that are windows of their own (spec §8.1). */
export function tabsOf(open: readonly string[], windows: readonly string[]): string[] {
  return open.filter((m) => !windows.includes(m));
}

/**
 * The tab to show when the page loads: the one at GLOBAL/CURRENT_PAGE among the tabs (plan decision 8, spec §8.4), or the first one
 * for -1 (Gpredict's default: no page) and for a page past the last tab; null without tabs.
 */
export function initialTab(tabs: readonly string[], currentPage: number): string | null {
  return tabs[currentPage] ?? tabs[0] ?? null;
}

/** What GLOBAL/CURRENT_PAGE stores for the tab that is shown: its place among the tabs, -1 for none (as GTK's notebook gives). */
export function pageIndex(tabs: readonly string[], tab: string | null): number {
  return tab === null ? -1 : tabs.indexOf(tab);
}

/**
 * The session order (PUT /api/session/tabs takes every open module) after the tabs were dragged into `tabs`: the tabs take the places
 * the tabs had in `open`, in their new order, and the modules that are windows (not among the tabs) stay where they were.
 */
export function tabOrderWithWindows(open: readonly string[], tabs: readonly string[]): string[] {
  let next = 0;
  return open.map((m) => (tabs.includes(m) ? tabs[next++]! : m));
}
