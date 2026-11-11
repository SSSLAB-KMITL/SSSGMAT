// Number and time formats of Gpredict (ref §4). Pure functions, no DOM.

/** Gpredict's default "Time format" (ref §4, Number Formats). */
export const DEFAULT_TIME_FORMAT = "%Y/%m/%d %H:%M:%S";

/** What Gpredict's live preview shows before there is a time. */
export const TIME_PLACEHOLDER = "--/--/-- --:--:--";

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day - start) / 86_400_000) + 1;
}

/**
 * strftime for the codes of Gpredict's "Time format" tooltip, always in UTC:
 * %Y year, %m month, %d day, %j day of the year, %H hour, %M minute, %S second. %% is a literal percent sign;
 * any other code is left as written.
 */
export function formatTime(d: Date, fmt: string = DEFAULT_TIME_FORMAT): string {
  if (Number.isNaN(d.getTime())) return TIME_PLACEHOLDER;
  return fmt.replace(/%(.)/gs, (whole: string, code: string) => {
    switch (code) {
      case "Y":
        return pad(d.getUTCFullYear(), 4);
      case "m":
        return pad(d.getUTCMonth() + 1, 2);
      case "d":
        return pad(d.getUTCDate(), 2);
      case "j":
        return pad(dayOfYear(d), 3);
      case "H":
        return pad(d.getUTCHours(), 2);
      case "M":
        return pad(d.getUTCMinutes(), 2);
      case "S":
        return pad(d.getUTCSeconds(), 2);
      case "%":
        return "%";
      default:
        return whole;
    }
  });
}

/** Countdown as Gpredict shows it: "MM:SS", or "HH:MM:SS" from one hour on (ref §5, §8). Whole seconds, never negative. */
export function fmtCountdown(sec: number): string {
  if (!Number.isFinite(sec)) return "--:--";
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}` : `${pad(m, 2)}:${pad(s, 2)}`;
}

/**
 * C's `%.nf`; "-" (the Single sat placeholder) for a missing or non-finite value.
 * JS rounds an exact binary tie (2.5 at 0 decimals) up where C rounds to even: it cannot show with measured values.
 */
export function fmtFixed(x: number | null | undefined, n: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "-";
  return x.toFixed(n);
}
