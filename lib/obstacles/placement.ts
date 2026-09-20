/**
 * Where the obstacles are, what kinds there are, and the rules a layout must obey to stay playable.
 * Pure data and maths (no Phaser), so the rules are enforced by scripts/obstacles/validate-obstacles.ts.
 *
 * FIVE TYPES, one per kind of demand on the player (see types.ts). The journey introduces them in
 * order, each zone building on the last (zones.ts lists which types each zone may / must use):
 *
 *   FOREST START     LOW x2                    the introduction: two easy hops, wide apart
 *   ROCKY AREA       LOW x3, HIGH x2           the jumping zone; the tall ones need a proper jump
 *   HUNTER TERRITORY HIGH, PLATFORM            a tall block to hide behind before the Hunter, a
 *                                              ledge to climb after it
 *   DEEP FOREST      PLATFORM, STACKED         a log deck, then a stepped stack past the Hunter
 *   DANGEROUS WILDS  STACKED, NARROW           the most demanding: a stack before the third Hunter,
 *                                              a tight two-pillar passage after it
 *   FINAL APPROACH   STACKED x1                one grand stepped structure as the last challenge,
 *                                              then open ground all the way to the exit
 *
 * Every obstacle is made of solid "pieces" (one static physics body each), so Rara and the
 * Hunters collide with all of it and the Hunter's line of sight is blocked by all of it.
 *
 * Fairness comes from numbers, not luck. Rara's jump peaks around 140px. No piece is taller than
 * 100px and no whole obstacle taller than 112px (80% of a jump), so anything can be jumped or
 * stood on; the lowest piece of every obstacle is at least 56px tall (so it hides Rara from a
 * Hunter and a Hunter can never "stare across" it); tall types get extra room to land; and the
 * tiers of a stack and the pillars of a narrow passage are wide enough to stand on. See
 * OBSTACLE_TYPE_RULES and the jump-arc checks in the validator.
 */

import { rectsOverlapArea, type Rect } from "../level/geometry.ts";
import { high, low, narrow, obstacleRects, platform, stacked } from "./shapes.ts";
import { OBSTACLE_TYPES, type ObstaclePiece, type ObstacleSpec, type ObstacleType } from "./types.ts";

export const FIRST_LEVEL_OBSTACLES: readonly ObstacleSpec[] = [
  // FOREST START: LOW only
  low("rock-1", "rock", 770, 60, 56),
  low("stump-1", "stump", 1120, 48, 64),
  // ROCKY AREA: LOW + HIGH
  low("rock-2", "rock", 1480, 64, 60),
  low("log-1", "log", 1770, 88, 56),
  high("stump-2", "stump", 2050, 52, 92),
  low("rock-3", "rock", 2330, 60, 64),
  high("pillar-1", "rock", 2600, 56, 88),
  // HUNTER TERRITORY: HIGH + PLATFORM
  high("stump-3", "stump", 2870, 48, 90),
  platform("ledge-1", "rock", 3695, 130, 64),
  // DEEP FOREST: PLATFORM + STACKED
  platform("deck-1", "log", 4030, 150, 56),
  stacked("stack-1", "rock", 5020, [[110, 56], [64, 40]]),
  // DANGEROUS WILDS: STACKED + NARROW
  stacked("stack-2", "rock", 5440, [[100, 56], [60, 40]]),
  narrow("narrow-1", "stump", 6425, 110, 56, 76),
  // FINAL APPROACH: one stepped structure, then open ground to the exit
  stacked("stack-3", "rock", 6830, [[120, 56], [84, 30], [56, 26]]),
];

/** What each type may look like. Ranges are [min, max] in px. */
export const OBSTACLE_TYPE_RULES = {
  LOW: { height: [56, 66], width: [40, 96] },
  HIGH: { height: [80, 100], width: [40, 70] },
  PLATFORM: { height: [56, 76], width: [130, 220] },
  STACKED: {
    tiers: [2, 3],
    /** The bottom tier is at least this tall (so it hides Rara from a Hunter), every tier at most this. */
    bottomTierMinHeight: 56,
    tierHeight: [26, 56],
    /** All the tiers together. 112 = 80% of a jump. */
    maxTotalHeight: 112,
    bottomWidth: [96, 130],
    /** Each tier is at least this much narrower than the one below (a stepped pyramid), and never narrower than tierMinWidth. */
    minShrink: 20,
    tierMinWidth: 56,
  },
  NARROW: {
    height: [64, 84],
    /** Wide enough to stand on (Rara's body is about 45px wide). */
    pillarWidth: [56, 64],
    gap: [100, 140],
  },
} as const;

