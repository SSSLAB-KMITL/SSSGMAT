// Live ticks of one module over WebSocket /ws/modules/{name} (spec §7.3).
//
// The reconnect policy lives in the plain class ModuleSocket (testable with a fake WebSocket and a fake timer);
// useModuleSocket is the thin React wrapper around it.

import { useEffect, useState } from "react";
import type { Tick } from "./types";

/** Delay before reconnect attempt 1, 2, 3, 4, ...; the last value repeats. */
export const BACKOFF_MS = [1000, 2000, 4000, 5000] as const;

/** Close codes after which the server will not take the socket again: 1000 module closed or deleted, 1008 not open / forbidden. */
const FINAL_CLOSE_CODES: readonly number[] = [1000, 1008];

/**
 * Whether to reconnect after a close with this code: not after 1000 or 1008, but after anything else
 * (1001 server stopping, 1006 dropped, 1011 internal error, 1012 restart, 1013 slow socket).
 */
export function shouldReconnect(code: number): boolean {
  return !FINAL_CLOSE_CODES.includes(code);
}

/** The part of the browser's WebSocket that ModuleSocket uses (a fake implements the same). */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close(code?: number): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const browserTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ModuleSocketOptions {
  url: string;
  createSocket: SocketFactory;
  timer: Timer;
  onTick: (tick: Tick) => void;
  /** called whenever `connected` changes */
  onConnected: (connected: boolean) => void;
  /** the server closed the socket with a code after which it does not reconnect (1000, 1008) */
  onGone?: (code: number) => void;
}

function parseTick(data: unknown): Tick | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return typeof (value as { status?: unknown }).status === "string" ? (value as Tick) : null;
}

export class ModuleSocket {
  private socket: SocketLike | null = null;
  private retry: unknown = null;
  private attempt = 0;
  private running = false;
  private isConnected = false;

  constructor(private readonly opts: ModuleSocketOptions) {}

  get connected(): boolean {
    return this.isConnected;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.connect();
  }

  /** Close the socket and cancel a pending retry. Nothing is reported afterwards, not even a late event of the old socket. */
  stop(): void {
    this.running = false;
    if (this.retry !== null) {
      this.opts.timer.clear(this.retry);
      this.retry = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.isConnected = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000);
    }
  }

  private connect(): void {
    this.retry = null;
    let socket: SocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    const current = () => this.socket === socket; // events of a replaced or stopped socket are ignored
    socket.onopen = () => {
      if (current()) this.setConnected(true);
    };
    socket.onmessage = (ev) => {
      if (!current()) return;
      const tick = parseTick(ev.data);
      if (tick === null) return;
      this.attempt = 0; // the server is talking again: the next drop starts over at 1 s
      this.opts.onTick(tick);
    };
    socket.onerror = () => {
      // the close event that follows decides what happens
    };
    socket.onclose = (ev) => {
      if (!current()) return;
      this.socket = null;
      this.setConnected(false);
      if (shouldReconnect(ev.code)) this.scheduleRetry();
      else this.opts.onGone?.(ev.code);
    };
  }

  private scheduleRetry(): void {
    if (!this.running) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt += 1;
    this.retry = this.opts.timer.set(() => this.connect(), delay);
  }

  private setConnected(value: boolean): void {
    if (this.isConnected === value) return;
    this.isConnected = value;
    this.opts.onConnected(value);
  }
}

/** URL of the tick socket on the page's own host (in dev the Vite proxy forwards it to the server). */
export function socketUrl(loc: { protocol: string; host: string }, name: string): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws/modules/${encodeURIComponent(name)}`;
}

export interface ModuleSocketState {
  tick: Tick | null;
  connected: boolean;
  /** close code when the server ended the socket for good (1000, 1008), else null */
  closeCode: number | null;
}

interface Held extends ModuleSocketState {
  name: string | null;
}

const IDLE: ModuleSocketState = { tick: null, connected: false, closeCode: null };

/**
 * The newest tick of a module and whether the socket is up. `name` null holds no socket (no module open).
 * Only the module you pass holds a socket: a new name closes the old socket first, and so does unmounting.
 */
export function useModuleSocket(name: string | null): ModuleSocketState {
  const [held, setHeld] = useState<Held>({ name: null, ...IDLE });

  useEffect(() => {
    if (name === null) return;
    setHeld({ name, ...IDLE });
    const update = (change: Partial<ModuleSocketState>) =>
      setHeld((h) => (h.name === name ? { ...h, ...change } : h));
    const socket = new ModuleSocket({
      url: socketUrl(window.location, name),
      createSocket: (url) => new WebSocket(url),
      timer: browserTimer,
      onTick: (tick) => update({ tick }),
      onConnected: (connected) => update(connected ? { connected, closeCode: null } : { connected }),
      onGone: (closeCode) => update({ closeCode }),
    });
    socket.start();
    return () => socket.stop();
  }, [name]);

  // a render between a name change and its effect must not show the previous module's tick
  return held.name === name && name !== null ? held : IDLE;
}
