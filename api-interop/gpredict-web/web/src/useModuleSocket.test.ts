import { describe, expect, it } from "vitest";
import {
  BACKOFF_MS,
  ModuleSocket,
  shouldReconnect,
  socketUrl,
  type SocketLike,
  type Timer,
} from "./useModuleSocket";
import type { Tick } from "./types";

// ---- fakes --------------------------------------------------------------------------------------

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closedByClient: number | null = null;
  constructor(readonly url: string) {}

  close(code?: number): void {
    this.closedByClient = code ?? 1005;
  }
  // what the network/server does
  open(): void {
    this.onopen?.();
  }
  send(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }
  serverClose(code: number): void {
    this.onclose?.({ code });
  }
  failToConnect(): void {
    this.onerror?.();
    this.onclose?.({ code: 1006 });
  }
}

class FakeTimer implements Timer {
  private next = 1;
  private now = 0;
  private pending = new Map<number, { at: number; fn: () => void }>();
  /** delay (ms) of every timeout ever set, in order */
  readonly delays: number[] = [];

  set(fn: () => void, ms: number): number {
    const id = this.next++;
    this.delays.push(ms);
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}

function tick(overrides: Partial<Tick> = {}): Tick {
  return {
    t: "2026-11-12T07:00:00.000Z",
    clock: { state: "forward", throttle: 1, label: "Real-Time" },
    status: "ok",
    qth: { name: "THBK", location: "Bangkok", lat_deg: 13.729779, lon_deg: 100.781151, alt_m: 6.4 },
    sun: { lat_deg: -17.6, lon_deg: 75.1 },
    window: { start: "2026-11-12T05:00:00.000Z", stop: "2026-11-12T21:00:00.000Z" },
    sats: [],
    messages: [],
    ...overrides,
  };
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timer = new FakeTimer();
  const ticks: Tick[] = [];
  const connected: boolean[] = [];
  const gone: number[] = [];
  const ms = new ModuleSocket({
    url: "ws://localhost/ws/modules/Amateur",
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    timer,
    onTick: (t) => ticks.push(t),
    onConnected: (c) => connected.push(c),
    onGone: (code) => gone.push(code),
  });
  return { ms, sockets, timer, ticks, connected, gone };
}

// ---- tests --------------------------------------------------------------------------------------

describe("ModuleSocket", () => {
  it("reconnects after the socket closes", () => {
    const { ms, sockets, timer, ticks, connected } = setup();
    ms.start();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe("ws://localhost/ws/modules/Amateur");
    expect(ms.connected).toBe(false);

    sockets[0]!.open();
    expect(ms.connected).toBe(true);
    sockets[0]!.send(tick());
    expect(ticks).toHaveLength(1);

    sockets[0]!.serverClose(1006); // network drop / server restart
    expect(ms.connected).toBe(false);
    expect(sockets).toHaveLength(1); // not instantly: backs off first

    timer.advance(999);
    expect(sockets).toHaveLength(1);
    timer.advance(1); // 1 s after the close
    expect(sockets).toHaveLength(2);

    sockets[1]!.open();
    expect(ms.connected).toBe(true);
    sockets[1]!.send(tick({ t: "2026-11-12T07:00:01.000Z" }));
    expect(ticks).toHaveLength(2);
    expect(connected).toEqual([true, false, true]); // reported on every change, never twice in a row
  });

  it("backs off 1, 2, 4, 5, 5, ... seconds while the server stays unreachable", () => {
    const { ms, sockets, timer } = setup();
    ms.start();
    for (let i = 0; i < 7; i++) {
      sockets[i]!.failToConnect(); // onerror then close 1006, never opened
      timer.advance(5000);
    }
    expect(sockets).toHaveLength(8);
    expect(timer.delays).toEqual([1000, 2000, 4000, 5000, 5000, 5000, 5000]);
    expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 5000]);
  });

  it("starts over at 1 s once a tick has been received", () => {
    const { ms, sockets, timer } = setup();
    ms.start();
    sockets[0]!.failToConnect();
    timer.advance(1000); // attempt 2 after 1 s
    sockets[1]!.failToConnect();
    timer.advance(2000); // attempt 3 after 2 s
    sockets[2]!.open();
    sockets[2]!.send(tick()); // the server is back and talking
    sockets[2]!.serverClose(1012); // service restart
    timer.advance(1000);
    expect(sockets).toHaveLength(4);
    expect(timer.delays).toEqual([1000, 2000, 1000]);
  });

  it("does not count a socket that opens and is dropped at once as a recovery", () => {
    const { ms, sockets, timer } = setup();
    ms.start();
    sockets[0]!.open();
    sockets[0]!.serverClose(1011);
    timer.advance(1000);
    sockets[1]!.open();
    sockets[1]!.serverClose(1011); // no tick in between: keeps backing off
    timer.advance(2000);
    expect(sockets).toHaveLength(3);
    expect(timer.delays).toEqual([1000, 2000]);
  });

