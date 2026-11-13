import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingWindow } from "../components/FloatingWindow";
import type { Tick } from "../types";
import { prepareCanvas, useElementSize } from "../views/canvasHooks";
import { NoPassMessage } from "./NoPassMessage";
import { PassWait } from "./PassWait";
import { getSkyGlance, releaseSkyGlance } from "./passApi";
import { beginPlot, canvasPosition, fillText, strokeSegments, WHITE } from "./plotCommon";
import type { PassWindow } from "./passWindows";
import {
  hitPass,
  needsRedraw,
  NO_SATELLITES,
  skyCursor,
  skyLayout,
  skyPassBody,
  skyScene,
  skyTitle,
  SKY_WAITING_TEXT,
} from "./skyGlance";
import type { SkyBuild, SkyCursor, SkyHit, SkyScene } from "./skyGlance";
import { SkyGlanceFeed } from "./skyGlanceFeed";
import type { SkyView } from "./skyGlanceFeed";
import type { SkyGlanceAnswer } from "./types";
import { usePassRequest } from "./usePassRequest";

/**
 * (ของเรา) The times of the chart are UTC. "Show local time instead of UTC" is a setting of Preferences (sub-project 4); `skyScene`
 * has the local-time version ready, like the Az/El plot.
 */
const UTC = true;

/** Nothing asked yet: the window says that it is waiting for the first tick. */
const NOTHING_YET: SkyView = { answer: null, computing: false, error: null };

/**
 * Paints `scene` on `ctx` (whose canvas is round(width * dpr) x round(height * dpr)) in the order of Gpredict's on_draw (ref-P §7.5):
 * the white plot, the pass boxes (fill, then border), the satellite names, the cursor line and its time (`cursor`, null for none),
 * the dark footer, the hour ticks with their labels and the caption.
 */
