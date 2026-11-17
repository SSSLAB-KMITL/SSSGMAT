import { describe, expect, it } from "vitest";
import { detachedPage, detachedUrl } from "./detach";
import { announceAttach, AttachInbox, handoverStart, listenAttach, takeOver } from "./handover";
import type { ChannelLike, Handover } from "./handover";
import { targetPosts } from "./radio/controllerWindows";
import { pruneToOpen, withSelection } from "./selection";
import type { Selections } from "./selection";

/** A page's selections and the targets it has sent, as useSelection holds them: `select` and `prune` change the selections, and every change sends what `targetPosts` says. */
function page(selections: Selections = {}, sent: Selections = selections) {
  const posts: string[] = [];
  const p = {
    selections,
    sent,
    posts,
    /** the targets effect of useSelection */
    effect() {
      for (const { module, norad } of targetPosts(p.sent, p.selections)) posts.push(`${module}:${norad}`);
      p.sent = p.selections;
    },
    select(module: string, norad: number | null) {
      p.selections = withSelection(p.selections, module, norad);
      p.effect();
    },
    prune(tabs: readonly string[]) {
      p.selections = pruneToOpen(p.selections, tabs);
      p.effect();
    },
    /** useSelection's takeOver: the satellite counts as sent, then the selection changes */
    takeOver(module: string, h: Handover) {
      const t = takeOver(module, h);
      p.sent = t.selections(p.sent);
      p.selections = t.selections(p.selections);
      p.effect();
    },
  };
  return p;
}

describe("Detach hands the selection and Autotrack to the window in its address", () => {
  it("writes them after the module, and the window's page reads them back", () => {
    expect(detachedUrl("Amateur", false, { selected: 25544, autotrack: true })).toBe("/?module=Amateur&sel=25544&autotrack=1");
    expect(detachedUrl("Amateur", false, { selected: null, autotrack: true })).toBe("/?module=Amateur&autotrack=1");
    expect(detachedUrl("Amateur", false, { selected: 25544, autotrack: false })).toBe("/?module=Amateur&sel=25544");
    expect(detachedPage("?module=Amateur&sel=25544&autotrack=1")).toEqual({
      module: "Amateur",
      restored: false,
      handover: { selected: 25544, autotrack: true },
    });
    expect(detachedPage("?module=Amateur&autotrack=1")?.handover).toEqual({ selected: null, autotrack: true });
    expect(detachedPage("?module=Amateur&sel=7")?.handover).toEqual({ selected: 7, autotrack: false });
  });

  it("nothing selected and Autotrack off hand nothing over: the address is the one of before", () => {
    expect(detachedUrl("Amateur", false, { selected: null, autotrack: false })).toBe("/?module=Amateur");
    expect(detachedUrl("Amateur", false, null)).toBe("/?module=Amateur");
    expect(detachedPage("?module=Amateur")?.handover).toBeNull();
    // the restore bar's window (no partner page) has no handover either
    expect(detachedPage(detachedUrl("Amateur", true).slice(1))).toEqual({ module: "Amateur", restored: true, handover: null });
  });

  it("a satellite that is not a NORAD number is not taken", () => {
    for (const sel of ["", "x", "-1", "0", "1.5", "25544abc"]) expect(detachedPage(`?module=A&sel=${sel}`)?.handover ?? null, sel).toBeNull();
    expect(detachedPage("?module=A&sel=x&autotrack=1")?.handover).toEqual({ selected: null, autotrack: true });
  });
});

describe("handoverStart (the window starts with what Detach handed over)", () => {
  it("holds the satellite and Autotrack of its module", () => {
    const start = handoverStart("A", { selected: 25544, autotrack: true });
    expect(start.selections).toEqual({ A: 25544 });
    expect([...start.autotrack]).toEqual(["A"]);
    expect(handoverStart("A", { selected: null, autotrack: false })).toEqual({ selections: { A: null }, autotrack: new Set() });
  });

  it("sends no target: the satellite is the one the controllers follow already; the next one it chooses is sent", () => {
    const start = handoverStart("A", { selected: 25544, autotrack: true });
    const win = page(start.selections); // the targets sent start as the selections (useSelection's ref)
    win.effect();
    expect(win.posts).toEqual([]);
    win.select("A", 25544); // Autotrack keeps the satellite while it is up: nothing
    expect(win.posts).toEqual([]);
    win.select("A", 40069); // it set: Autotrack's next satellite
    expect(win.posts).toEqual(["A:40069"]);
  });
});

