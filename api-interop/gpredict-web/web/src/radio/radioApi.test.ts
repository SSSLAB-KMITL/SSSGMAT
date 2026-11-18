import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import {
  checkHwconf,
  closeController,
  controllerAction,
  getControllers,
  getHwconf,
  getTransponders,
  openController,
  postTarget,
  putHwconf,
  updateTransponders,
} from "./radioApi";
import { TabError } from "../prefs/prefPlaces";
import type { HwConf } from "./types";

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const body = (call: Call | undefined) => JSON.parse(String(call?.init?.body));

afterEach(() => vi.unstubAllGlobals());

describe("hwconf", () => {
  const HW: HwConf = { radios: [], rotators: [] };

  it("GETs the devices", async () => {
    const calls = stubFetch(() => json(HW));
    expect(await getHwconf()).toEqual(HW);
    expect(calls[0]!.url).toBe("/api/hwconf");
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("PUTs both lists as JSON", async () => {
    const calls = stubFetch(() => json(HW));
    await putHwconf(HW);
    expect(calls[0]!.url).toBe("/api/hwconf");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(body(calls[0])).toEqual(HW);
  });

  it("a dry run goes to ?dry_run=true with the same body", async () => {
    const calls = stubFetch(() => json(HW));
    await putHwconf(HW, { dryRun: true });
    expect(calls[0]!.url).toBe("/api/hwconf?dry_run=true");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(body(calls[0])).toEqual(HW);
    await putHwconf(HW, {});
    expect(calls[1]!.url).toBe("/api/hwconf");
  });

  it("throws the server's refusal as ApiError, with its Thai text and the key", async () => {
    stubFetch(() => json({ code: "HWCONF_INVALID", level: "error", text: "Host ต้องเป็นข้อความยาว 1–50 ตัวอักษร", object: "Host" }, 422));
    const e = await putHwconf(HW).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("HWCONF_INVALID");
    expect((e as ApiError).object).toBe("Host");
  });
});

describe("transponders", () => {
  it("GETs the transponders of a satellite and returns the list", async () => {
    const t = { name: "Mode U/V", up_low: 435_000_000, up_high: 435_100_000, down_low: 145_900_000, down_high: 146_000_000, invert: true, mode: "SSB", baud: 0 };
    const calls = stubFetch(() => json({ norad: 7530, transponders: [t] }));
    expect(await getTransponders(7530)).toEqual([t]);
    expect(calls[0]!.url).toBe("/api/trsp/7530");
  });

  it("POSTs the update and returns the whole answer", async () => {
    const answer = { status: "Finished", cached: true, fetched_at: null, satellites: 0, messages: [] };
    const calls = stubFetch(() => json(answer));
    expect(await updateTransponders()).toEqual(answer);
    expect(calls[0]!.url).toBe("/api/trsp/update");
    expect(calls[0]!.init?.method).toBe("POST");
  });
});

describe("controllers", () => {
  it("POSTs the target satellite of a module (204: nothing comes back)", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    expect(await postTarget("My Module/1", 25544)).toBeUndefined();
    expect(calls[0]!.url).toBe("/api/modules/My%20Module%2F1/target");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(body(calls[0])).toEqual({ norad: 25544 });
  });

  it("lists the open controllers", async () => {
    const calls = stubFetch(() => json({ open: [{ module: "Amateur", kind: "radio" }] }));
    expect(await getControllers()).toEqual([{ module: "Amateur", kind: "radio" }]);
    expect(calls[0]!.url).toBe("/api/controllers");
  });

  it("opens and closes a controller, and answers the open ones", async () => {
    const calls = stubFetch(() => json({ open: [{ module: "A", kind: "rotator" }] }));
    expect(await openController("A", "rotator")).toEqual([{ module: "A", kind: "rotator" }]);
    expect(await closeController("A", "radio")).toEqual([{ module: "A", kind: "rotator" }]);
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ["POST", "/api/modules/A/rotator/open"],
      ["POST", "/api/modules/A/radio/close"],
    ]);
  });

  it("sends an action and unwraps the state under the key of the kind", async () => {
    const radio = { engaged: true };
    const rotator = { engaged: false };
    const calls = stubFetch((url) => json(url.endsWith("/radio") ? { radio } : { rotator }));
    expect(await controllerAction("A", "radio", { action: "engage", on: true })).toEqual(radio);
    expect(calls[0]!.url).toBe("/api/modules/A/radio");
    expect(body(calls[0])).toEqual({ action: "engage", on: true });
    expect(await controllerAction("A", "rotator", { action: "track", on: false })).toEqual(rotator);
    expect(calls[1]!.url).toBe("/api/modules/A/rotator");
  });

  it("an error of a controller is an ApiError (the window shows its Thai text)", async () => {
    stubFetch(() => json({ code: "NOT_FOUND", level: "error", text: "module A ไม่ได้เปิดอยู่", object: "A" }, 404));
    const e = await controllerAction("A", "radio", { action: "tune" }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(404);
  });
});

describe("checkHwconf (the check of the Interfaces page before OK writes)", () => {
  const RADIO = { name: "IC-910" } as unknown as HwConf["radios"][number];
  const HW: HwConf = { radios: [RADIO], rotators: [] };
  const refusal = (text: string) => json({ code: "HWCONF_INVALID", level: "error", text, object: "Port" }, 422);

  it("is one dry run when the devices are right", async () => {
    const calls = stubFetch(() => json(HW));
    await checkHwconf(HW);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/hwconf?dry_run=true");
    expect(body(calls[0])).toEqual(HW);
  });

  it("a refusal names the Radios tab when the radios alone are refused", async () => {
    const calls = stubFetch(() => refusal("Port ต้องเป็นจำนวนเต็ม 1024–65535"));
    const e = await checkHwconf(HW).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TabError);
    expect((e as TabError).tab).toBe("Radios");
    expect((e as TabError).message).toBe("Port ต้องเป็นจำนวนเต็ม 1024–65535");
    expect(calls).toHaveLength(2);
    expect(body(calls[1])).toEqual({ radios: [RADIO], rotators: [] }); // the second dry run asks about the radios alone
  });

  it("names the Rotators tab when the radios are right and the whole is refused", async () => {
    const withRotator: HwConf = { radios: [RADIO], rotators: [{ name: "Rot" } as unknown as HwConf["rotators"][number]] };
    stubFetch((_url, init) => (JSON.parse(String(init?.body)).rotators.length === 0 ? json(HW) : refusal("Port ต้องเป็นจำนวนเต็ม 1024–65535")));
    const e = await checkHwconf(withRotator).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TabError);
    expect((e as TabError).tab).toBe("Rotators");
  });

  it("a failure that is not a refusal of the devices (the server is not there) is let through as it is", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("failed to fetch");
    });
    const e = await checkHwconf(HW).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("NETWORK_ERROR");
  });

  it("when the second dry run fails for another reason, the first failure is what is shown", async () => {
    let n = 0;
    stubFetch(() => (n++ === 0 ? refusal("Port ต้องเป็นจำนวนเต็ม 1024–65535") : new Response("", { status: 500 })));
    const e = await checkHwconf(HW).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("HWCONF_INVALID");
  });
});
