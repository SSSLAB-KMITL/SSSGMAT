import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_WS_RETRY_MS, appSocketUrl, connectAppEvents, keepIfSame, withConfigReads, withControllerSync } from "./appEvents";
import type { SocketLike } from "./useModuleSocket";

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
  // what the network and the server do
  open(): void {
    this.onopen?.();
  }
  send(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }
  serverClose(code: number): void {
    this.onclose?.({ code });
  }
}

function setup(options: { failFirst?: number } = {}) {
  const sockets: FakeSocket[] = [];
  let failures = options.failFirst ?? 0;
  const createSocket = (url: string): FakeSocket => {
    if (failures > 0) {
      failures -= 1;
      throw new Error("no WebSocket");
    }
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  const calls: string[] = [];
  const handlers = {
    prefsChanged: () => void calls.push("prefs"),
    modulesChanged: () => void calls.push("modules"),
    moduleConfigChanged: (modules: readonly string[]) => void calls.push(`config:${modules.join(",")}`),
    tleOld: (text: string) => void calls.push(`tle:${text}`),
    connected: () => void calls.push("connected"),
  };
  const stop = connectAppEvents(handlers, { url: "ws://host/ws/app", createSocket });
  return { sockets, calls, stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connectAppEvents", () => {
  it("dispatches app events", () => {
    const { sockets, calls } = setup();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe("ws://host/ws/app");
    sockets[0]!.open();
    sockets[0]!.send({ type: "prefs_changed" });
    sockets[0]!.send({ type: "modules_changed" });
    sockets[0]!.send({ type: "tle_old", text: "TLE data is old" });
    sockets[0]!.send({ type: "module_config_changed", modules: ["M", "N"] });
    expect(calls).toEqual(["connected", "prefs", "modules", "tle:TLE data is old", "config:M,N"]);
  });

  it("ignores what is not an event of the program", () => {
    const { sockets, calls } = setup();
    for (const data of [
      "not json",
      "[1]",
      "null",
      '"prefs_changed"',
      '{"type": 3}',
      '{"type": "something_else"}',
      '{"type": "tle_old"}', // without its text
      '{"type": "tle_old", "text": 5}',
      '{"type": "module_config_changed"}', // without the names
      '{"type": "module_config_changed", "modules": "M"}',
      '{"type": "module_config_changed", "modules": ["M", 5]}',
      new ArrayBuffer(1), // a binary frame
    ]) {
      sockets[0]!.send(data);
    }
    expect(calls).toEqual([]);
  });

  it("tells the handlers that it is connected on every open, so the page reads what it missed (events before it are not replayed)", () => {
    const { sockets, calls } = setup();
    sockets[0]!.open();
    sockets[0]!.serverClose(1006);
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    sockets[1]!.open();
    expect(calls).toEqual(["connected", "connected"]);
  });

  it("does not need the optional handler", () => {
    const sockets: FakeSocket[] = [];
    connectAppEvents(
      { prefsChanged: () => {}, modulesChanged: () => {}, moduleConfigChanged: () => {}, tleOld: () => {} },
      { url: "ws://host/ws/app", createSocket: (url) => (sockets[sockets.length] = new FakeSocket(url)) },
    );
    expect(() => sockets[0]!.open()).not.toThrow();
  });

  it("reconnects after close", () => {
    expect(APP_WS_RETRY_MS).toBe(2000);
    const { sockets } = setup();
    sockets[0]!.serverClose(1006);
    vi.advanceTimersByTime(APP_WS_RETRY_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    // the same delay again, with no back-off, whatever the code of the close
    sockets[1]!.serverClose(1001); // the server is stopping
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    expect(sockets).toHaveLength(3);
    sockets[2]!.serverClose(1013); // the server could not send to this page
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    expect(sockets).toHaveLength(4);
  });

  it("keeps trying while a socket cannot even be made", () => {
    const { sockets } = setup({ failFirst: 2 });
    expect(sockets).toHaveLength(0);
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    expect(sockets).toHaveLength(0);
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    expect(sockets).toHaveLength(1);
  });

  it("an error alone does not reconnect: the close that follows it does", () => {
    const { sockets } = setup();
    sockets[0]!.onerror?.();
    vi.advanceTimersByTime(APP_WS_RETRY_MS * 3);
    expect(sockets).toHaveLength(1);
  });

  it("the stop function closes the socket and reports nothing more, not even a late event or close of the old socket", () => {
    const { sockets, calls, stop } = setup();
    const first = sockets[0]!;
    first.open();
    stop();
    expect(first.closedByClient).toBe(1000);
    first.send({ type: "prefs_changed" });
    first.serverClose(1006);
    vi.advanceTimersByTime(APP_WS_RETRY_MS * 3);
    expect(calls).toEqual(["connected"]);
    expect(sockets).toHaveLength(1);
  });

  it("the stop function cancels a reconnect that is waiting", () => {
    const { sockets, stop } = setup();
    sockets[0]!.serverClose(1006);
    stop();
    vi.advanceTimersByTime(APP_WS_RETRY_MS * 3);
    expect(sockets).toHaveLength(1);
  });

  it("a socket that was replaced is not heard", () => {
    const { sockets, calls } = setup();
    sockets[0]!.serverClose(1006);
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    sockets[0]!.send({ type: "modules_changed" });
    sockets[0]!.serverClose(1006); // a second close of the old one must not make a second retry
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    expect(calls).toEqual([]);
    expect(sockets).toHaveLength(2);
  });
});

describe("appSocketUrl", () => {
  it("is on the page's own host, wss under https", () => {
    expect(appSocketUrl({ protocol: "http:", host: "localhost:8740" })).toBe("ws://localhost:8740/ws/app");
    expect(appSocketUrl({ protocol: "https:", host: "example.org" })).toBe("wss://example.org/ws/app");
  });
});

describe("keepIfSame", () => {
  it("keeps the old value (the same object) while the new one equals it, so that a state set to it changes nothing", () => {
    const before = { open: ["A", "B"], modules: ["A", "B", "C"] };
    expect(keepIfSame(before, { open: ["A", "B"], modules: ["A", "B", "C"] })).toBe(before);
    const list = ["A"];
    expect(keepIfSame(list, ["A"])).toBe(list);
  });

  it("takes the new value when it differs, in content or in order", () => {
    const next = ["B", "A"];
    expect(keepIfSame(["A", "B"], next)).toBe(next);
    expect(keepIfSame(["A"], ["A", "B"])).toEqual(["A", "B"]);
    expect(keepIfSame<string[]>([], [])).toEqual([]);
  });
});

describe("withConfigReads (the pages read the configuration of the modules they show again)", () => {
  function page(shown: () => readonly string[]) {
    const sockets: FakeSocket[] = [];
    const reads: string[] = [];
    const calls: string[] = [];
    const handlers = withConfigReads(
      {
        prefsChanged: () => void calls.push("prefs"),
        modulesChanged: () => void calls.push("modules"),
        tleOld: () => void calls.push("tle"),
        connected: () => void calls.push("connected"),
      },
      { shown, reread: (name) => void reads.push(name) },
    );
    const createSocket = (url: string) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    };
    const stop = connectAppEvents(handlers, { url: "ws://host/ws/app", createSocket });
    return { sockets, reads, calls, stop };
  }

  it("reads a shown module again when module_config_changed names it, and no other", () => {
    let shown: readonly string[] = ["M"];
    const { sockets, reads, calls } = page(() => shown);
    sockets[0]!.open();
    reads.length = 0;
    sockets[0]!.send({ type: "module_config_changed", modules: ["X", "M"] });
    expect(reads).toEqual(["M"]);
    sockets[0]!.send({ type: "module_config_changed", modules: ["X"] });
    expect(reads).toEqual(["M"]);
    shown = ["N"]; // another tab is shown now
    sockets[0]!.send({ type: "module_config_changed", modules: ["M"] });
    expect(reads).toEqual(["M"]);
    sockets[0]!.send({ type: "prefs_changed" }); // new Preferences alone do not read an open module again (spec §9.1)
    expect(reads).toEqual(["M"]);
    expect(calls).toEqual(["connected", "prefs"]);
  });

  it("reads every shown module again on every connect: the events sent while the socket was down are lost", () => {
    let shown: readonly string[] = ["M"];
    const { sockets, reads, calls } = page(() => shown);
    sockets[0]!.open();
    expect(reads).toEqual(["M"]);
    shown = ["N"];
    sockets[0]!.serverClose(1001); // the server restarted
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    sockets[1]!.open();
    expect(reads).toEqual(["M", "N"]);
    expect(calls).toEqual(["connected", "connected"]);
    shown = [];
    sockets[1]!.serverClose(1001);
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    sockets[2]!.open();
    expect(reads).toEqual(["M", "N"]);
  });
});

describe("withControllerSync (the main page reads the open controllers again)", () => {
  it("syncs the controller windows on every connect and every modules_changed, and still calls the page's handlers", () => {
    const sockets: FakeSocket[] = [];
    const calls: string[] = [];
    const handlers = withControllerSync(
      {
        prefsChanged: () => void calls.push("prefs"),
        modulesChanged: () => void calls.push("modules"),
        moduleConfigChanged: () => void calls.push("config"),
        tleOld: () => void calls.push("tle"),
        connected: () => void calls.push("connected"),
      },
      () => void calls.push("sync"),
    );
    connectAppEvents(handlers, {
      url: "ws://host/ws/app",
      createSocket: (url) => (sockets[sockets.length] = new FakeSocket(url)),
    });
    sockets[0]!.open();
    // Attach of a module window publishes modules_changed: a controller opened in that window shows on the main page again
    sockets[0]!.send({ type: "modules_changed" });
    sockets[0]!.send({ type: "prefs_changed" });
    sockets[0]!.send({ type: "module_config_changed", modules: ["M"] });
    sockets[0]!.serverClose(1001); // the server restarted: its controllers are read again
    vi.advanceTimersByTime(APP_WS_RETRY_MS);
    sockets[1]!.open();
    expect(calls).toEqual(["connected", "sync", "modules", "sync", "prefs", "config", "connected", "sync"]);
  });

  it("works without a connected handler", () => {
    const calls: string[] = [];
    const h = withControllerSync({ prefsChanged: () => {}, modulesChanged: () => {}, tleOld: () => {} }, () => void calls.push("sync"));
    h.connected?.();
    expect(calls).toEqual(["sync"]);
  });
});