export const OBSTACLE_RULES = {
  /**
   * The absolute floor for empty ground between two obstacles (edge to edge): room to stand and take
   * off. Each zone sets its own, larger, minimum (tighter later in the level; see ZoneDef.minObstacleGap).
   */
  minEdgeGap: 170,
  /** Extra landing / run-up room needed next to a type (on either side of it): the bigger the demand, the more room. */
  spacingNeeded: { LOW: 0, PLATFORM: 150, HIGH: 210, STACKED: 210, NARROW: 230 } as Record<ObstacleType, number>,
  /** Nothing closer than this to Rara's start (centre to centre), px. */
  minDistanceFromStart: 250,
  /** Nothing within this of an existing pickup or hazard, px. */
  clearanceFromPickups: 90,
  /**
   * Distance from a Hunter's patrol route. On the side Rara arrives from (left) she has room to react;
   * on the side she runs toward after passing a Hunter (right) the demanding types get more room so that
   * a chase never forces a hard obstacle on her the moment she lands.
   */
  patrolApproachClearance: 150,
  patrolAheadClearance: { LOW: 200, PLATFORM: 200, HIGH: 260, STACKED: 260, NARROW: 260 } as Record<ObstacleType, number>,
} as const;

/** How demanding each type is, used to check that the journey ramps up (validator only). */
export const OBSTACLE_PRESSURE: Record<ObstacleType, number> = { LOW: 1, PLATFORM: 2, HIGH: 2, STACKED: 3, NARROW: 4 };

export interface LayoutContext {
  bounds: { minX: number; maxX: number };
  playerStartX: number;
  /** Existing pickups/hazards to stay away from (centre x). */
  keepClearOf: { label: string; x: number }[];
  /** Every Hunter's patrol route, left to right end, centre x. */
  patrols: { left: number; right: number }[];
  /** Nothing at or beyond this x (the area reserved for the exit). */
  exitReserveStart: number;
  /** The minimum edge-to-edge gap required before an obstacle at this x (zone dependent). */
  minGapAt: (x: number) => number;
  /** Which types the zone at this x may use (null = no restriction). */
  allowedTypesAt: (x: number) => readonly ObstacleType[] | null;
}

const within = (value: number, [min, max]: readonly number[]) => value >= min && value <= max;

/** Problems with one obstacle's own dimensions and structure (independent of where it is). */
export function validateObstacleSpec(spec: ObstacleSpec): string[] {
  const problems: string[] = [];
  const say = (message: string) => problems.push(`${spec.id}: ${message}`);
  const pieces = spec.pieces;
  if (!(OBSTACLE_TYPES as readonly string[]).includes(spec.type)) {
    say(`unknown type "${spec.type}"`);
    return problems;
  }
  if (pieces.length === 0) {
    say("has no pieces");
    return problems;
  }
  for (const p of pieces) {
    if (!(p.width > 0 && p.height > 0) || p.base < 0) say("a piece has a non-positive size or a negative base");
  }

  // The footprint fields must agree with the pieces.
  const left = Math.min(...pieces.map((p) => p.x - p.width / 2));
  const right = Math.max(...pieces.map((p) => p.x + p.width / 2));
  const top = Math.max(...pieces.map((p) => p.base + p.height));
  if (spec.width !== right - left || spec.height !== top || spec.x !== (left + right) / 2) say("footprint (x/width/height) does not match its pieces");

  const single = (rule: { height: readonly number[]; width: readonly number[] }) => {
    if (pieces.length !== 1 || pieces[0].base !== 0) say(`${spec.type} is one block standing on the ground`);
    else {
      if (!within(pieces[0].height, rule.height)) say(`${spec.type} height ${pieces[0].height} outside ${rule.height[0]}-${rule.height[1]}`);
      if (!within(pieces[0].width, rule.width)) say(`${spec.type} width ${pieces[0].width} outside ${rule.width[0]}-${rule.width[1]}`);
    }
  };

  switch (spec.type) {
    case "LOW":
      single(OBSTACLE_TYPE_RULES.LOW);
      break;
    case "HIGH":
      single(OBSTACLE_TYPE_RULES.HIGH);
      break;
    case "PLATFORM":
      single(OBSTACLE_TYPE_RULES.PLATFORM);
      break;
    case "STACKED": {
      const r = OBSTACLE_TYPE_RULES.STACKED;
      const tiers = [...pieces].sort((a, b) => a.base - b.base);
      if (tiers.length < r.tiers[0] || tiers.length > r.tiers[1]) say(`STACKED needs ${r.tiers[0]}-${r.tiers[1]} tiers, has ${tiers.length}`);
      let expectedBase = 0;
      tiers.forEach((t, i) => {
        if (t.base !== expectedBase) say(`tier ${i + 1} does not rest exactly on the tier below`);
        if (t.x !== spec.x) say(`tier ${i + 1} is not centred on the stack`);
        if (!within(t.height, r.tierHeight)) say(`tier ${i + 1} height ${t.height} outside ${r.tierHeight[0]}-${r.tierHeight[1]}`);
        if (t.width < r.tierMinWidth) say(`tier ${i + 1} is too narrow to stand on (${t.width} < ${r.tierMinWidth})`);
        if (i > 0 && tiers[i - 1].width - t.width < r.minShrink) say(`tier ${i + 1} must be at least ${r.minShrink}px narrower than the tier below`);
        expectedBase += t.height;
      });
      if (tiers[0] && tiers[0].height < r.bottomTierMinHeight) say(`bottom tier ${tiers[0].height} is below ${r.bottomTierMinHeight} (it must hide Rara from a Hunter)`);
      if (tiers[0] && !within(tiers[0].width, r.bottomWidth)) say(`bottom tier width ${tiers[0].width} outside ${r.bottomWidth[0]}-${r.bottomWidth[1]}`);
      if (top > r.maxTotalHeight) say(`total height ${top} is over ${r.maxTotalHeight}`);
      break;
    }
    case "NARROW": {
      const r = OBSTACLE_TYPE_RULES.NARROW;
      const [a, b] = [...pieces].sort((p, q) => p.x - q.x) as [ObstaclePiece, ObstaclePiece];
      if (pieces.length !== 2 || !b) {
        say("NARROW is exactly two pillars");
        break;
      }
      if (a.base !== 0 || b.base !== 0) say("both pillars stand on the ground");
      if (a.width !== b.width || a.height !== b.height) say("the two pillars are the same size");
      if (!within(a.height, r.height)) say(`pillar height ${a.height} outside ${r.height[0]}-${r.height[1]}`);
      if (!within(a.width, r.pillarWidth)) say(`pillar width ${a.width} outside ${r.pillarWidth[0]}-${r.pillarWidth[1]}`);
      const gap = b.x - b.width / 2 - (a.x + a.width / 2);
      if (!within(gap, r.gap)) say(`gap ${gap} outside ${r.gap[0]}-${r.gap[1]}`);
      if (Math.abs(a.x + b.x - 2 * spec.x) > 1e-6) say("the pillars are not symmetric around x");
      break;
    }
  }
  return problems;
}

