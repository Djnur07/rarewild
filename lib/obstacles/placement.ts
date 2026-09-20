/**
 * Where the obstacles are, and the rules a layout must obey to stay playable.
 * Pure data and maths (no Phaser), so the rules are enforced by
 * scripts/obstacles/validate-obstacles.ts.
 *
 * The first version is a small hand-placed set, not random spawning:
 *   rock-1   in the stream area, the first thing to hop over
 *   stump-1  between the stream and the Hunter's patrol
 *   log-1    beyond the Hunter, a wide low pile
 *   rock-2   near the far end
 * Every obstacle is at least 56px tall, which is tall enough to break the
 * Hunter's line of sight to Rara standing right behind it (it hides her, and
 * a low obstacle that blocked the Hunter's walk but not its sight would let
 * Rara stand safely behind it), and at most 72px, well within a jump (about
 * 134px) so any of them can be hopped or stood on.
 */

import type { Rect } from "../level/geometry.ts";
import type { ObstacleSpec } from "./types.ts";

export const FIRST_LEVEL_OBSTACLES: readonly ObstacleSpec[] = [
  { id: "rock-1", kind: "rock", x: 770, width: 60, height: 56 },
  { id: "stump-1", kind: "stump", x: 1050, width: 48, height: 64 },
  { id: "log-1", kind: "log", x: 1930, width: 88, height: 56 },
  { id: "rock-2", kind: "rock", x: 2210, width: 64, height: 60 },
];

export const OBSTACLE_RULES = {
  minHeight: 56,
  maxHeight: 72,
  minWidth: 40,
  maxWidth: 96,
  /**
   * Empty ground between two obstacles (edge to edge), so Rara has room to land and take off. A full-speed
   * jump travels ~360px, so a gap this size lets a running jump over one obstacle land before the next.
   */
  minEdgeGap: 200,
  /** Nothing closer than this to Rara's start (centre to centre), px. */
  minDistanceFromStart: 250,
  /** Nothing within this of an existing pickup or hazard, px. */
  clearanceFromPickups: 90,
  /** Nothing within this of the Hunter's patrol route, px (keeps the route walkable and the ends unblocked). */
  clearanceFromPatrol: 200,
} as const;

/** The box an obstacle occupies when standing on the ground. */
export function obstacleRect(spec: ObstacleSpec, groundSurfaceY: number): Rect {
  return {
    left: spec.x - spec.width / 2,
    right: spec.x + spec.width / 2,
    top: groundSurfaceY - spec.height,
    bottom: groundSurfaceY,
  };
}

export interface LayoutContext {
  bounds: { minX: number; maxX: number };
  playerStartX: number;
  /** Existing pickups/hazards to stay away from (centre x). */
  keepClearOf: { label: string; x: number }[];
  /** The Hunter's patrol route from left to right end, centre x. */
  patrol: { left: number; right: number };
}

/** Every rule the layout breaks, in plain words (empty = playable). */
export function validateObstacleLayout(specs: readonly ObstacleSpec[], ctx: LayoutContext): string[] {
  const rules = OBSTACLE_RULES;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const s of specs) {
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`);
    ids.add(s.id);
    if (s.height < rules.minHeight || s.height > rules.maxHeight) problems.push(`${s.id}: height ${s.height} outside ${rules.minHeight}-${rules.maxHeight}`);
    if (s.width < rules.minWidth || s.width > rules.maxWidth) problems.push(`${s.id}: width ${s.width} outside ${rules.minWidth}-${rules.maxWidth}`);
    const left = s.x - s.width / 2;
    const right = s.x + s.width / 2;
    if (left < ctx.bounds.minX || right > ctx.bounds.maxX) problems.push(`${s.id}: outside the playable world`);
    if (Math.abs(s.x - ctx.playerStartX) < rules.minDistanceFromStart) problems.push(`${s.id}: too close to Rara's start`);
    for (const k of ctx.keepClearOf) {
      if (Math.abs(s.x - k.x) < rules.clearanceFromPickups) problems.push(`${s.id}: too close to the ${k.label}`);
    }
    if (right > ctx.patrol.left - rules.clearanceFromPatrol && left < ctx.patrol.right + rules.clearanceFromPatrol) {
      problems.push(`${s.id}: too close to the Hunter's patrol route`);
    }
  }
  const sorted = [...specs].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - sorted[i].width / 2 - (sorted[i - 1].x + sorted[i - 1].width / 2);
    if (gap < rules.minEdgeGap) problems.push(`${sorted[i - 1].id} and ${sorted[i].id}: only ${gap}px apart (need ${rules.minEdgeGap})`);
  }
  return problems;
}

/** True when a ground position is at least `margin` px away from every obstacle's edges. */
export function isClearOfObstacles(x: number, margin: number, specs: readonly ObstacleSpec[]): boolean {
  return specs.every((s) => x < s.x - s.width / 2 - margin || x > s.x + s.width / 2 + margin);
}
