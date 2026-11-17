import { describe, expect, it } from "vitest";
import type { PrefsAnswer } from "../types";
import { PrefsStore } from "./prefsStore";

const ELEV = "PREDICT/MINIMUM_ELEV";

const answer = (elev = 5, user: string[] = []): PrefsAnswer => ({
  values: { [ELEV]: elev, "PREDICT/LOOK_AHEAD": 3 },
  defaults: { [ELEV]: 5, "PREDICT/LOOK_AHEAD": 3 },
  user,
});

/** A server the test answers by hand, one request at a time. */
function fakeServer() {
  const gets: { resolve: (a: PrefsAnswer) => void; reject: (e: unknown) => void }[] = [];
  const puts: { set: Record<string, unknown>; remove: readonly string[]; resolve: (a: PrefsAnswer) => void; reject: (e: unknown) => void }[] = [];
  const get = () => new Promise<PrefsAnswer>((resolve, reject) => gets.push({ resolve, reject }));
  const put = (set: Record<string, unknown>, remove: readonly string[]) =>
    new Promise<PrefsAnswer>((resolve, reject) => puts.push({ set, remove, resolve, reject }));
  return { get, put: put as never, gets, puts };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Let the promise callbacks that are already queued run. */
const flush = () => sleep(0);

function newStore() {
  const server = fakeServer();
  const store = new PrefsStore(server.get, server.put);
  return { server, store };
}

describe("PrefsStore", () => {
  it("has nothing, and asks nobody, until a user subscribes", async () => {
    const { server, store } = newStore();
    await flush();
    expect(store.getSnapshot()).toBeNull();
    expect(server.gets).toHaveLength(0);
  });

  it("loads once when the first user comes, and shares the answer with the next", async () => {
    const { server, store } = newStore();
    let told = 0;
    store.subscribe(() => told++);
    store.subscribe(() => told++);
    expect(server.gets).toHaveLength(1);
    server.gets[0]!.resolve(answer());
    await flush();
    expect(store.getSnapshot()).toEqual(answer());
    expect(told).toBe(2); // one change, both users told once
    store.subscribe(() => told++);
    await flush();
    expect(server.gets).toHaveLength(1);
  });

  it("tries again for the next user when the first load failed", async () => {
    const { server, store } = newStore();
    const stop = store.subscribe(() => undefined);
    server.gets[0]!.reject(new Error("down"));
    await flush();
    expect(store.getSnapshot()).toBeNull();
    stop();
    store.subscribe(() => undefined);
    expect(server.gets).toHaveLength(2);
    server.gets[1]!.resolve(answer(7, [ELEV]));
    await flush();
    expect(store.getSnapshot()?.values[ELEV]).toBe(7);
  });

  it("keeps trying while a user waits for the first load, and stops when the answer has come or the last user has gone", async () => {
    const server = fakeServer();
    const store = new PrefsStore(server.get, server.put, 5);
    const stop = store.subscribe(() => undefined);
    server.gets[0]!.reject(new Error("down"));
    await sleep(40);
    expect(server.gets).toHaveLength(2);
    server.gets[1]!.reject(new Error("still down"));
    stop();
    await sleep(40);
    expect(server.gets).toHaveLength(2); // nobody is waiting any more

    store.subscribe(() => undefined);
    expect(server.gets).toHaveLength(3);
    server.gets[2]!.resolve(answer());
    await sleep(40);
    expect(store.getSnapshot()).toEqual(answer());
    expect(server.gets).toHaveLength(3);
  });

  it("reload reads again, shares a read that is under way, and rejects with the error of a failed one", async () => {
    const { server, store } = newStore();
    const first = store.reload();
    const second = store.reload();
    expect(server.gets).toHaveLength(1);
    server.gets[0]!.resolve(answer(5));
    await Promise.all([first, second]);
    expect(store.getSnapshot()?.values[ELEV]).toBe(5);

    const third = store.reload();
    expect(server.gets).toHaveLength(2);
    server.gets[1]!.resolve(answer(9, [ELEV]));
    await third;
    expect(store.getSnapshot()).toEqual(answer(9, [ELEV]));

    const boom = new Error("down");
    const failed = store.reload();
    server.gets[2]!.reject(boom);
    await expect(failed).rejects.toBe(boom);
    expect(store.getSnapshot()).toEqual(answer(9, [ELEV])); // what it had stays
  });

  it("does not start a second load for a user who comes while reload is under way", async () => {
    const { server, store } = newStore();
    const reading = store.reload();
    store.subscribe(() => undefined);
    expect(server.gets).toHaveLength(1);
    server.gets[0]!.resolve(answer());
    await reading;
  });

  it("save sends set and remove and shows the answer of the server", async () => {
    const { server, store } = newStore();
    const told: (PrefsAnswer | null)[] = [];
    store.subscribe(() => told.push(store.getSnapshot()));
    server.gets[0]!.resolve(answer());
    await flush();
    const saving = store.save({ [ELEV]: 30 }, ["PREDICT/LOOK_AHEAD"]);
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]!.set).toEqual({ [ELEV]: 30 });
    expect(server.puts[0]!.remove).toEqual(["PREDICT/LOOK_AHEAD"]);
    expect(store.getSnapshot()?.values[ELEV]).toBe(5); // nothing shown before the server has agreed
    server.puts[0]!.resolve(answer(30, [ELEV]));
    await saving;
    expect(store.getSnapshot()).toEqual(answer(30, [ELEV]));
    expect(told).toHaveLength(2);
  });

  it("save rejects with the error of the server and leaves the values alone", async () => {
    const { server, store } = newStore();
    const reading = store.reload();
    server.gets[0]!.resolve(answer());
    await reading;
    const boom = new Error("PREFS_INVALID");
    const saving = store.save({ [ELEV]: 99 }, []);
    server.puts[0]!.reject(boom);
    await expect(saving).rejects.toBe(boom);
    expect(store.getSnapshot()).toEqual(answer());
  });

  it("a read that was sent before a save and answers after it does not bring the old values back", async () => {
    const { server, store } = newStore();
    const reading = store.reload();
    const saving = store.save({ [ELEV]: 30 }, []);
    server.puts[0]!.resolve(answer(30, [ELEV]));
    await saving;
    server.gets[0]!.resolve(answer(5)); // read before the save, answered late
    await reading;
    expect(store.getSnapshot()).toEqual(answer(30, [ELEV]));
  });

  it("keeps the same answer object, and tells nobody, when a read brings nothing new", async () => {
    const { server, store } = newStore();
    let told = 0;
    const reading = store.reload();
    store.subscribe(() => told++);
    server.gets[0]!.resolve(answer());
    await reading;
    const before = store.getSnapshot();
    const again = store.reload();
    server.gets[1]!.resolve(answer());
    await again;
    expect(store.getSnapshot()).toBe(before);
    expect(told).toBe(1);
  });

  it("stops telling a user who has unsubscribed", async () => {
    const { server, store } = newStore();
    let told = 0;
    const stop = store.subscribe(() => told++);
    stop();
    const reading = store.reload();
    server.gets[0]!.resolve(answer());
    await reading;
    expect(told).toBe(0);
  });
});
