// (ของเรา) The selected satellite and Autotrack of a module go with it when it moves between a tab of the main page and a window of
// its own (Detach module, Attach module, spec §8.1-§8.2). Gpredict moves the module itself, so they stay (ref-D §9); here the tab and
// the window are two pages, so the page the module leaves hands them to the page it goes to:
// - Detach: in the address of the window (`&sel=<norad>&autotrack=1`, detach.ts `detachedUrl`), read when the window's page loads; main.tsx
//   then takes them out of the address, so an F5 of the window starts as before.
// - Attach: a message on the BroadcastChannel HANDOVER_CHANNEL, sent by the window once the server has the module as a tab again
//   (`announceAttach`); the main page takes it once the module is one of its tabs (`AttachInbox`).
// The satellite handed over is the target the module's controllers follow already (the page that hands it over sent it), so taking it
// over sends no target (`takeOver`). Without a partner page (a window opened by the restore bar, an F5 of a window, no main page open)
// nothing is handed over: the module starts with nothing selected and Autotrack off, as before. Pure, apart from the BroadcastChannel.

import { withMember, withSelection } from "./selection";
import type { Selections } from "./selection";

/** What goes with a module: its selected satellite (NORAD number, null: none) and whether Autotrack is on. */
export interface Handover {
  selected: number | null;
  autotrack: boolean;
}

const isNorad = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

// ---------------------------------------------------------------- Detach: the address of the window

/** The part of the window's address that hands `h` over ("" for nothing selected and Autotrack off: nothing to hand over). */
export function handoverQuery(h: Handover | null): string {
  if (h === null) return "";
  return `${h.selected === null ? "" : `&sel=${h.selected}`}${h.autotrack ? "&autotrack=1" : ""}`;
}

/** What the window's address hands over, or null for nothing (a satellite that is not a NORAD number is not taken). */
export function readHandover(params: URLSearchParams): Handover | null {
  const sel = params.get("sel");
  const norad = sel !== null && /^[0-9]+$/.test(sel) ? Number(sel) : null;
  const selected = isNorad(norad) ? norad : null;
  const autotrack = params.get("autotrack") === "1";
  return selected === null && !autotrack ? null : { selected, autotrack };
}

// ---------------------------------------------------------------- what a page holds

/**
 * The changes that make a page hold `h` for `module`, as updaters for its selections and its Autotrack. useSelection applies the
 * selections updater to the targets it has sent too, so the satellite taken over counts as sent: the controllers follow it already.
 */
export function takeOver(
  module: string,
  h: Handover,
): { selections: (s: Selections) => Selections; autotrack: (a: ReadonlySet<string>) => ReadonlySet<string> } {
  return {
    selections: (s) => withSelection(s, module, h.selected),
    autotrack: (a) => withMember(a, module, h.autotrack),
  };
}

/** What the window of `module` starts with when Detach handed `h` over (its targets sent start as these selections). */
export function handoverStart(module: string, h: Handover): { selections: Selections; autotrack: ReadonlySet<string> } {
  const t = takeOver(module, h);
  return { selections: t.selections({}), autotrack: t.autotrack(new Set()) };
}

/**
 * The handovers of Attach that the main page has heard, each kept until its module is one of the page's tabs: the message and the list
 * of modules that makes the module a tab (modules_changed of /ws/app) can come in either order. A newer message of a module replaces
 * an older one.
 */
export class AttachInbox {
  private readonly waiting = new Map<string, Handover>();

  receive(module: string, h: Handover): void {
    this.waiting.set(module, h);
  }

  /** The handovers whose module is a tab now, each given once. */
  arrived(tabs: readonly string[]): [string, Handover][] {
    const ready = [...this.waiting].filter(([module]) => tabs.includes(module));
    for (const [module] of ready) this.waiting.delete(module);
    return ready;
  }
}

// ---------------------------------------------------------------- Attach: the message to the main pages

/** The BroadcastChannel of the pages of one server (same origin). */
export const HANDOVER_CHANNEL = "gpredict-web-handover";

/** What the pages use of a BroadcastChannel. */
export interface ChannelLike {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
  close(): void;
}

/** The channel, or null in a browser that has no BroadcastChannel (then nothing is handed over at Attach). */
const openChannel = (): ChannelLike | null => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(HANDOVER_CHANNEL));

/** The module, satellite and Autotrack a message of Attach carries, or null for any other message. */
function parseAttach(data: unknown): { module: string; handover: Handover } | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, module, selected, autotrack } = data as Record<string, unknown>;
  if (type !== "attached" || typeof module !== "string" || module === "" || typeof autotrack !== "boolean") return null;
  const norad = selected === null ? null : isNorad(selected) ? selected : undefined;
  return norad === undefined ? null : { module, handover: { selected: norad, autotrack } };
}

/** The window of `module` tells the main pages what goes with the module back to its tab (DetachedSession.attach, after the server's answer). */
export function announceAttach(module: string, h: Handover, open: () => ChannelLike | null = openChannel): void {
  const channel = open();
  if (channel === null) return;
  channel.postMessage({ type: "attached", module, selected: h.selected, autotrack: h.autotrack });
  channel.close(); // what is posted is delivered all the same
}

/** The main page hears the messages of Attach; returns the function that stops listening. */
export function listenAttach(on: (module: string, h: Handover) => void, open: () => ChannelLike | null = openChannel): () => void {
  const channel = open();
  if (channel === null) return () => {};
  channel.onmessage = (ev) => {
    const m = parseAttach(ev.data);
    if (m !== null) on(m.module, m.handover);
  };
  return () => {
    channel.onmessage = null;
    channel.close();
  };
}
