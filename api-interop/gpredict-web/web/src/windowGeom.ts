// Position of a floating window (FloatingWindow.tsx). Pure, in client px.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The top left corner nearest to `pos` that keeps the whole window inside the viewport (top left first if it is too big). */
export function clampToViewport(pos: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.max(0, Math.min(pos.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(pos.y, viewport.height - size.height)),
  };
}

/** Where a window opens when nobody said: centred across, a third of the way down (inside the viewport). */
export function centerIn(size: Size, viewport: Size): Point {
  return clampToViewport(
    { x: Math.round((viewport.width - size.width) / 2), y: Math.round((viewport.height - size.height) / 3) },
    size,
    viewport,
  );
}
