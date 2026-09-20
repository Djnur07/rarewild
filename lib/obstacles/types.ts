/** Placeholder art variants; gameplay never depends on the kind, only on the pieces' boxes. */
export type ObstacleKind = "rock" | "stump" | "log";

/**
 * What an obstacle asks of the player. Data-driven: a level designer picks the type and the
 * dimensions in the placement data (see the factories in shapes.ts); the rules for what each
 * type may look like live in placement.ts.
 *
 *   LOW       a short block, an easy hop
 *   HIGH      a taller block: needs a proper jump, with a comfortable timing window
 *   PLATFORM  a wide block whose top is a surface to land on and walk across
 *   STACKED   tiers stacked into steps (a pyramid): jump over it, or climb it tier by tier
 *   NARROW    two pillars with a tight gap: hop from pillar to pillar, or clear both
 */
export const OBSTACLE_TYPES = ["LOW", "HIGH", "PLATFORM", "STACKED", "NARROW"] as const;
export type ObstacleType = (typeof OBSTACLE_TYPES)[number];

/**
 * One solid box of an obstacle. `x` is its horizontal centre; `base` is how far above the ground
 * surface its bottom edge is (0 = standing on the ground, more = resting on the tier below).
 * Every piece becomes one static physics body, so Rara and the Hunters collide with it and the
 * Hunter's line of sight is blocked by it, exactly like the original single-box obstacles.
 */
export interface ObstaclePiece {
  x: number;
  width: number;
  height: number;
  base: number;
}

/**
 * One obstacle. `x`, `width` and `height` describe its overall FOOTPRINT (centre, full width and the
 * top of its tallest piece), so anything that only needs "where is it and how big" keeps working;
 * `pieces` are the actual solid boxes. The factories in shapes.ts keep the two consistent.
 */
export interface ObstacleSpec {
  id: string;
  type: ObstacleType;
  kind: ObstacleKind;
  x: number;
  width: number;
  height: number;
  pieces: readonly ObstaclePiece[];
}
