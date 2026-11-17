import { memo, useCallback, useEffect, useState } from "react";
import { useGlobalPolar } from "../prefs/globalPolar";
import type { Tick } from "../types";
import { useModuleSocket } from "../useModuleSocket";
import { controllerOf, refKey, rotPlotOf, WATCH_START, watchTick, windowGone } from "./controllerWindows";
import type { ControllerWindow, Watch } from "./controllerWindows";
import { controllerAction } from "./radioApi";
import { RadioControl } from "./RadioControl";
import { RotatorControl } from "./RotatorControl";
import type { ControllerRef } from "./types";

interface Props {
  /** the windows that are open (App's list: GET /api/controllers and the opens and closes of this page) */
  refs: readonly ControllerWindow[];
  /** the user closed a window: the caller closes its controller on the server and takes the window out of the list */
  onClosed: (ref: ControllerRef) => void;
  /** a window went by itself: its controller was closed elsewhere (another browser tab), or its module was closed or deleted */
  onGone: (ref: ControllerRef) => void;
}

interface WindowProps {
  win: ControllerWindow;
  onClosed: (ref: ControllerRef) => void;
  onGone: (ref: ControllerRef) => void;
}

/**
 * The Radio Control and Antenna Control windows of every module, whichever tab is shown (decision 2 of the plan): each window has its
 * own WebSocket of its module, whose ticks carry the state of its controller (`radio`, `rotator`). A window shows once a tick carries
 * its controller, and goes (`onGone`) when the ticks no longer do or the socket is closed for good (controllerWindows.ts).
 */
export const ControllerWindows = memo(function ControllerWindows({ refs, onClosed, onGone }: Props) {
  return (
    <>
      {refs.map((w) =>
        w.kind === "radio" ? (
          <RadioWindow key={refKey(w)} win={w} onClosed={onClosed} onGone={onGone} />
        ) : (
          <RotatorWindow key={refKey(w)} win={w} onClosed={onClosed} onGone={onGone} />
        ),
      )}
    </>
  );
});

/** The ticks of the window's own socket, and whether the window has gone (then `onGone` is called once). */
function useWindowTicks({ win, onGone }: Pick<WindowProps, "win" | "onGone">): { tick: Tick | null; gone: boolean } {
  const { module, kind } = win;
  const { tick, closeCode } = useModuleSocket(module);
  const [watched, setWatched] = useState<{ tick: Tick | null; watch: Watch }>({ tick: null, watch: WATCH_START });
  let watch = watched.watch;
  if (tick !== null && tick !== watched.tick) {
    watch = watchTick(watched.watch, controllerOf(tick, kind) !== undefined);
    setWatched({ tick, watch }); // derived from the tick during the render, not an effect
  }
  const gone = windowGone(watch, closeCode);
  useEffect(() => {
    if (gone) onGone({ module, kind });
  }, [gone, module, kind, onGone]);
  return { tick, gone };
}

function RadioWindow({ win, onClosed, onGone }: WindowProps) {
  const { tick, gone } = useWindowTicks({ win, onGone });
  const { module } = win;
  const onAction = useCallback((body: Record<string, unknown>) => controllerAction(module, "radio", body), [module]);
  const close = useCallback(() => onClosed({ module, kind: "radio" }), [module, onClosed]);
  const state = controllerOf(tick, "radio");
  if (gone || state === undefined) return null;
  return <RadioControl module={module} state={state} onAction={onAction} onClose={close} raiseToken={win.raise} />;
}

function RotatorWindow({ win, onClosed, onGone }: WindowProps) {
  const { tick, gone } = useWindowTicks({ win, onGone });
  const { module } = win;
  const polar = useGlobalPolar(); // the plot follows Preferences → Modules → Polar View, not the module (plan decision 15)
  const onAction = useCallback((body: Record<string, unknown>) => controllerAction(module, "rotator", body), [module]);
  const close = useCallback(() => onClosed({ module, kind: "rotator" }), [module, onClosed]);
  const state = controllerOf(tick, "rotator");
  if (gone || state === undefined) return null;
  const plot = rotPlotOf(polar, tick?.qth.name ?? null);
  return (
    <RotatorControl
      module={module}
      state={state}
      orientation={plot.orientation}
      qthName={plot.qthName}
      onAction={onAction}
      onClose={close}
      raiseToken={win.raise}
    />
  );
}
