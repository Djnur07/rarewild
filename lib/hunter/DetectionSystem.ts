/**
 * Pure detection maths: what the Hunter can see. No Phaser, no state, no
 * randomness, so it is deterministic and easy to tune and test.
 *
 * Two ways of seeing:
 *   "cone"     the Hunter is unaware. Rara is seen when inside the box in FRONT
 *              of the Hunter (detectionRange ahead, +-detectionVerticalRange), or
 *              very close (awarenessRadius) from any side, and nothing blocks
 *              the line between them.
 *   "tracking" the Hunter is alert or chasing. Facing no longer matters and the
 *              box grows by chaseRangeMultiplier in every direction, so a Hunter
 *              already on Rara's trail keeps her in view.
 *
 * Line of sight: a straight line from the Hunter's centre to Rara's centre is
 * blocked by any rectangle in `blockers`. The scene supplies the static solids
 * (today only the ground slab, which never sits between two characters standing
 * on it), so LOS is fully implemented but nothing blocks it yet. Decorative
 * scenery (trees, roots, mist) deliberately does not block sight.
 */

import type { Facing, Rect, Vec2 } from "./types.ts";
import type { HunterConfig } from "./config.ts";

export type SightMode = "cone" | "tracking";

/** A target this far behind the Hunter's facing line is still "in front" (avoids flicker when level). */
const BEHIND_TOLERANCE = 12;

export function hasLineOfSight(from: Vec2, to: Vec2, blockers: readonly Rect[]): boolean {
  return !blockers.some((rect) => segmentIntersectsRect(from, to, rect));
}

/** Slab test: does the segment a-b touch the rectangle? */
export function segmentIntersectsRect(a: Vec2, b: Vec2, rect: Rect): boolean {
  let tMin = 0;
  let tMax = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, rect.left, rect.right],
    [a.y, b.y - a.y, rect.top, rect.bottom],
  ];
  for (const [start, delta, min, max] of axes) {
    if (delta === 0) {
      if (start < min || start > max) return false;
    } else {
      let t1 = (min - start) / delta;
      let t2 = (max - start) / delta;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

export function rectsOverlap(a: Rect, b: Rect, inset = 0): boolean {
  return a.left + inset < b.right && a.right - inset > b.left && a.top + inset < b.bottom && a.bottom - inset > b.top;
}

/** Can the Hunter, at `origin` looking `facing`, see `target`? Range limits are inclusive. */
export function detectTarget(
  origin: Vec2,
  facing: Facing,
  target: Vec2,
  config: Pick<HunterConfig, "detectionRange" | "detectionVerticalRange" | "awarenessRadius" | "chaseRangeMultiplier">,
  blockers: readonly Rect[],
  mode: SightMode,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const scale = mode === "tracking" ? config.chaseRangeMultiplier : 1;
  if (Math.abs(dx) > config.detectionRange * scale || Math.abs(dy) > config.detectionVerticalRange * scale) return false;

  if (mode === "cone") {
    const inFront = dx * facing >= -BEHIND_TOLERANCE;
    const veryClose = Math.hypot(dx, dy) <= config.awarenessRadius;
    if (!inFront && !veryClose) return false;
  }
  return hasLineOfSight(origin, target, blockers);
}