export function drawSkyScene(ctx: CanvasRenderingContext2D, scene: SkyScene, dpr: number, cursor: SkyCursor | null): void {
  beginPlot(ctx, scene, dpr, WHITE); // the footer is painted over its part of this
  for (const b of scene.bars) {
    ctx.fillStyle = b.fill;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = b.border;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  for (const label of scene.labels) fillText(ctx, label);
  if (cursor !== null) {
    ctx.lineWidth = cursor.lineWidth;
    strokeSegments(ctx, [cursor.line], cursor.color);
    ctx.lineWidth = 1;
    fillText(ctx, cursor.label);
  }
  ctx.fillStyle = scene.footer.color;
  ctx.fillRect(0, scene.footer.y, scene.width, scene.footer.height);
  strokeSegments(ctx, scene.hours.flatMap((h) => [h.major, h.minor]), WHITE);
  for (const h of scene.hours) fillText(ctx, h.label);
  fillText(ctx, scene.caption);
}

interface ChartProps {
  view: SkyView;
  /** the number of satellites of the module: the chart opens with the size that fits them (and is not made smaller than that) */
  count: number;
  onRetry: () => void;
  /** a click on a pass box: its pass (satellite, AOS and LOS), and the `t0` of the chart it is in */
  onPass: (hit: SkyHit, t0: string) => void;
}

/**
 * The chart: the canvas of the newest drawing, or what stands in its place. The size of the window is that of the canvas: the
 * window opens with `skyLayout` and can be made bigger by its corner, as Gpredict's can (ref-P §7.3); the chart is drawn again for
 * the new size. The line under the pointer stays where the pointer left the canvas (there is no leave handler in Gpredict) and goes
 * when the chart is built again, as the whole widget does in Gpredict (ref-P §7.5, §7.7).
 */
function SkyChart({ view, count, onRetry, onPass }: ChartProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(holder);
  const layout = skyLayout(count);
  const answer = view.answer;
  const [pointer, setPointer] = useState<{ x: number; answer: SkyGlanceAnswer } | null>(null);

  const scene = useMemo(
    () => (answer === null || size.w === 0 || size.h === 0 ? null : skyScene(answer, { width: size.w, height: size.h }, UTC)),
    [answer, size.w, size.h],
  );
  const cursor = useMemo(() => (scene === null || pointer === null || pointer.answer !== answer ? null : skyCursor(scene, pointer.x)), [scene, pointer, answer]);

  useEffect(() => {
    const target = prepareCanvas(canvas.current, size);
    if (target !== null && scene !== null && scene.message === null) drawSkyScene(target.ctx, scene, target.dpr, cursor);
  }, [size, scene, cursor]);

  const retry = (
    <button type="button" className="button" onClick={onRetry}>
      Retry
    </button>
  );
  let body;
  if (answer === null) {
    // before the first drawing: waiting for GMAT, or why it did not come (ของเรา)
    body = (
      <div className="sky-status">
        {view.error === null ? (
          <p role="status">{SKY_WAITING_TEXT}</p>
        ) : (
          <>
            <p className="dialog-error" role="alert">
              {view.error}
            </p>
            {retry}
          </>
        )}
      </div>
    );
  } else if (scene?.message != null) {
    body = <p className="sky-empty">{scene.message}</p>;
  } else {
    body = (
      <canvas
        ref={canvas}
        role="img"
        aria-label="The sky at a glance"
        style={{ display: "block", width: size.w, height: size.h }}
        onMouseMove={(e) => setPointer({ x: canvasPosition(e.currentTarget, e).x, answer })}
        onMouseUp={(e) => {
          if (e.button !== 0 || scene === null) return; // Gpredict acts on the release of the left button; nothing else does anything
          const { x, y } = canvasPosition(e.currentTarget, e);
          const hit = hitPass(scene, x, y);
          if (hit !== null) onPass(hit, answer.t0);
        }}
      />
    );
  }

  return (
    <div>
      <div
        ref={holder}
        className="sky-holder"
        style={{ width: layout.width, height: layout.height, minWidth: layout.width, minHeight: layout.height }}
      >
        {body}
      </div>
      {answer !== null && view.error !== null && (
        // (ของเรา) a drawing after the first one failed: the old chart stays, and this says why
        <div className="sky-error">
          <p className="dialog-error" role="alert">
            {view.error}
          </p>
          {retry}
        </div>
      )}
    </div>
  );
}

interface Props {
  module: string;
  /** the NORAD numbers of the satellites of the module (its configuration) */
  satellites: readonly number[];
  /** newest tick of the module, null before the first one: the chart is built from its time and checked against every one after it */
  tick: Tick | null;
  /** changes when the Module menu item is chosen again: the window comes to the front */
  raiseToken: number;
  /** a click on a pass box opens its Pass details through the page (the same request and waiting box as the satellite popups) */
  onOpenPassWindow: (w: PassWindow) => void;
  onClose: () => void;
}

/**
 * "The sky at a glance (<module>)" (ref-P §7, spec §7): one window per module that shows when the module's passes are within the
 * next hours, a bar for each pass in the row of its satellite. Not modal. It belongs to the module whose tab is shown (the ticks it
 * follows are that tab's): it goes when another tab is shown, and the page opens it again with a fresh chart.
 *
 * - The first chart is built from the module time of the first tick (`t` of the first request, skyGlanceFeed.ts). The window says
 *   `SKY_WAITING_TEXT` until GMAT has it, then the chart. After that every tick is checked with `needsRedraw` against the time and
 *   place of the last build; when it says so the chart is built again from the module time, and the old one stays until the new one
 *   is there.
 * - A left click on a bar opens Pass details for that pass (`kind: "at"` with its AOS and LOS, no parent window). If the
 *   answer is late the waiting box shows, as for the satellite popups' pass items.
 * - A module with no satellites is the text `NO_SATELLITES` and no request. Closing the window releases what the server holds for it.
 */
export function SkyGlanceWindow({ module, satellites, tick, raiseToken, onOpenPassWindow, onClose }: Props) {
  const count = satellites.length;
  const satKey = satellites.join(",");
  const [view, setView] = useState<SkyView>(NOTHING_YET);
  const feed = useRef<SkyGlanceFeed | null>(null);
  const built = useRef<SkyBuild | null>(null);
  const pass = usePassRequest(module, onOpenPassWindow);
  const { start: startPass } = pass;

  // the conversation with the server lasts as long as the window and the satellites it was made for
  useEffect(() => {
    if (count === 0) return; // Gpredict only has the label then
    const f = new SkyGlanceFeed({ get: (t) => getSkyGlance(module, t), release: () => releaseSkyGlance(module) }, setView);
    feed.current = f;
    built.current = null;
    return () => {
      f.stop();
      feed.current = null;
    };
  }, [module, satKey, count]);

  // the first tick starts the first drawing; every tick after it may ask for a new one
  useEffect(() => {
    const f = feed.current;
    if (f === null || tick === null) return;
    const next: SkyBuild = { t: new Date(tick.t), lat: tick.qth.lat_deg, lon: tick.qth.lon_deg };
    if (built.current === null) {
      built.current = next;
      f.first(tick.t);
    } else if (needsRedraw(built.current, next)) {
      built.current = next;
      f.rebuild();
    }
  }, [tick, module, satKey, count]);

  const openPass = (hit: SkyHit, t0: string) => startPass(skyPassBody(hit, t0));

  return (
    <>
      <FloatingWindow title={skyTitle(module)} onClose={onClose} raiseToken={raiseToken}>
        {count === 0 ? (
          <p className="sky-empty">{NO_SATELLITES}</p>
        ) : (
          <SkyChart view={view} count={count} onRetry={() => feed.current?.retry()} onPass={openPass} />
        )}
      </FloatingWindow>
      {pass.box?.box === "wait" && <PassWait state={pass.box.state} onCancel={pass.cancel} onRetry={pass.retry} />}
      {pass.box?.box === "message" && <NoPassMessage message={pass.box.message} onOk={pass.ok} />}
    </>
  );
}
