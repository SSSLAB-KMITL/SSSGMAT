/** What to do with the newest text: show `show` now (if not null), and look again after `waitMs` (if not null). */
export interface TimeLabelStep {
  show: string | null;
  waitMs: number | null;
}

/**
 * Decides when the module time label changes: at most once per `minMs` (ref §1, "refreshed at most once per second"),
 * and never stuck on an old text. The caller calls `update` with the newest text on every tick; when it answers
 * `waitMs` the newest text was held back, and the caller must call `update` again with the same newest text after that
 * long (a tick with an unchanged time, as while the clock is stopped, will not call it).
 */
export class TimeLabel {
  private shown: string | null = null;
  private changedAt = 0;

  constructor(private readonly minMs: number) {}

  update(text: string, now: number): TimeLabelStep {
    if (text === this.shown) return { show: null, waitMs: null };
    const age = now - this.changedAt;
    if (this.shown === null || age < 0 || age >= this.minMs) {
      this.shown = text;
      this.changedAt = now;
      return { show: text, waitMs: null };
    }
    return { show: null, waitMs: this.minMs - age };
  }
}
