import { describe, expect, it } from "vitest";
import { ConfigStore } from "./configStore";
import type { ModuleConfig } from "./types";

function cfg(over: Partial<ModuleConfig> = {}): ModuleConfig {
  return {
    name: "M",
    qth: null,
    satellites: [1, 2, 3],
    layout_code: "0;0;1;0;1",
    refresh: { data_ms: 300, list: 1, map: 10, polar: 3, single: 1, event: 1 },
    list_columns: ["Satellite", "Az"],
    list_sort: { column: "Satellite", ascending: true },
    map: { contents: {}, track_orbits: 3, center_lon: 0 },
    polar: { orientation: "N/E/S/W", contents: {}, auto_skytrack: false },
    single: { fields: ["Azimuth"], selected: null },
    footprint_off: [],
    ground_track: [],
    sky_track: [],
    ...over,
  };
}

/** A `put` the test settles by hand, one call at a time. */
function fakePut() {
  const calls: { body: ModuleConfig; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const put = (body: ModuleConfig) => new Promise<void>((resolve, reject) => calls.push({ body, resolve, reject }));
  return { put, calls };
}

/** Let the promise callbacks that are already queued run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const sortBy = (column: string) => (c: ModuleConfig): ModuleConfig => ({ ...c, list_sort: { column, ascending: true } });
const select = (norad: number) => (c: ModuleConfig): ModuleConfig => ({ ...c, single: { ...c.single, selected: norad } });
const toggle = (c: ModuleConfig): ModuleConfig => ({ ...c, list_sort: { ...c.list_sort, ascending: !c.list_sort.ascending } });

/** Starts a save and records how it ends. */
function track(p: Promise<void>) {
  const out: { state: "pending" | "saved" | "failed"; error?: unknown } = { state: "pending" };
  p.then(
    () => void (out.state = "saved"),
    (e: unknown) => void ((out.state = "failed"), (out.error = e)),
  );
  return out;
}

describe("ConfigStore", () => {
  it("shows a change at once and sends the whole configuration with only that change", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const done = track(store.save(sortBy("El")));
    expect(store.config.list_sort.column).toBe("El"); // before the server has answered
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual(cfg({ list_sort: { column: "El", ascending: true } }));
    calls[0]!.resolve();
    await flush();
    expect(done.state).toBe("saved");
    expect(store.config.list_sort.column).toBe("El");
  });

  it("reverts a failed save to the last configuration the server confirmed and rejects with the error", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const boom = new Error("refused");
    const done = track(store.save(sortBy("El")));
    calls[0]!.reject(boom);
    await flush();
    expect(done).toEqual({ state: "failed", error: boom });
    expect(store.config).toEqual(cfg());
  });

  it("reverts to the confirmed save, not to the start, when a later save fails", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    void store.save(sortBy("El"));
    calls[0]!.resolve();
    await flush();
    const second = track(store.save(select(2)));
    expect(store.config.single.selected).toBe(2);
    calls[1]!.reject(new Error("refused"));
    await flush();
    expect(second.state).toBe("failed");
    expect(store.config.single.selected).toBeNull();
    expect(store.config.list_sort.column).toBe("El"); // the confirmed one stays
  });

  it("sends one request at a time, in the order of the saves", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const a = track(store.save(sortBy("El")));
    const b = track(store.save(select(2)));
    expect(calls).toHaveLength(1); // B waits for A
    expect(store.config.list_sort.column).toBe("El"); // both changes show already
    expect(store.config.single.selected).toBe(2);
    calls[0]!.resolve();
    await flush();
    expect(a.state).toBe("saved");
    expect(calls).toHaveLength(2);
    // B is sent on top of what A stored: neither change undoes the other
    expect(calls[1]!.body).toEqual(cfg({ list_sort: { column: "El", ascending: true }, single: { fields: ["Azimuth"], selected: 2 } }));
    calls[1]!.resolve();
    await flush();
    expect(b.state).toBe("saved");
  });

  it("does not revert while a newer save is pending: A fails, B is sent without A's change and the screen shows B only", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const a = track(store.save(sortBy("El")));
    const b = track(store.save(select(2)));
    calls[0]!.reject(new Error("A refused"));
    await flush();
    expect(a.state).toBe("failed");
    expect(store.config.single.selected).toBe(2); // B's change is not lost
    expect(store.config.list_sort.column).toBe("Satellite"); // A's is gone
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(cfg({ single: { fields: ["Azimuth"], selected: 2 } })); // what the server will hold
    calls[1]!.resolve();
    await flush();
    expect(b.state).toBe("saved");
    expect(store.config).toEqual(cfg({ single: { fields: ["Azimuth"], selected: 2 } }));
  });

  it("two failing saves in a row leave the screen on what the server holds, not on the first change", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const a = track(store.save(sortBy("El")));
    const b = track(store.save(select(2)));
    calls[0]!.reject(new Error("A refused"));
    await flush();
    calls[1]!.reject(new Error("B refused"));
    await flush();
    expect(a.state).toBe("failed");
    expect(b.state).toBe("failed");
    expect(store.config).toEqual(cfg());
  });

  it("failures arrive in the order of the saves even if the second would fail at once", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const a = track(store.save(sortBy("El")));
    const b = track(store.save(select(2)));
    expect(calls).toHaveLength(1); // B has not been sent, so it cannot answer before A
    calls[0]!.resolve();
    await flush();
    calls[1]!.reject(new Error("B refused"));
    await flush();
    expect([a.state, b.state]).toEqual(["saved", "failed"]);
    expect(store.config).toEqual(cfg({ list_sort: { column: "El", ascending: true } }));
  });

  it("applies each change to the configuration the one before it left, also for a change that depends on it", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    void store.save(toggle);
    void store.save(toggle);
    expect(store.config.list_sort.ascending).toBe(true); // toggled twice
    calls[0]!.resolve();
    await flush();
    expect(calls[1]!.body.list_sort.ascending).toBe(true);
    // the first toggle fails: the second is applied to the confirmed configuration instead
    const other = fakePut();
    const store2 = new ConfigStore(cfg(), other.put);
    void store2.save(toggle).catch(() => undefined);
    void store2.save(toggle);
    other.calls[0]!.reject(new Error("refused"));
    await flush();
    expect(other.calls[1]!.body.list_sort.ascending).toBe(false);
    expect(store2.config.list_sort.ascending).toBe(false);
  });

  it("is not undone by a late failure after the configuration was read again from the server", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    const done = track(store.save(sortBy("El")));
    const reread = cfg({ satellites: [1, 2, 3, 4], list_sort: { column: "Alt", ascending: false } });
    store.reset(reread);
    expect(store.config.satellites).toEqual([1, 2, 3, 4]); // the saved change shows on top of it
    expect(store.config.list_sort.column).toBe("El");
    calls[0]!.reject(new Error("refused"));
    await flush();
    expect(done.state).toBe("failed");
    expect(store.config).toEqual(reread); // not the configuration from before the reread
  });

  it("sends a save made after a reread on top of the reread configuration", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    store.reset(cfg({ satellites: [9] }));
    void store.save(select(9));
    expect(calls[0]!.body.satellites).toEqual([9]);
    expect(calls[0]!.body.single.selected).toBe(9);
  });

  it("takes what the server stored for the configuration, even if a reread came while the request was out", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    void store.save(sortBy("El"));
    store.reset(cfg({ satellites: [7] }));
    calls[0]!.resolve(); // the server now holds what was sent: the old satellites with the new sort
    await flush();
    expect(store.config.satellites).toEqual([1, 2, 3]);
    expect(store.config.list_sort.column).toBe("El");
  });

  it("goes on with the next save after one fails, also when the change itself throws or put throws at once", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), (body) => {
      if (body.list_sort.column === "Boom") throw new Error("sync");
      return put(body);
    });
    const bad = track(store.save(sortBy("Boom")));
    const throwing = track(
      store.save(() => {
        throw new Error("change");
      }),
    );
    const good = track(store.save(select(3)));
    await flush();
    expect(bad.state).toBe("failed");
    expect(throwing.state).toBe("failed");
    expect(calls).toHaveLength(1);
    calls[0]!.resolve();
    await flush();
    expect(good.state).toBe("saved");
    expect(store.config).toEqual(cfg({ single: { fields: ["Azimuth"], selected: 3 } }));
  });

  it("tells subscribers when the configuration changes, and not when a confirmed save changes nothing", async () => {
    const { put, calls } = fakePut();
    const store = new ConfigStore(cfg(), put);
    let seen = 0;
    const unsubscribe = store.subscribe(() => void seen++);
    void store.save(sortBy("El"));
    expect(seen).toBe(1);
    const shown = store.config;
    calls[0]!.resolve();
    await flush();
    expect(seen).toBe(1); // the server confirmed what was already on screen
    expect(store.config).toBe(shown); // and the object did not change
    unsubscribe();
    void store.save(sortBy("Alt"));
    expect(seen).toBe(1);
  });

  it("keeps the same object while nothing changed", () => {
    const { put } = fakePut();
    const initial = cfg();
    const store = new ConfigStore(initial, put);
    expect(store.config).toBe(initial);
    store.reset(cfg()); // equal, not the same
    expect(store.config).toBe(initial);
  });
});
