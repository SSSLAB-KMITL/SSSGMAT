// Number and time formats of Gpredict (ref §4). Pure functions, no DOM.

/** Gpredict's default "Time format" (ref §4, Number Formats). */
export const DEFAULT_TIME_FORMAT = "%Y/%m/%d %H:%M:%S";

/** What Gpredict's live preview shows before there is a time. */
export const TIME_PLACEHOLDER = "--/--/-- --:--:--";

/** The longest "Time format" the entry takes (`TIME_FORMAT_MAX_LENGTH`, sat-cfg.h:30). */
export const TIME_FORMAT_MAX = 50;

/** A formatted time is cut to this many characters: the C buffer of 50 bytes holds 49 and the end mark (time-tools.c:76-79). */
export const TIME_TEXT_MAX = 49;

const pad = (n: number, width: number): string => (n < 0 ? `-${String(-n).padStart(width, "0")}` : String(n).padStart(width, "0"));
const padSpace = (n: number): string => String(n).padStart(2, " ");

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MS_PER_DAY = 86_400_000;

/** A time broken down in UTC or in the time zone of the machine, as C's `struct tm`. */
interface Parts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday */
  weekday: number;
  /** days since 1 January, 0-365 */
  yday: number;
  /** minutes east of UTC */
  offset: number;
  local: boolean;
}

/** UTC midnight of a calendar date; month 0-11, day and month may run over. Also right for the years below 100. */
function utcDay(year: number, month: number, day: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month, day);
  return t.getTime();
}

function partsOf(d: Date, local: boolean): Parts {
  const year = local ? d.getFullYear() : d.getUTCFullYear();
  const month = (local ? d.getMonth() : d.getUTCMonth()) + 1;
  const day = local ? d.getDate() : d.getUTCDate();
  return {
    year,
    month,
    day,
    hour: local ? d.getHours() : d.getUTCHours(),
    minute: local ? d.getMinutes() : d.getUTCMinutes(),
    second: local ? d.getSeconds() : d.getUTCSeconds(),
    weekday: local ? d.getDay() : d.getUTCDay(),
    yday: Math.round((utcDay(year, month - 1, day) - utcDay(year, 0, 1)) / MS_PER_DAY),
    offset: local ? -d.getTimezoneOffset() : 0,
    local,
  };
}

/** The ISO 8601 week (1-53) and the year it belongs to (`%V`, `%G`): the year of the Thursday of the week decides. */
function isoWeek(p: Parts): { year: number; week: number } {
  const monday0 = (p.weekday + 6) % 7;
  const thursday = utcDay(p.year, p.month - 1, p.day - monday0 + 3);
  const year = new Date(thursday).getUTCFullYear();
  return { year, week: Math.floor((thursday - utcDay(year, 0, 1)) / MS_PER_DAY / 7) + 1 };
}

/** `%z`: "+hhmm" east of UTC, "-hhmm" west of it. */
function offsetText(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60), 2)}${pad(abs % 60, 2)}`;
}

/** `%Z`: "UTC" in UTC; in local time the short name of the zone that Intl gives ("EST", "GMT+7"), the offset if it has none. */
function zoneName(d: Date, p: Parts): string {
  if (!p.local) return "UTC";
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find((x) => x.type === "timeZoneName");
    if (part !== undefined) return part.value;
  } catch {
    // no Intl for this zone: the offset below
  }
  return offsetText(p.offset);
}

const hour12 = (h: number): number => (h % 12 === 0 ? 12 : h % 12);

/** The text of one conversion code of C's `strftime` in the C locale, or null for a code that is not one (it stays as written). */
function convert(code: string, d: Date, p: Parts): string | null {
  switch (code) {
    case "a":
      return DAYS[p.weekday]!.slice(0, 3);
    case "A":
      return DAYS[p.weekday]!;
    case "b":
      return MONTHS[p.month - 1]!.slice(0, 3);
    case "B":
      return MONTHS[p.month - 1]!;
    case "c":
      return expand("%a %b %e %H:%M:%S %Y", d, p);
    case "C":
      return pad(Math.floor(p.year / 100), 2);
    case "d":
      return pad(p.day, 2);
    case "D":
    case "x":
      return expand("%m/%d/%y", d, p);
    case "e":
      return padSpace(p.day);
    case "F":
      return expand("%Y-%m-%d", d, p);
    case "g":
      return pad(((isoWeek(p).year % 100) + 100) % 100, 2);
    case "G":
      return pad(isoWeek(p).year, 4);
    case "H":
      return pad(p.hour, 2);
    case "I":
      return pad(hour12(p.hour), 2);
    case "j":
      return pad(p.yday + 1, 3);
    case "k":
      return padSpace(p.hour);
    case "l":
      return padSpace(hour12(p.hour));
    case "m":
      return pad(p.month, 2);
    case "M":
      return pad(p.minute, 2);
    case "n":
      return "\n";
    case "p":
      return p.hour < 12 ? "AM" : "PM";
    case "r":
      return expand("%I:%M:%S %p", d, p);
    case "R":
      return expand("%H:%M", d, p);
    case "S":
      return pad(p.second, 2);
    case "t":
      return "\t";
    case "T":
    case "X":
      return expand("%H:%M:%S", d, p);
    case "u":
      return String(p.weekday === 0 ? 7 : p.weekday);
    case "U":
      return pad(Math.floor((p.yday + 7 - p.weekday) / 7), 2);
    case "V":
      return pad(isoWeek(p).week, 2);
    case "w":
      return String(p.weekday);
    case "W":
      return pad(Math.floor((p.yday + 7 - ((p.weekday + 6) % 7)) / 7), 2);
    case "y":
      return pad(((p.year % 100) + 100) % 100, 2);
    case "Y":
      return pad(p.year, 4);
    case "z":
      return offsetText(p.offset);
    case "Z":
      return zoneName(d, p);
    case "%":
      return "%";
    default:
      return null;
  }
}

/** `fmt` with its codes replaced. A code that is not one, and a `%` at the end, stay as written (glibc does the same). */
function expand(fmt: string, d: Date, p: Parts): string {
  return fmt.replace(/%(.)/gs, (whole: string, code: string) => convert(code, d, p) ?? whole);
}

/**
 * C's `strftime` in the C locale, as Gpredict formats every time it shows (`daynum_to_str`, time-tools.c:65-81), in UTC or,
 * with `local`, in the time zone of the machine: `%a %A %b %B %c %C %d %D %e %F %H %I %j %k %l %m %M %n %p %r %R %S %t %T`,
 * `%u %U %V %w %W %g %G %y %Y`, `%x %X %z %Z` and `%%`. Names are English. A code that is not one of these is left as written.
 * The result is cut to `TIME_TEXT_MAX` characters. An invalid date gives the placeholder of Gpredict's preview.
 */
export function formatTime(d: Date, fmt: string = DEFAULT_TIME_FORMAT, local = false): string {
  if (Number.isNaN(d.getTime())) return TIME_PLACEHOLDER;
  const text = expand(fmt, d, partsOf(d, local));
  return text.length <= TIME_TEXT_MAX ? text : Array.from(text).slice(0, TIME_TEXT_MAX).join("");
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
