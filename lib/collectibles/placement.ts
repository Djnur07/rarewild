/**
 * Where the collectibles are. Pure data and maths (no Phaser), validated by
 * scripts/collectibles/validate-collectibles.ts.
 *
 * Twelve items across the six zones (2/2/2/2/3/1), each one placed for a reason (its `pattern`) and
 * teaching one thing, so the collectibles walk the player through the level instead of dotting it:
 *
 *   1 FOREST START   learn that pickups are part of the journey. No Hunter, no real jump.
 *      c01 GUIDE           ground, just ahead of Rara's start: walk into it
 *      c02 ARC             over the second stump: a jump you were going to make anyway collects it
 *   2 ROCKY AREA     combine moving, jumping and collecting; the first height.
 *      c03 ARC             over the log: comfortable, no precision
 *      c04 VERTICAL        high above the tall pillar that closes the zone: go up to get it
 *   3 HUNTER         collecting can raise the risk. One item on each side of the first Hunter.
 *      c05 RISK_REWARD     in front of the Hunter's beat, its cover (a tall stump) a hop behind you
 *      c06 GUIDE           past the Hunter, in the shadow of the ledge: calm, and it points at the deck
 *   4 DEEP FOREST    a deliberate sequence: c06 (ground) -> c07 (deck) -> c08 (stack), each higher and
 *                    each pointing at the next structure, with the second Hunter in between.
 *      c07 OBSTACLE_ROUTE  on the log deck (a climb of its height); you can scout the Hunter from up there
 *      c08 VERTICAL        above the stepped stack that hides you from that Hunter once past it
 *   5 DANGEROUS      the most demanding zone, with no unavoidable capture.
 *      c09 GUIDE           the accessible one: ground, sheltered behind the first stack
 *      c10 RISK_REWARD     the higher risk: just in front of the third Hunter's beat
 *      c11 OBSTACLE_ROUTE  in the gap of the two-pillar passage: hop pillar to pillar
 *   6 FINAL APPROACH the last stretch: a ground item past the last stack, with the exit gate in view
 *      c12 GUIDE
 *
 * Every Hunter has an item before and after its beat, and the Hunter-side ones (c05, c07, c08, c10) can
 * be taken from cover and left the same way: the validator drives the real Hunter AI and Rara's real jump
 * to prove it (scripts/collectibles/validate-collectibles.ts). Nothing sits inside a Hunter's patrol.
 */

import { COLLECTIBLE_RADIUS, PICKUP_FORGIVENESS } from "./config.ts";
import type { CollectiblePattern, CollectibleSpec } from "./types.ts";

const GROUND_LIFT = 30;
/** A "hop" item floats this far above the top of the obstacle it sits over. */
const HOP_CLEARANCE = 70;
/** A VERTICAL item floats higher above its obstacle, so it reads as "up there". */
const VERTICAL_CLEARANCE = 100;

const ground = (id: string, x: number, pattern: CollectiblePattern): CollectibleSpec => ({ id, tier: "ground", pattern, x, lift: GROUND_LIFT });
const over = (id: string, x: number, obstacleHeight: number, pattern: CollectiblePattern, clearance = HOP_CLEARANCE): CollectibleSpec => ({
  id, tier: "hop", pattern, x, lift: obstacleHeight + clearance,
});

export const FIRST_LEVEL_COLLECTIBLES: readonly CollectibleSpec[] = [
  // 1 FOREST START
  ground("c01", 500, "GUIDE"),
  over("c02", 1120, 64, "ARC"), // stump-1
  // 2 ROCKY AREA
  over("c03", 1770, 56, "ARC"), // log-1
  over("c04", 2600, 88, "VERTICAL", VERTICAL_CLEARANCE), // pillar-1
  // 3 HUNTER TERRITORY
  ground("c05", 2930, "RISK_REWARD"), // in front of Hunter 1's beat (3070-3430); stump-3 is its cover
  ground("c06", 3830, "GUIDE"), // past Hunter 1, behind ledge-1
  // 4 DEEP FOREST
  over("c07", 4060, 56, "OBSTACLE_ROUTE"), // deck-1
  over("c08", 5020, 96, "VERTICAL", VERTICAL_CLEARANCE), // stack-1
  // 5 DANGEROUS WILDS
  ground("c09", 5330, "GUIDE"), // behind stack-2
  ground("c10", 5550, "RISK_REWARD"), // in front of Hunter 3's beat (5650-6050), stack-2 is its cover
  over("c11", 6425, 76, "OBSTACLE_ROUTE"), // narrow-1
  // 6 FINAL APPROACH
  ground("c12", 7100, "GUIDE"),
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
