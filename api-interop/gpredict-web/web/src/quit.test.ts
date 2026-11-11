import { afterEach, describe, expect, it, vi } from "vitest";
import { quit } from "./api";
import { runQuit } from "./quit";

afterEach(() => vi.unstubAllGlobals());

const QUIT_UNAVAILABLE = {
  code: "QUIT_UNAVAILABLE",
  level: "error",
  text: "server นี้ไม่ได้รันด้วย python -m gpredict_web จึงปิดจากหน้าเว็บไม่ได้",
  object: null,
};

function run(respond: () => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return respond();
  });
  const stopped = vi.fn();
  const failed = vi.fn();
  return { calls, stopped, failed, done: runQuit(quit, stopped, failed) };
}

describe("runQuit (File → Quit)", () => {
  it("shows the stopped page after 204", async () => {
    const r = run(() => new Response(null, { status: 204 }));
    await r.done;
    expect(r.calls).toEqual(["POST /api/quit"]);
    expect(r.stopped).toHaveBeenCalledTimes(1);
    expect(r.failed).not.toHaveBeenCalled();
  });

  it("shows the server's Thai text, not the stopped page, after 409 QUIT_UNAVAILABLE", async () => {
    const r = run(() => new Response(JSON.stringify(QUIT_UNAVAILABLE), { status: 409, headers: { "Content-Type": "application/json" } }));
    await r.done;
    expect(r.stopped).not.toHaveBeenCalled();
    expect(r.failed).toHaveBeenCalledExactlyOnceWith(QUIT_UNAVAILABLE.text);
  });

  it("shows the error and not the stopped page when the server cannot be reached or refuses (403 FORBIDDEN_ORIGIN)", async () => {
    const down = run(() => Promise.reject(new TypeError("fetch failed")));
    await down.done;
    expect(down.stopped).not.toHaveBeenCalled();
    expect(down.failed).toHaveBeenCalledTimes(1);
    expect(down.failed.mock.calls[0]![0]).toMatch(/ติดต่อ server ไม่ได้/);

    const refused = run(
      () => new Response(JSON.stringify({ code: "FORBIDDEN_ORIGIN", level: "error", text: "ไม่รับคำสั่งจากหน้าเว็บอื่น", object: null }), { status: 403 }),
    );
    await refused.done;
    expect(refused.stopped).not.toHaveBeenCalled();
    expect(refused.failed).toHaveBeenCalledExactlyOnceWith("ไม่รับคำสั่งจากหน้าเว็บอื่น");
  });
});