/** Every rule the layout breaks, in plain words (empty = playable). */
export function validateObstacleLayout(specs: readonly ObstacleSpec[], ctx: LayoutContext): string[] {
  const rules = OBSTACLE_RULES;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const s of specs) {
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`);
    ids.add(s.id);
    problems.push(...validateObstacleSpec(s));
    if (!(OBSTACLE_TYPES as readonly string[]).includes(s.type)) continue;

    const left = s.x - s.width / 2;
    const right = s.x + s.width / 2;
    if (left < ctx.bounds.minX || right > ctx.bounds.maxX) problems.push(`${s.id}: outside the playable world`);
    if (right > ctx.exitReserveStart) problems.push(`${s.id}: inside the area reserved for the exit`);
    if (Math.abs(s.x - ctx.playerStartX) < rules.minDistanceFromStart) problems.push(`${s.id}: too close to Rara's start`);
    for (const k of ctx.keepClearOf) {
      if (Math.abs(s.x - k.x) < rules.clearanceFromPickups) problems.push(`${s.id}: too close to the ${k.label}`);
    }
    for (const patrol of ctx.patrols) {
      if (right > patrol.left && left < patrol.right) problems.push(`${s.id}: on a Hunter's patrol route (${patrol.left}-${patrol.right})`);
      else if (right <= patrol.left && patrol.left - right < rules.patrolApproachClearance) problems.push(`${s.id}: only ${patrol.left - right}px before a Hunter's patrol (need ${rules.patrolApproachClearance})`);
      else if (left >= patrol.right && left - patrol.right < rules.patrolAheadClearance[s.type]) problems.push(`${s.id}: only ${left - patrol.right}px past a Hunter's patrol (a ${s.type} needs ${rules.patrolAheadClearance[s.type]})`);
    }
    const allowed = ctx.allowedTypesAt(s.x);
    if (allowed && !allowed.includes(s.type)) problems.push(`${s.id}: a ${s.type} obstacle is not part of this zone (allowed: ${allowed.join(", ")})`);
  }

  const sorted = [...specs].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const gap = b.x - b.width / 2 - (a.x + a.width / 2);
    const need = Math.max(rules.minEdgeGap, ctx.minGapAt(b.x), rules.spacingNeeded[a.type], rules.spacingNeeded[b.type]);
    if (gap < need) problems.push(`${a.id} and ${b.id}: only ${gap}px apart (need ${need})`);
  }

  // No two solid pieces may overlap (touching, like tiers of a stack, is fine).
  const all: { id: string; rect: Rect }[] = specs.flatMap((s) => obstacleRects(s, 0).map((rect) => ({ id: s.id, rect })));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (rectsOverlapArea(all[i].rect, all[j].rect)) problems.push(`${all[i].id} and ${all[j].id}: pieces overlap`);
    }
  }
  return problems;
}

/** True when a ground position is at least `margin` px away from every obstacle's edges (its whole footprint). */
export function isClearOfObstacles(x: number, margin: number, specs: readonly ObstacleSpec[]): boolean {
  return specs.every((s) => x < s.x - s.width / 2 - margin || x > s.x + s.width / 2 + margin);
}
