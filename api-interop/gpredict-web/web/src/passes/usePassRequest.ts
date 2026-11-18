import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiMessage } from "../types";
import { outcomeOf, runPassRequest } from "./passRequest";
import type { PassWindow } from "./passWindows";
import type { PassBody } from "./types";

/** The box a pass request has up: the waiting box (waiting, or failed with the Thai text), or the message of a satellite with no pass. */
export type PassBox = { box: "wait"; state: "waiting" | { error: string } } | { box: "message"; message: ApiMessage };

/**
 * The pass request of the satellite popups of a module (Show current pass, Show next pass, Future passes) and the boxes it shows.
 * `start` sends a request: the answer opens a pass window through `openWindow`, or shows the no-pass message; if it is late the
 * waiting box shows (passRequest.ts); a failure shows in that box with Retry. One request at a time: a new one cancels the one
 * before. It lives here, not in the popup, because the popup is gone as soon as an item is chosen. The request is cancelled when the
 * page that holds it goes away (the module is closed or another tab is shown), so the server drops its GMAT job.
 */
export function usePassRequest(module: string, openWindow: (w: PassWindow) => void) {
  const [box, setBox] = useState<PassBox | null>(null);
  const running = useRef<{ cancel(): void } | null>(null);
  const last = useRef<PassBody | null>(null);
  const open = useRef(openWindow);
  open.current = openWindow;

  const start = useCallback(
    (body: PassBody) => {
      running.current?.cancel();
      last.current = body;
      running.current = runPassRequest(module, body, {
        onWaiting: () => setBox({ box: "wait", state: "waiting" }),
        onDone: (answer) => {
          running.current = null;
          const outcome = outcomeOf(answer);
          if (outcome.kind === "window") {
            setBox(null);
            open.current(outcome.window);
          } else {
            setBox({ box: "message", message: outcome.message });
          }
        },
        onError: (text) => {
          running.current = null;
          setBox({ box: "wait", state: { error: text } });
        },
      });
    },
    [module],
  );

  /** Cancel of the waiting box (and Escape): nothing is shown, whatever the server answers */
  const cancel = useCallback(() => {
    running.current?.cancel();
    running.current = null;
    setBox(null);
  }, []);

  /** Retry of the waiting box: the same request again, and the box is back to waiting at once */
  const retry = useCallback(() => {
    const body = last.current;
    if (body === null) return;
    setBox({ box: "wait", state: "waiting" });
    start(body);
  }, [start]);

  /** OK of the no-pass message */
  const ok = useCallback(() => setBox(null), []);

  useEffect(
    () => () => {
      running.current?.cancel();
    },
    [],
  );

  return { box, start, cancel, retry, ok };
}
