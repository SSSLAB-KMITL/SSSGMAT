import { DAY_NAMES, MONTH_NAMES, monthGrid, shiftMonth, shiftYear } from "../timeCtl";

interface Props {
  /** the selected date as UTC midnight, also when the controls are in local time (the calendar reads only the date); the page shows its month */
  value: Date;
  /** a day was chosen, or a month or year arrow moved the selection (as GtkCalendar does); a date as UTC midnight */
  onChange: (day: Date) => void;
  /** shows the day but cannot be changed (the clock is running) */
  readOnly?: boolean;
}

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();

/**
 * A month page of calendar dates (UTC midnight, so it is the same page in UTC and in local time) with a heading (month and year,
 * each with its arrows) and the day names: what GtkCalendar shows with the options SHOW_HEADING and SHOW_DAY_NAMES. The days of
 * the weeks before and after the month are dimmed and can be chosen.
 */
export function Calendar({ value, onChange, readOnly = false }: Props) {
  const month = value.getUTCMonth();
  const choose = (day: Date) => {
    if (!readOnly) onChange(day);
  };
  const arrow = (label: string, text: string, to: Date) => (
    <button
      type="button"
      className="button flat cal-arrow"
      aria-label={label}
      aria-disabled={readOnly}
      onClick={() => choose(to)}
    >
      {text}
    </button>
  );

  return (
    <div className={readOnly ? "calendar read-only" : "calendar"} role="group" aria-label="Calendar">
      <div className="cal-head">
        {arrow("Previous month", "‹", shiftMonth(value, -1))}
        <span className="cal-month">{MONTH_NAMES[month]}</span>
        {arrow("Next month", "›", shiftMonth(value, 1))}
        {arrow("Previous year", "‹", shiftYear(value, -1))}
        <span className="cal-year">{value.getUTCFullYear()}</span>
        {arrow("Next year", "›", shiftYear(value, 1))}
      </div>
      <div className="cal-days">
        {DAY_NAMES.map((name) => (
          <span key={name} className="cal-dayname">
            {name}
          </span>
        ))}
        {monthGrid(value).map((day) => {
          const selected = sameDay(day, value);
          const other = day.getUTCMonth() !== month;
          return (
            <button
              key={day.getTime()}
              type="button"
              className={`cal-day${selected ? " selected" : ""}${other ? " other" : ""}`}
              aria-pressed={selected}
              aria-label={`${day.getUTCDate()} ${MONTH_NAMES[day.getUTCMonth()]} ${day.getUTCFullYear()}`}
              aria-disabled={readOnly}
              onClick={() => choose(day)}
            >
              {day.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
