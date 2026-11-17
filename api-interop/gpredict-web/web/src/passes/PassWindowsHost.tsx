import { memo } from "react";
import { PassDetails } from "./PassDetails";
import { cascadePosition } from "./passWindows";
import type { PassWindow } from "./passWindows";
import { UpcomingPasses } from "./UpcomingPasses";

interface Props {
  windows: readonly PassWindow[];
  /** opens a window: the one the page opens, and the Pass details windows that an Upcoming passes window opens */
  onOpen: (w: PassWindow) => void;
  /** closes window `id` and the Pass details windows opened from it */
  onClose: (id: string) => void;
}

/** The floating windows of the pass windows that are open (Pass details, Upcoming passes). Only re-rendered when one of its props changes, not on every tick. */
export const PassWindows = memo(function PassWindows({ windows, onOpen, onClose }: Props) {
  return (
    <>
      {windows.map((w, i) => {
        const position = cascadePosition(i);
        const close = () => onClose(w.id);
        return w.kind === "details" ? (
          <PassDetails key={w.id} answer={w.answer} onClose={close} position={position} />
        ) : (
          <UpcomingPasses key={w.id} id={w.id} answer={w.answer} onOpen={onOpen} onClose={close} position={position} />
        );
      })}
    </>
  );
});
