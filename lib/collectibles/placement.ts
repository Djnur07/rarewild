/**
 * Where the collectibles are. Pure data and maths (no Phaser), validated by
 * scripts/collectibles/validate-collectibles.ts.
 *
 * Layout (world x), left to right:
 *   250 500            start area: two easy ground items, the nearer in plain view
 *   770 (hop)          above rock-1: hop the first obstacle
 *   910                ground, between the rock and the stump
 *   1050 (hop)         above stump-1
 *   1200               ground, in the Hunter's line of sight (a small risk)
 *   1500 (high)        above the Hunter's patrol (a rewarding risk)
 *   1780               ground, just past the Hunter's patrol
 *   1930 (hop)         above log-1
 *   2065               ground
 *   2210 (high)        above rock-2, best reached from the rock's top
 *   2300               ground, near the end
 * Ten of the twelve are easy; only the two "high" ones need a good jump.
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
  ground("c01", 250),
  ground("c02", 500),
  hop("c03", 770, 56),
  ground("c04", 910),
  hop("c05", 1050, 64),
  ground("c06", 1200),
  high("c07", 1500),
  ground("c08", 1780),
  hop("c09", 1930, 56),
  ground("c10", 2065),
  high("c11", 2210),
  ground("c12", 2300),
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
