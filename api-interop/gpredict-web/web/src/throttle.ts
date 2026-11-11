/** Lets a call through at most once per `ms` (the module time label updates at most once per second, ref §1). */
export class MinInterval {
  private last: number | null = null;

  constructor(
    private readonly ms: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** true (and the interval restarts) if the last pass is at least `ms` ago, or the clock went backwards */
  ready(): boolean {
    const t = this.now();
    if (this.last === null || t < this.last || t - this.last >= this.ms) {
      this.last = t;
      return true;
    }
    return false;
  }
}
