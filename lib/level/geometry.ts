/** Small pure geometry helpers for the level systems. World px, y grows downward. */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Does the circle (centre cx,cy, radius r) touch the rectangle? */
export function circleIntersectsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nearestX = Math.min(Math.max(cx, rect.left), rect.right);
  const nearestY = Math.min(Math.max(cy, rect.top), rect.bottom);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy <= r * r;
}

export function rectsOverlapArea(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
