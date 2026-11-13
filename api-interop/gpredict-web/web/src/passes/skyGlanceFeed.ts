// How the Sky at a glance window gets its drawings from the server (spec §7, plan decision 3). The server never waits for GMAT: it
// answers at once with status "computing" and the page asks again about every second. No React and no DOM: SkyGlanceWindow.tsx
// shows the view that the feed reports.
//
// The `t` rule (ref-P §7.1, §7.7; Task 6): the first drawing sends `t`, the module time of the tick, and every poll while that
// drawing is still computing sends the same `t`. "Always use real time for pass predictions" makes the server use its own clock
// whenever `t` is sent, so the first drawing can start at real time; if the polls left `t` out, the server would start at module time
// instead, which can be another day and would drop the GMAT job it has under way. Every later drawing (the chart has to be built again,
// `needsRedraw`) sends no `t`: it starts at the module time, always.

import { errorText } from "../api";
import { browserTimer } from "../useModuleSocket";
import type { Timer } from "../useModuleSocket";
import type { SkyGlanceAnswer } from "./types";

/** How long after an answer "computing" the page asks again. */
export const SKY_POLL_MS = 1000;

/** What the window shows. */
export interface SkyView {
  /** the newest finished drawing; null until there is one (nothing to draw yet) */
  answer: SkyGlanceAnswer | null;
  /** GMAT is computing a drawing: before the first one the window says so, later the old picture stays */
  computing: boolean;
  /** the Thai text of why the newest request failed (GMAT failed, the server cannot be reached), null if it did not */
  error: string | null;
}

/** The routes the feed uses (passApi.ts: `getSkyGlance` and `releaseSkyGlance` of one module). */
export interface SkyApi {
  get(t?: string): Promise<SkyGlanceAnswer>;
  release(): Promise<void>;
}

/** (ของเรา) The text of a request that failed with no message from the server. */
const FAILED_TEXT = "GMAT คำนวณวงโคจรไม่สำเร็จ";

/** The error the server gives for an answer with status "failed": its first message (the failure comes first), or `FAILED_TEXT`. */
function failureText(a: SkyGlanceAnswer): string {
  return (a.messages.find((m) => m.level === "error") ?? a.messages[0])?.text ?? FAILED_TEXT;
}

const ignore = () => undefined;

/**
 * One window's conversation with the server. `first` starts the first drawing, `rebuild` every later one; `retry` repeats the
 * newest request after a failure; `stop` ends it all (closing the window). Every change is reported to `onView`. A request that is
 * not the newest any more has its answers dropped, and so has a feed that has been stopped.
 */
export class SkyGlanceFeed {
  private view: SkyView = { answer: null, computing: false, error: null };
  /** the number of the newest request: an answer or a poll of an older one does nothing */
  private serial = 0;
  private poll: unknown = null;
  private stopped = false;
  /** the `t` of the newest request, which Retry sends again */
  private lastT: string | undefined;

  constructor(
    private readonly api: SkyApi,
    private readonly onView: (view: SkyView) => void,
    private readonly timer: Timer = browserTimer,
  ) {}

  /** The first drawing: asks with `t` (the module time of the tick) and with the same `t` at every poll. */
  first(t: string): void {
    this.begin(t);
  }

  /** A later drawing: asks without `t`, so the server starts at the module time. It takes over from a drawing that is still computing. */
  rebuild(): void {
    this.begin(undefined);
  }

  /**
   * After a failure: lets the server drop what it holds (it keeps its failure until then, spec §7) and asks again as the failed
   * request did. The window keeps its picture, and says that it is computing.
   */
  retry(): void {
    if (this.stopped) return;
    const id = this.newest();
    this.show({ ...this.view, computing: true, error: null });
    this.api
      .release()
      .catch(ignore)
      .then(() => {
        if (id === this.serial) this.ask(id, this.lastT);
      });
  }

  /** The window was closed: no more requests, no more reports, and the server drops the ephemeris it holds for the window. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.newest();
    this.api.release().catch(ignore);
  }

  private begin(t: string | undefined): void {
    if (this.stopped) return;
    const id = this.newest();
    this.lastT = t;
    this.show({ ...this.view, computing: true, error: null });
    this.ask(id, t);
  }

  /** Makes a new request the newest: the polls and answers of the ones before are dropped. Returns its number. */
  private newest(): number {
    if (this.poll !== null) this.timer.clear(this.poll);
    this.poll = null;
    return ++this.serial;
  }

  private ask(id: number, t: string | undefined): void {
    this.api.get(t).then(
      (a) => {
        if (id === this.serial) this.take(id, a, t);
      },
      (e: unknown) => {
        if (id === this.serial) this.show({ ...this.view, computing: false, error: errorText(e) });
      },
    );
  }

  private take(id: number, a: SkyGlanceAnswer, t: string | undefined): void {
    switch (a.status) {
      case "ok":
        this.show({ answer: a, computing: false, error: null });
        return;
      case "computing":
        this.poll = this.timer.set(() => {
          this.poll = null;
          if (id === this.serial) this.ask(id, t);
        }, SKY_POLL_MS);
        return;
      case "failed":
        this.show({ ...this.view, computing: false, error: failureText(a) });
        return;
    }
  }

  private show(view: SkyView): void {
    this.view = view;
    this.onView(view);
  }
}
