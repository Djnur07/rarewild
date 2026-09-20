/**
 * Where the Hunters are. Same Hunter class, AI and tuning everywhere; each
 * placement only says where the patrol is centred and (optionally) how far it
 * walks. Kept in zones 3-5 with wide gaps between them, so the player meets one
 * Hunter at a time and has room to escape and recover before the next.
 *
 * Pure data (no Phaser); the rules that keep the layout fair are enforced by
 * scripts/level/validate-level.ts.
 */

import type { HunterConfig } from "./config.ts";

export interface HunterPlacement {
  id: string;
  /** The zone it belongs to (a ZoneId from lib/level/zones.ts; kept as a string so this module stays independent). */
  zone: string;
  /** Centre of the patrol route, world px. */
  x: number;
  /** How far the patrol extends each way from `x`; defaults to the Hunter config's own patrolRadius. */
  patrolRadius?: number;
}

export const FIRST_LEVEL_HUNTERS: readonly HunterPlacement[] = [
  { id: "hunter-1", zone: "HUNTER", x: 3250, patrolRadius: 180 },
  { id: "hunter-2", zone: "DEEP_FOREST", x: 4550, patrolRadius: 150 },
  { id: "hunter-3", zone: "DANGEROUS", x: 5850, patrolRadius: 200 },
];

/** The Hunter config for one placement: the shared tuning with that placement's patrol length. */
export function configForPlacement(base: HunterConfig, placement: HunterPlacement): HunterConfig {
  return placement.patrolRadius === undefined ? base : { ...base, patrolRadius: placement.patrolRadius };
}

export const HUNTER_RULES = {
  /** Hunter spawn points are at least this far apart (centre to centre), px. */
  minSpacing: 1200,
  /** No Hunter closer than this to Rara's start, px. */
  minDistanceFromStart: 1500,
} as const;

/** The horizontal span a Hunter patrols. */
export function patrolSpan(placement: HunterPlacement, base: HunterConfig): { left: number; right: number } {
  const radius = placement.patrolRadius ?? base.patrolRadius;
  return { left: placement.x - radius, right: placement.x + radius };
}
