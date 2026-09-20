/**
 * Where the collectibles are. Pure data and maths (no Phaser), validated by
 * scripts/collectibles/validate-collectibles.ts.
 *
 * The same twelve items, now spread across the whole journey (2/2/2/2/3/1):
 *
 *   FOREST START    c01 ground near the start; c02 hops the first rock
 *   ROCKY AREA      c03 hops the first log; c04 ground in the gap between stump and rock
 *   HUNTER          c05 ground on the approach (grab it and back off); c06 high over the Hunter's beat
 *   DEEP FOREST     c07 hops onto the log deck; c08 ground in the recovery stretch after the stack
 *   DANGEROUS       c09 hops the stacked steps; c10 high over the third Hunter's beat; c11 hops the
 *                   two-pillar passage after it
 *   FINAL APPROACH  c12 ground on the last stretch, an anticipation reward before the empty exit area
 *
 * Ten of the twelve are easy; only the two "high" ones need a good jump, and both
 * of those are optional risks near a Hunter that can be taken from a safe angle.
 */

import { COLLECTIBLE_RADIUS, PICKUP_FORGIVENESS } from "./config.ts";
import type { CollectibleSpec } from "./types.ts";

const GROUND_LIFT = 30;
const HIGH_LIFT = 205;
/** A "hop" item floats this far above the top of the obstacle it sits over. */
const HOP_CLEARANCE = 70;

const ground = (id: string, x: number): CollectibleSpec => ({ id, tier: "ground", x, lift: GROUND_LIFT });
const hop = (id: string, x: number, obstacleHeight: number): CollectibleSpec => ({ id, tier: "hop", x, lift: obstacleHeight + HOP_CLEARANCE });
const high = (id: string, x: number): CollectibleSpec => ({ id, tier: "high", x, lift: HIGH_LIFT });

export const FIRST_LEVEL_COLLECTIBLES: readonly CollectibleSpec[] = [
  // FOREST START
  ground("c01", 500),
  hop("c02", 770, 56),
  // ROCKY AREA
  hop("c03", 1770, 56),
  ground("c04", 2180),
  // HUNTER TERRITORY
  ground("c05", 2990),
  high("c06", 3250),
  // DEEP FOREST
  hop("c07", 4030, 56),
  ground("c08", 5230),
  // DANGEROUS WILDS
  hop("c09", 5450, 96),
  high("c10", 5850),
  hop("c11", 6425, 76),
  // FINAL APPROACH
  ground("c12", 7000),
];

/** Where an item's centre is, given the ground surface. */
export function collectibleCenter(spec: CollectibleSpec, groundSurfaceY: number): { x: number; y: number } {
  return { x: spec.x, y: groundSurfaceY - spec.lift };
}

/**
 * The smallest jump height (px above the ground) at which Rara's body reaches the item.
 * 0 = she collects it just by walking into it.
 */
export function requiredJumpHeight(lift: number, bodyHeight: number): number {
  return Math.max(0, lift - COLLECTIBLE_RADIUS - PICKUP_FORGIVENESS - bodyHeight);
}