describe("Detach and Attach, the main page and the window together", () => {
  it("the selection goes with the module both ways and the handover itself sends no target", () => {
    // the main page has A (selected 25544, so its controllers follow it) and B as tabs
    const main = page();
    main.select("A", 25544);
    main.select("B", 7530);
    expect(main.posts).toEqual(["A:25544", "B:7530"]);
    main.posts.length = 0;

    // Detach of A: the window starts with 25544; the main page forgets A when A leaves its tabs (spec §8.1)
    const win = page(handoverStart("A", { selected: 25544, autotrack: false }).selections);
    win.effect();
    main.prune(["B"]);
    expect(main.selections).toEqual({ B: 7530 });

    // the window chooses another satellite: its target is sent
    win.select("A", 40069);
    expect(win.posts).toEqual(["A:40069"]);

    // Attach: the main page takes 40069 over when A is a tab again, and sends nothing
    main.prune(["B", "A"]);
    main.takeOver("A", { selected: 40069, autotrack: true });
    expect(main.selections).toEqual({ B: 7530, A: 40069 });
    expect(main.posts).toEqual([]);

    // a click on the satellite it had before Detach moves the controllers again (it is not stuck any more)
    main.select("A", 25544);
    expect(main.posts).toEqual(["A:25544"]);
  });

  it("without a handover (no partner page) the module comes back with nothing selected, and a click is sent", () => {
    const main = page();
    main.select("A", 25544);
    main.prune([]); // detached
    main.prune(["A"]); // attached, its window's page not there to hand anything over
    expect(main.selections).toEqual({});
    main.posts.length = 0;
    main.select("A", 25544);
    expect(main.posts).toEqual(["A:25544"]);
  });

  it("taking over the satellite the page already shows changes nothing and sends nothing", () => {
    const main = page({ A: 1 });
    main.takeOver("A", { selected: 1, autotrack: false });
    expect(main.posts).toEqual([]);
    const t = takeOver("A", { selected: 1, autotrack: false });
    const held = { A: 1 };
    expect(t.selections(held)).toBe(held);
    const on = new Set(["A"]);
    expect(takeOver("A", { selected: 1, autotrack: true }).autotrack(on)).toBe(on);
    expect([...takeOver("A", { selected: 1, autotrack: false }).autotrack(on)]).toEqual([]);
  });
});

describe("AttachInbox (the main page keeps a handover of Attach until its module is a tab)", () => {
  it("gives a handover once its module is a tab, and only once", () => {
    const inbox = new AttachInbox();
    inbox.receive("A", { selected: 1, autotrack: true });
    expect(inbox.arrived(["B"])).toEqual([]); // the main page has not read the modules again yet
    expect(inbox.arrived(["B", "A"])).toEqual([["A", { selected: 1, autotrack: true }]]);
    expect(inbox.arrived(["B", "A"])).toEqual([]);
  });

  it("gives it at once when the module is a tab already (the message came after the list of modules)", () => {
    const inbox = new AttachInbox();
    inbox.receive("A", { selected: 2, autotrack: false });
    expect(inbox.arrived(["A"])).toEqual([["A", { selected: 2, autotrack: false }]]);
  });

  it("keeps only the newest handover of a module", () => {
    const inbox = new AttachInbox();
    inbox.receive("A", { selected: 1, autotrack: false });
    inbox.receive("A", { selected: 2, autotrack: true });
    expect(inbox.arrived(["A"])).toEqual([["A", { selected: 2, autotrack: true }]]);
  });
});

/** BroadcastChannels of one origin: what one posts reaches the others that are open, not itself. */
function channels() {
  const open = new Set<ChannelLike>();
  const make = (): ChannelLike => {
    const ch: ChannelLike = {
      onmessage: null,
      postMessage: (data: unknown) => {
        for (const other of open) if (other !== ch) other.onmessage?.({ data } as MessageEvent);
      },
      close: () => void open.delete(ch),
    };
    open.add(ch);
    return ch;
  };
  return { open, make };
}

describe("the message of Attach (BroadcastChannel)", () => {
  it("reaches every main page that listens, with the module, its satellite and Autotrack", () => {
    const c = channels();
    const heard: [string, Handover][] = [];
    const stop = listenAttach((module, h) => void heard.push([module, h]), c.make);
    announceAttach("A", { selected: 25544, autotrack: true }, c.make);
    expect(heard).toEqual([["A", { selected: 25544, autotrack: true }]]);
    expect(c.open.size).toBe(1); // the window's channel is closed once the message is posted
    stop();
    expect(c.open.size).toBe(0);
    announceAttach("A", { selected: 1, autotrack: false }, c.make);
    expect(heard).toHaveLength(1);
  });

  it("ignores what is not a message of Attach", () => {
    const c = channels();
    const heard: string[] = [];
    listenAttach((module) => void heard.push(module), c.make);
    const sender = c.make();
    for (const data of [
      null,
      "attached",
      { type: "other", module: "A", selected: 1, autotrack: false },
      { type: "attached", module: "", selected: 1, autotrack: false },
      { type: "attached", module: "A", selected: "1", autotrack: false },
      { type: "attached", module: "A", selected: 1.5, autotrack: false },
      { type: "attached", module: "A", selected: 1, autotrack: "yes" },
    ]) {
      sender.postMessage(data);
    }
    expect(heard).toEqual([]);
    sender.postMessage({ type: "attached", module: "A", selected: null, autotrack: false });
    expect(heard).toEqual(["A"]);
  });

  it("does nothing in a browser without BroadcastChannel", () => {
    expect(() => announceAttach("A", { selected: 1, autotrack: false }, () => null)).not.toThrow();
    const stop = listenAttach(() => {}, () => null);
    expect(() => stop()).not.toThrow();
  });
});
