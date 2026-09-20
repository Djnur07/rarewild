/**
 * The level's structure: six zones from START (left) to the eventual END
 * (right), each with its own purpose, spacing rules and visual character.
 * Everything positional about the journey lives here or in the layout files
 * that read it (lib/obstacles, lib/collectibles, lib/hunter placement), not in
 * Game.tsx.
 *
 *   1 FOREST START      safe introduction; few obstacles, easy collectibles, no Hunter
 *   2 ROCKY AREA        the jumping zone: the most obstacles in a row, still no Hunter
 *   3 HUNTER TERRITORY  first Hunter; room to escape, obstacles to hide behind
 *   4 DEEP FOREST       thicker scenery, longer stretches, a second Hunter
 *   5 DANGEROUS WILDS   obstacle gauntlets close behind a Hunter; the tightest spacing
 *   6 FINAL APPROACH    clutter thins out; the last stretch is reserved for a future EXIT
 *
 * `EXIT_RESERVE` marks the ground at the far end kept clear of obstacles, collectibles
 * and Hunters. The exit gate stands in it (see lib/objective) and completing the level
 * requires all of the collectibles first.
 *
 * All zones use the same environment assets; `visual` only changes density,
 * variant mix and a soft colour grade, so it reads as one continuous rainforest.
 */

import type { EnvironmentZone, WaterSegment, ZoneVisual } from "../environment/types.ts";
import type { ObstacleType } from "../obstacles/types.ts";
import { WORLD_WIDTH } from "./constants.ts";

export type ZoneId = "START" | "ROCKY" | "HUNTER" | "DEEP_FOREST" | "DANGEROUS" | "FINAL";

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** World x range [start, end). The last zone runs to the end of the world. */
  start: number;
  end: number;
  /** Obstacles in this zone are at least this far apart edge to edge (tighter = harder), px. */
  minObstacleGap: number;
  /**
   * Which obstacle types this zone may use, and which it must (its "lesson"). The journey introduces the
   * types in order: LOW, then HIGH, then PLATFORM, then STACKED, then NARROW.
   */
  obstacleTypes: { allowed: readonly ObstacleType[]; required: readonly ObstacleType[] };
  visual: ZoneVisual;
}

const visual = (v: ZoneVisual): ZoneVisual => v;

export const ZONE_START: ZoneDef = {
  id: "START",
  name: "Forest Start",
  start: 0,
  end: 1300,
  minObstacleGap: 250,
  obstacleTypes: { allowed: ["LOW"], required: ["LOW"] },
  visual: visual({
    treeSpacing: 500, treeMix: { small: 1, medium: 2, large: 1 },
    rootSpacing: 620, rootMix: { small: 1, medium: 2, large: 0 },
    foliageSpacing: 360, foliageMix: { small: 1, medium: 2, large: 1 }, hangingChance: 0.12,
    silhouetteSpacing: 420,
    wash: { color: 0x2f7a4a, alpha: 0.04 },
  }),
};

export const ZONE_ROCKY: ZoneDef = {
  id: "ROCKY",
  name: "Rocky Area",
  start: 1300,
  end: 2700,
  minObstacleGap: 200,
  obstacleTypes: { allowed: ["LOW", "HIGH"], required: ["LOW", "HIGH"] },
  visual: visual({
    treeSpacing: 760, treeMix: { small: 2, medium: 1, large: 0 },
    rootSpacing: 360, rootMix: { small: 1, medium: 2, large: 2 },
    foliageSpacing: 560, foliageMix: { small: 2, medium: 1, large: 0 }, hangingChance: 0.05,
    silhouetteSpacing: 520,
    wash: { color: 0x5d6b6d, alpha: 0.12 },
  }),
};

export const ZONE_HUNTER: ZoneDef = {
  id: "HUNTER",
  name: "Hunter Territory",
  start: 2700,
  end: 4000,
  minObstacleGap: 200,
  obstacleTypes: { allowed: ["HIGH", "PLATFORM"], required: ["HIGH", "PLATFORM"] },
  visual: visual({
    treeSpacing: 480, treeMix: { small: 0, medium: 2, large: 1 },
    rootSpacing: 480, rootMix: { small: 0, medium: 2, large: 2 },
    foliageSpacing: 380, foliageMix: { small: 1, medium: 2, large: 1 }, hangingChance: 0.2,
    silhouetteSpacing: 380,
    wash: { color: 0x6b3a22, alpha: 0.13 },
  }),
};

