import { useRef, useState } from "react";
import { errorText } from "../api";
import { answerRequest, beginEdits, finishEdits, NO_REQUESTS, sendRequest } from "./radioView";
import type { Edits } from "./radioView";

/** A number the user made with an action: the window shows it until the last request for it is answered. */
export interface Edited<K extends string> {
  key: K;
  value: number;
}

export interface ControllerState<S, K extends string> {
  /** what the window shows: the newest tick, or the answer to an action if that came later */
  shown: S;
  /** the numbers made by the user whose requests have no answer yet, by name (`editedValue` picks the one to show) */
  edits: Edits<K>;
  /** (ของเรา) why the last action failed, in the server's Thai text; null after the next action */
  problem: string | null;
  /** one action; `edit` is the number the user made with it */
  send: (body: Record<string, unknown>, edit?: Edited<K>) => Promise<void>;
  /** one action that makes no number */
  act: (body: Record<string, unknown>) => void;
}

/**
 * What Radio Control and Antenna Control share (they are the view of a controller's state and decide nothing): the state they show,
 * which is `state` (the controller of the module's tick) until an answer to an action replaces it, and the actions they send with `onAction`.
 *
 * - A new `state` (a tick) is shown at once.
 * - An answer that comes after the answer to a newer request is dropped (two requests can come back in the other order).
 * - A number the user made (`edit`) is kept in `edits` until the last of its requests is answered, whatever a tick says in the meantime,
 *   so that rapid steps of a knob accumulate instead of each starting from the number of the last tick.
 */
export function useControllerState<S, K extends string>(
  state: S,
  onAction: (body: Record<string, unknown>) => Promise<S>,
): ControllerState<S, K> {
  const [seen, setSeen] = useState(state);
  const [shown, setShown] = useState(state);
  const [edits, setEdits] = useState<Edits<K>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const order = useRef(NO_REQUESTS);

  if (seen !== state) {
    setSeen(state);
    setShown(state);
  }

  const send = async (body: Record<string, unknown>, edit?: Edited<K>) => {
    const request = sendRequest(order.current);
    order.current = request.order;
    setProblem(null);
    if (edit !== undefined) setEdits((e) => beginEdits(e, edit.key, edit.value));
    try {
      const next = await onAction(body);
      const answer = answerRequest(order.current, request.n);
      order.current = answer.order;
      if (answer.show) setShown(next);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      if (edit !== undefined) setEdits((e) => finishEdits(e, edit.key));
    }
  };
  const act = (body: Record<string, unknown>) => void send(body);

  return { shown, edits, problem, send, act };
}
