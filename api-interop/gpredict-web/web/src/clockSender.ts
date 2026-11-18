// Sends the Time Controller's requests to the server one at a time and in order.
//
// The slider and the spin buttons fire many events a second; sent in parallel, their requests could reach the server in
// another order and leave an old time behind. So only one request is in flight, and requests that wait for it are merged
// (the fields of a PUT are absolute values, so the newest value of each field is all that counts).

import type { Clock, ClockUpdate } from "./types";

/** PUT /api/modules/{name}/clock, or POST .../clock/reset. */
export type ClockOp = { kind: "put"; body: ClockUpdate } | { kind: "reset" };

export interface ClockSenderHandlers {
  /** send one request (the api.ts function) */
  run(op: ClockOp): Promise<Clock>;
  /** a request was answered; `idle`: no other request waits, so this answer is the newest */
  onResult(op: ClockOp, clock: Clock, idle: boolean): void;
  onError(op: ClockOp, error: unknown, idle: boolean): void;
}

export class ClockSender {
  private queue: ClockOp[] = [];
  private running = false;
  private closed = false;
  /** the request in flight, as a promise that never rejects (null if none) */
  private inFlight: Promise<void> | null = null;

  constructor(private readonly handlers: ClockSenderHandlers) {}

  /** a request is in flight or waits */
  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Send a request after the ones before it. A PUT that waits behind another PUT is merged into it, never across a reset. */
  send(op: ClockOp): void {
    if (this.closed) return;
    const last = this.queue[this.queue.length - 1];
    if (op.kind === "put" && last?.kind === "put") this.queue[this.queue.length - 1] = { kind: "put", body: { ...last.body, ...op.body } };
    else this.queue.push(op);
    void this.pump();
  }

  /** The window is gone without a reset (another tab was chosen, the module closed): drop the waiting requests, tell nobody. */
  dispose(): void {
    this.closed = true;
    this.queue = [];
  }

  /**
   * Closing the window resets the clock (ref §9): drop the waiting requests, let the one in flight end (it must not land
   * after the reset), then send the reset. The returned promise is the reset's; nobody else is told anything.
   */
  finish(): Promise<Clock> {
    this.closed = true;
    this.queue = [];
    const reset = () => this.handlers.run({ kind: "reset" });
    return this.inFlight === null ? reset() : this.inFlight.then(reset);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (!this.closed && this.queue.length > 0) {
      const op = this.queue.shift()!;
      const call = this.handlers.run(op);
      this.inFlight = call.then(
        () => undefined,
        () => undefined,
      );
      try {
        const clock = await call;
        if (!this.closed) this.handlers.onResult(op, clock, this.queue.length === 0);
      } catch (e) {
        if (!this.closed) this.handlers.onError(op, e, this.queue.length === 0);
      }
      this.inFlight = null;
    }
    this.running = false;
  }
}
