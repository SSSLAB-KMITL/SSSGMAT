// Print of Pass details (ref-P §8.5, spec §5, plan decision 9). Gpredict prints the data table of one pass only, in "monospace" 12 pt
// under a grey header band with the title and the page number. A browser cannot ask how many lines fit a page, so the page is split
// here, 50 lines to a page (A4, 10 mm margins, a 10 mm band), which lets the band say `n/N`. Everything but `printPass` is pure.

import { onePassText } from "./passText";
import type { PassInfo, PassQth, PassSat } from "./types";

/** Lines of the table on a page (plan decision 9). */
export const LINES_PER_PAGE = 50;

/** `lines` in pages of `perPage` lines, in order; no lines make one empty page (there is always a page to print). */
export function printPages(lines: readonly string[], perPage = LINES_PER_PAGE): string[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size));
  return pages.length === 0 ? [[]] : pages;
}

/**
 * What Gpredict prints: the table header (separator, title line, separator) and the rows of the pass, which are the lines of the
 * file of Save Pass Details without its 5 header lines (ref-P §8.3, §8.5). `columns` are the Single Pass columns that are on.
 */
export function printLines(answer: { sat: PassSat; qth: PassQth; pass: PassInfo }, columns: readonly string[]): string[] {
  return onePassText(answer, columns, 1).replace(/\n$/, "").split("\n");
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The band is 10 mm high, light grey (0.8) with a black 1 px outline; the title is "sans 14" centred and cut at its start if too wide
// (the inner span keeps the title's own order in the right-to-left box that puts the cut at the left); the counter is right
// aligned 4 px from the edge; 3 mm below it come the lines, one to every 12 pt (`print-pass.c:42-43`, `:220-297`). `print-color-adjust:
// exact` keeps the grey fill when the print dialog has "Background graphics" off, which is its default in every browser.
const STYLE = `
@page { size: A4; margin: 10mm; }
html, body { margin: 0; padding: 0; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
.band { position: relative; box-sizing: border-box; height: 10mm; border: 1px solid #000; background: #cccccc; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; font: 14pt sans-serif; line-height: calc(10mm - 2px); }
.title { display: block; margin: 0 4em; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: center; direction: rtl; }
.title > span { direction: ltr; unicode-bidi: isolate; }
.count { position: absolute; top: 0; right: 4px; }
pre { margin: 3mm 0 0; color: #000; font: 12pt/12pt monospace; }
`;

/** The page that is printed: a band with `title` and `n/N` and the lines of the table, on every one of the pages of `lines`. */
export function printDocument(title: string, lines: readonly string[]): string {
  const pages = printPages(lines);
  const safeTitle = escapeHtml(title);
  const body = pages
    .map(
      (page, i) =>
        `<div class="page"><div class="band"><span class="title"><span>${safeTitle}</span></span><span class="count">${i + 1}/${pages.length}</span></div>` +
        `<pre>${page.map(escapeHtml).join("\n")}</pre></div>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${STYLE}</style></head><body>\n${body}\n</body></html>`;
}

/** The frame of the print that was last started: it is taken away when the next one starts (or when the print is over). */
let frame: HTMLIFrameElement | null = null;

/**
 * Print `lines` under the header band `title`: the browser's print dialog opens on a page that is made in a hidden frame. A thin
 * wrapper round the page and the browser's print dialog, so it is not tested here: the print-out is checked in the browser.
 */
export function printPass(title: string, lines: readonly string[]): void {
  frame?.remove();
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  f.onload = () => {
    const win = f.contentWindow;
    if (win === null || !f.contentDocument?.querySelector(".page")) return; // not the page we wrote (an empty frame loads first in some browsers)
    win.addEventListener("afterprint", () => {
      f.remove();
      if (frame === f) frame = null;
    });
    win.focus();
    win.print();
  };
  f.srcdoc = printDocument(title, lines);
  document.body.appendChild(f);
  frame = f;
}