export const ZONE_DEEP_FOREST: ZoneDef = {
  id: "DEEP_FOREST",
  name: "Deep Forest",
  start: 4000,
  end: 5300,
  minObstacleGap: 190,
  obstacleTypes: { allowed: ["PLATFORM", "STACKED"], required: ["PLATFORM", "STACKED"] },
  visual: visual({
    treeSpacing: 260, treeMix: { small: 0, medium: 1, large: 3 },
    rootSpacing: 300, rootMix: { small: 0, medium: 1, large: 2 },
    foliageSpacing: 190, foliageMix: { small: 0, medium: 2, large: 3 }, hangingChance: 0.4,
    silhouetteSpacing: 260,
    wash: { color: 0x06301c, alpha: 0.22 },
  }),
};

export const ZONE_DANGEROUS: ZoneDef = {
  id: "DANGEROUS",
  name: "Dangerous Wilds",
  start: 5300,
  end: 6500,
  minObstacleGap: 170,
  obstacleTypes: { allowed: ["STACKED", "NARROW"], required: ["STACKED", "NARROW"] },
  visual: visual({
    treeSpacing: 360, treeMix: { small: 0, medium: 2, large: 2 },
    rootSpacing: 280, rootMix: { small: 0, medium: 1, large: 3 },
    foliageSpacing: 280, foliageMix: { small: 1, medium: 2, large: 2 }, hangingChance: 0.3,
    silhouetteSpacing: 320,
    wash: { color: 0x35204d, alpha: 0.17 },
  }),
};

export const ZONE_FINAL: ZoneDef = {
  id: "FINAL",
  name: "Final Approach",
  start: 6500,
  end: WORLD_WIDTH,
  minObstacleGap: 220,
  obstacleTypes: { allowed: ["LOW", "PLATFORM", "STACKED"], required: ["STACKED"] },
  visual: visual({
    treeSpacing: 640, treeMix: { small: 1, medium: 2, large: 0 },
    rootSpacing: 760, rootMix: { small: 2, medium: 1, large: 0 },
    foliageSpacing: 600, foliageMix: { small: 2, medium: 2, large: 0 }, hangingChance: 0.08,
    silhouetteSpacing: 620,
    wash: { color: 0xa9d6b0, alpha: 0.1 },
  }),
};

export const ZONES: readonly ZoneDef[] = [ZONE_START, ZONE_ROCKY, ZONE_HUNTER, ZONE_DEEP_FOREST, ZONE_DANGEROUS, ZONE_FINAL];

/**
 * The stretch at the very end kept completely clear (no obstacles, collectibles or
 * Hunters): the level's exit gate stands here (lib/objective/placement.ts).
 */
export const EXIT_RESERVE = { start: 7200, end: WORLD_WIDTH } as const;

/**
 * Decorative pools of water (walkable, purely visual), one in most of the journey. A rock or stump standing in
 * shallow water is fine (the first rock always did); pools just stay off the Hunters' beats and the exit area.
 */
export const WATER_SEGMENTS: readonly WaterSegment[] = [
  { start: 680, end: 920 }, // the original pool (Forest Start)
  { start: 2130, end: 2390 }, // a shallow stream in the Rocky Area (a boulder stands in it)
  { start: 4830, end: 5090 }, // a still pool in the Deep Forest, just past the second Hunter
  { start: 6180, end: 6440 }, // swampy water in the Dangerous Wilds, just past the third Hunter
];

/** Zone list in the form the environment layer wants. */
export const ENVIRONMENT_ZONES: readonly EnvironmentZone[] = ZONES.map((z) => ({ start: z.start, end: z.end, visual: z.visual }));

/** Which zone a world x falls in (clamped to the first/last zone). */
export function zoneAt(x: number): ZoneDef {
  for (const zone of ZONES) if (x >= zone.start && x < zone.end) return zone;
  return x < 0 ? ZONES[0] : ZONES[ZONES.length - 1];
}