  it.each([1001, 1006, 1011, 1012, 1013])("reconnects after close code %i", (code) => {
    const { ms, sockets, timer, gone } = setup();
    ms.start();
    sockets[0]!.open();
    sockets[0]!.serverClose(code);
    timer.advance(1000);
    expect(sockets).toHaveLength(2);
    expect(gone).toEqual([]);
  });

  it.each([1000, 1008])("does not reconnect after close code %i, and says why", (code) => {
    const { ms, sockets, timer, gone, connected } = setup();
    ms.start();
    sockets[0]!.open();
    sockets[0]!.serverClose(code); // module closed or deleted (1000), not open or forbidden (1008)
    expect(ms.connected).toBe(false);
    expect(timer.pendingCount).toBe(0);
    timer.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(gone).toEqual([code]);
    expect(connected).toEqual([true, false]);
  });

  it("stop() closes the live socket with 1000, cancels a pending retry and goes silent", () => {
    const { ms, sockets, timer, ticks, connected } = setup();
    ms.start();
    sockets[0]!.open();
    ms.stop();
    expect(sockets[0]!.closedByClient).toBe(1000);
    // the browser still delivers events of the closed socket: they must be ignored
    sockets[0]!.send(tick());
    sockets[0]!.serverClose(1006);
    expect(ticks).toHaveLength(0);
    expect(timer.pendingCount).toBe(0);
    expect(connected).toEqual([true]); // no trailing "false" after a stop: the owner already left

    ms.start(); // restartable (React StrictMode mounts, unmounts and mounts again)
    expect(sockets).toHaveLength(2);
  });

  it("stop() while a retry is pending cancels the retry", () => {
    const { ms, sockets, timer } = setup();
    ms.start();
    sockets[0]!.serverClose(1006);
    expect(timer.pendingCount).toBe(1);
    ms.stop();
    expect(timer.pendingCount).toBe(0);
    timer.advance(10_000);
    expect(sockets).toHaveLength(1);
  });

  it("ignores events of a socket that has been replaced", () => {
    const { ms, sockets, timer, ticks } = setup();
    ms.start();
    sockets[0]!.serverClose(1006);
    timer.advance(1000);
    sockets[1]!.open();
    sockets[0]!.send(tick({ t: "stale" })); // late message of the dead socket
    sockets[0]!.serverClose(1006); // and a second close event
    expect(ticks).toHaveLength(0);
    expect(ms.connected).toBe(true);
    expect(timer.pendingCount).toBe(0);
  });

  it("skips malformed messages instead of dying", () => {
    const { ms, sockets, ticks } = setup();
    ms.start();
    sockets[0]!.open();
    sockets[0]!.send("not json {");
    sockets[0]!.send("[1, 2]");
    sockets[0]!.send("null");
    sockets[0]!.send({ hello: "world" }); // no status
    sockets[0]!.onmessage?.({ data: new ArrayBuffer(4) }); // binary frame
    sockets[0]!.send(tick());
    expect(ticks).toHaveLength(1);
    expect(ms.connected).toBe(true);
  });

  it("treats a failing socket factory as a failed attempt and retries", () => {
    const sockets: FakeSocket[] = [];
    const timer = new FakeTimer();
    let failFirst = true;
    const ms = new ModuleSocket({
      url: "ws://x/ws/modules/m",
      createSocket: (url) => {
        if (failFirst) {
          failFirst = false;
          throw new SyntaxError("bad url");
        }
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      timer,
      onTick: () => {},
      onConnected: () => {},
    });
    ms.start();
    expect(sockets).toHaveLength(0);
    timer.advance(1000);
    expect(sockets).toHaveLength(1);
  });

  it("start() twice does not open a second socket", () => {
    const { ms, sockets } = setup();
    ms.start();
    ms.start();
    expect(sockets).toHaveLength(1);
  });
});

describe("shouldReconnect", () => {
  it("is false only for 1000 (module closed or deleted) and 1008 (not open / forbidden origin or host)", () => {
    expect(shouldReconnect(1000)).toBe(false);
    expect(shouldReconnect(1008)).toBe(false);
    for (const code of [1001, 1005, 1006, 1011, 1012, 1013, 4000]) expect(shouldReconnect(code)).toBe(true);
  });
});

describe("socketUrl", () => {
  it("uses ws on http pages and wss on https pages, on the page's own host", () => {
    expect(socketUrl({ protocol: "http:", host: "127.0.0.1:8740" }, "Amateur")).toBe(
      "ws://127.0.0.1:8740/ws/modules/Amateur",
    );
    expect(socketUrl({ protocol: "https:", host: "gpredict.example" }, "Amateur")).toBe(
      "wss://gpredict.example/ws/modules/Amateur",
    );
    expect(socketUrl({ protocol: "http:", host: "localhost:5173" }, "A b")).toBe(
      "ws://localhost:5173/ws/modules/A%20b",
    );
  });
});
