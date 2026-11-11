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
