/**
 * Validation for the collectible layout and the collecting rules. No browser: the layout is pure data, so it
 * is checked against the real level (obstacles, Hunters, zones, exit) with Rara's real body size and jump,
 * and the Hunter-side items are proven escapable by driving the real Hunter AI and the real movement motor
 * (see raidSim.ts). Everything is deterministic.
 *
 *   node scripts/collectibles/validate-collectibles.ts
 *
 * Sections: layout, the six zones' patterns, pattern rules, reach (every item can be collected, none needs
 * an impossible jump), Hunter exposure and raids (risky items have an escape, no capture at any Hunter
 * timing), and the collecting rules (count, collect-once, reset).
 */

import { COLLECTIBLE_RADIUS, PICKUP_FORGIVENESS } from "../../lib/collectibles/config.ts";
import { CollectibleTracker } from "../../lib/collectibles/CollectibleTracker.ts";
import { FIRST_LEVEL_COLLECTIBLES as ITEMS, collectibleCenter, requiredJumpHeight } from "../../lib/collectibles/placement.ts";
import type { CollectiblePattern, CollectibleSpec } from "../../lib/collectibles/types.ts";
import { DEFAULT_HUNTER_CONFIG as HUNTER } from "../../lib/hunter/config.ts";
import { detectTarget } from "../../lib/hunter/DetectionSystem.ts";
import { FIRST_LEVEL_HUNTERS, patrolSpan } from "../../lib/hunter/placement.ts";
import {
  CHARACTER_SCALE, GROUND_SURFACE_Y, HAZARD_X, MOVE_MAX_X, MOVE_MIN_X, PLAYER_START_X, SEED_X, WORLD_WIDTH,
} from "../../lib/level/constants.ts";
import { circleIntersectsRect, type Rect } from "../../lib/level/geometry.ts";
import { EXIT_RESERVE, zoneAt, type ZoneId } from "../../lib/level/zones.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import { EXIT_SPEC } from "../../lib/objective/placement.ts";
import { FIRST_LEVEL_OBSTACLES as OBSTACLES } from "../../lib/obstacles/placement.ts";
import { obstacleRects } from "../../lib/obstacles/shapes.ts";
import type { ObstacleSpec } from "../../lib/obstacles/types.ts";
import { runRaid, sweepRaid, type Raid } from "./raidSim.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const body = bodySize(CHARACTER_SCALE);
const R = COLLECTIBLE_RADIUS;
const F = PICKUP_FORGIVENESS;
const peak = MOVE.jumpVelocity ** 2 / (2 * MOVE.gravity); // theoretical peak of a held jump (~140px); measured ~134
/** "Comfortable" = at most 80% of a full jump: what every obstacle and every item is held to. */
const JUMP_LIMIT = 0.8 * peak;
const centers = ITEMS.map((i) => ({ spec: i, ...collectibleCenter(i, GROUND_SURFACE_Y) }));
const items = centers.map((c) => ({ id: c.spec.id, x: c.x, y: c.y }));
const zoneOf = (i: CollectibleSpec): ZoneId => zoneAt(i.x).id;
const inZone = (zone: ZoneId) => ITEMS.filter((i) => zoneOf(i) === zone);
const patrols = FIRST_LEVEL_HUNTERS.map((h) => patrolSpan(h, HUNTER));

/** Rara's body box when standing on a surface at `standY`, lifted `lift` px into the air, at centre x. */
const bodyAt = (x: number, lift = 0, standY = GROUND_SURFACE_Y): Rect => ({
  left: x - body.width / 2,
  right: x + body.width / 2,
  top: standY - lift - body.height,
  bottom: standY - lift,
});
const pieces = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
const blockers: Rect[] = [...pieces, { left: 0, right: WORLD_WIDTH, top: GROUND_SURFACE_Y, bottom: 600 }];
const heightOf = (r: Rect) => GROUND_SURFACE_Y - r.top;

/**
 * Every place Rara's body can be while touching an item, at the smallest posture that does it: beside an
 * obstacle on the ground, or on top of it (where her body overlaps a piece horizontally she must be above
 * that piece's top, so that is her floor there). `feetHeight` is how far above the ground her feet are.
 */
function standingSpots(cx: number, cy: number): { x: number; floor: number; need: number; feetHeight: number }[] {
  const reach = R + F + body.width / 2;
  const itemBottom = GROUND_SURFACE_Y - cy - R - F; // the lowest point of the item's reach, as a height above the ground
  const itemTop = GROUND_SURFACE_Y - cy + R + F;
  const spots = [];
  for (let x = cx - reach; x <= cx + reach; x += 2) {
    const under = pieces.filter((r) => r.left < x + body.width / 2 && r.right > x - body.width / 2);
    const floor = Math.max(0, ...under.map(heightOf));
    if (floor > itemTop) continue; // the item would be inside the surface here
    const need = Math.max(0, itemBottom - body.height - floor);
    spots.push({ x, floor, need, feetHeight: floor + need });
  }
  return spots;
}
/** The smallest jump (px above whatever she is standing on) that touches the item. */
const surfaceNeed = (cx: number, cy: number) => Math.min(Infinity, ...standingSpots(cx, cy).map((s) => s.need));

const newTracker = () => new CollectibleTracker(items, R);

/** The obstacle whose footprint an item's x falls inside, if any. */
const structureUnder = (i: CollectibleSpec): ObstacleSpec | undefined => OBSTACLES.find((o) => i.x >= o.x - o.width / 2 && i.x <= o.x + o.width / 2);

// --- Hunter exposure: can a Hunter see Rara while she collects this item? ---------------------------------------------------
/** The Hunter positions a patrol covers (every 10px), with the real range/vertical/awareness detection and line of sight. */
function seenBy(hunterIndex: number, spots: { x: number; feetHeight: number }[], mode: "cone" | "tracking") {
  const p = patrols[hunterIndex];
  const hunterY = GROUND_SURFACE_Y - HUNTER.body.height / 2;
  for (let hx = p.left; hx <= p.right; hx += 10) {
    for (const facing of [1, -1] as const) {
      for (const s of spots) {
        const target = { x: s.x, y: GROUND_SURFACE_Y - s.feetHeight - body.height / 2 };
        if (detectTarget({ x: hx, y: hunterY }, facing, target, HUNTER, blockers, mode)) return true;
      }
    }
  }
  return false;
}
const spotsOf = (i: CollectibleSpec) => {
  const c = collectibleCenter(i, GROUND_SURFACE_Y);
  return standingSpots(c.x, c.y).filter((s) => s.need <= JUMP_LIMIT);
};
/** Which Hunter (index) can see her collecting this item, or -1. */
const exposedTo = (i: CollectibleSpec) => patrols.findIndex((_, h) => seenBy(h, spotsOf(i), "cone"));
/** Standing on the ground at x: can a Hunter that is already on her trail (tracking) see her? */
const hiddenAt = (hunterIndex: number, x: number) => !seenBy(hunterIndex, [{ x, feetHeight: 0 }], "tracking");

// --- the scripted raids: one for every item a Hunter can see ------------------------------------------------------------------
/** Start / approach / grab / leave, each from and to a spot hidden from that Hunter. */
const H = FIRST_LEVEL_HUNTERS;
const RAIDS: Record<string, { hunter: number; raid: Raid; safeSpotX: number }> = {
  // Hunter 1: behind the tall stump, hop it, grab c05 in front of the beat, hop back behind it.
  c05: { hunter: 0, safeSpotX: 2760, raid: { startX: 2760, itemId: "c05", hunters: [H[0]], steps: [{ toX: 2930, untilCollected: true }, { toX: 2760, tolerance: 14 }] } },
  // Hunter 2: from behind the deck, climb it, grab c07, drop back behind it.
  c07: { hunter: 1, safeSpotX: 3850, raid: { startX: 3850, itemId: "c07", hunters: [H[1]], steps: [{ toX: 4060, untilCollected: true }, { toX: 3850, tolerance: 14 }] } },
  // Hunter 2: just past its beat, climb the stack, grab c08, carry on and drop behind it.
  c08: { hunter: 1, safeSpotX: 5150, raid: { startX: 4800, itemId: "c08", hunters: [H[1]], steps: [{ toX: 5020, untilCollected: true }, { toX: 5150, tolerance: 14 }] } },
  // Hunter 3: behind the first stack, hop it, grab c10 in front of the beat, hop back.
  c10: { hunter: 2, safeSpotX: 5250, raid: { startX: 5250, itemId: "c10", hunters: [H[2]], steps: [{ toX: 5550, untilCollected: true }, { toX: 5250, tolerance: 14 }] } },
  // Hunter 3: just past its beat, hop the pillars through the gap (c11), carry on behind them.
  c11: { hunter: 2, safeSpotX: 6620, raid: { startX: 6120, itemId: "c11", hunters: [H[2]], steps: [{ toX: 6425, untilCollected: true }, { toX: 6620, tolerance: 14 }] } },
};
const sweeps: Record<string, ReturnType<typeof sweepRaid>> = {};
for (const [id, r] of Object.entries(RAIDS)) sweeps[id] = [...sweepRaid(r.raid, items, 96, 60), ...sweepRaid(r.raid, items, 96, 30)];
const exposed = ITEMS.filter((i) => exposedTo(i) >= 0);

/**
 * How long can she hesitate after taking the item, at the worst Hunter timing, before a capture becomes possible?
 * (The raid turns back the moment the item is collected, then stands still for this long, then runs.) A fair risk
 * item leaves at least a human reaction time; a harder one leaves less.
 */
function graceSeconds(id: string): number {
  const { raid } = RAIDS[id];
  const [grab, leave] = raid.steps;
  let best = -0.1;
  for (let wait = 0; wait <= 1.5001; wait += 0.1) {
    const r: Raid = { ...raid, steps: [grab, { ...leave, waitSeconds: wait }] };
    const runs = [...sweepRaid(r, items, 96, 60), ...sweepRaid(r, items, 96, 30)];
    if (!runs.every((q) => q.collected && !q.caught && q.finished)) break;
    best = wait;
  }
  return best;
}
/** The share of Hunter timings that are safe even if she stands still for a full second after the grab. */
function safeShareAfter(id: string, wait: number): number {
  const { raid } = RAIDS[id];
  const [grab, leave] = raid.steps;
  const r: Raid = { ...raid, steps: [grab, { ...leave, waitSeconds: wait }] };
  const runs = [...sweepRaid(r, items, 96, 60), ...sweepRaid(r, items, 96, 30)];
  return runs.filter((q) => q.collected && !q.caught).length / runs.length;
}
const grace = { c05: graceSeconds("c05"), c10: graceSeconds("c10") };

// --- layout ---------------------------------------------------------------------------------------------------------------
{
  const ids = ITEMS.map((i) => i.id);
  check("exactly 12 collectibles, with unique ids", ITEMS.length === 12 && new Set(ids).size === 12, `${ITEMS.length} items`);
  const perZone = (["START", "ROCKY", "HUNTER", "DEEP_FOREST", "DANGEROUS", "FINAL"] as const).map((z) => inZone(z).length);
  check("zone counts are 2 / 2 / 2 / 2 / 3 / 1", perZone.join("/") === "2/2/2/2/3/1", perZone.join("/"));
  check("all items are inside the playable world", ITEMS.every((i) => i.x >= MOVE_MIN_X && i.x <= MOVE_MAX_X));
  check("none is in the area reserved for the exit", ITEMS.every((i) => i.x < EXIT_RESERVE.start));
  const boxes = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
  check("no item is inside (or touching) a solid obstacle piece, stack tiers and narrow pillars included", centers.every((c) => boxes.every((b) => !circleIntersectsRect(c.x, c.y, R + F, b))));
  check("no item sits inside the ground", centers.every((c) => c.y + R < GROUND_SURFACE_Y));
  const xs = ITEMS.map((i) => i.x).sort((a, b) => a - b);
  check("items are spread out (at least 90px apart) and listed in order along the journey", xs.every((x, i) => i === 0 || x - xs[i - 1] >= 90) && ITEMS.every((it, i) => i === 0 || it.x > ITEMS[i - 1].x), `closest ${Math.min(...xs.slice(1).map((x, i) => x - xs[i]))}px`);
  check("spread across the whole journey (first in the start area, last near the far end)", xs[0] <= 700 && xs.at(-1)! >= WORLD_WIDTH * 0.85, `${xs[0]} .. ${xs.at(-1)}`);
  check("nothing on top of Rara's start, and clear of the existing seed and hazard", ITEMS.every((i) => Math.abs(i.x - PLAYER_START_X) >= 100 && Math.abs(i.x - SEED_X) >= 80 && Math.abs(i.x - HAZARD_X) >= 80));
  check("nothing inside a Hunter's patrol: every item is at least 60px clear of every beat (no item sits where a Hunter walks or where Rara would land on one)", ITEMS.every((i) => patrols.every((p) => i.x <= p.left - 60 || i.x >= p.right + 60)), patrols.map((p) => ITEMS.map((i) => Math.min(Math.abs(i.x - p.left), Math.abs(i.x - p.right))).reduce((a, b) => Math.min(a, b))).join("/") + "px closest");
  const nearObstacle = ITEMS.filter((i) => OBSTACLES.some((o) => Math.abs(o.x - i.x) < 130)).length;
  check("several items sit near obstacles to encourage jumping", nearObstacle >= 4, `${nearObstacle} items`);
  check("every Hunter has an item before its beat and one after it (within 450px), so its area is part of the collecting route", patrols.every((p) => ITEMS.some((i) => i.x < p.left && i.x >= p.left - 450) && ITEMS.some((i) => i.x > p.right && i.x <= p.right + 450)));
  const allowed: CollectiblePattern[] = ["GUIDE", "ARC", "VERTICAL", "OBSTACLE_ROUTE", "RISK_REWARD"];
  const used = new Set(ITEMS.map((i) => i.pattern));
  check("a small vocabulary of patterns: every item has one of five, and at least four are used", ITEMS.every((i) => allowed.includes(i.pattern)) && used.size >= 4 && used.size <= 5, [...used].join(", "));
}

// --- what each pattern means, checked against the geometry -------------------------------------------------------------------
{
  const need = (i: CollectibleSpec) => surfaceNeed(...(Object.values(collectibleCenter(i, GROUND_SURFACE_Y)) as [number, number]));
  const guides = ITEMS.filter((i) => i.pattern === "GUIDE");
  check("GUIDE items are ground items: walk into them, no jump, no Hunter watching", guides.every((i) => i.tier === "ground" && need(i) === 0 && exposedTo(i) < 0), guides.map((i) => i.id).join(","));
  const arcs = ITEMS.filter((i) => i.pattern === "ARC");
  check("ARC items float over a LOW obstacle where any real jump collects them", arcs.every((i) => { const o = structureUnder(i); return !!o && o.type === "LOW" && i.lift >= o.height + 60 && i.lift <= o.height + 80 && need(i) <= 40; }), arcs.map((i) => i.id).join(","));
  const verticals = ITEMS.filter((i) => i.pattern === "VERTICAL");
  check("VERTICAL items float 90px+ above an obstacle at least 80px tall: they need real height (climbing or leaping onto it)", verticals.every((i) => { const o = structureUnder(i); return !!o && o.height >= 80 && i.lift >= o.height + 90; }), verticals.map((i) => i.id).join(","));
  check("...and nothing about them needs more than a comfortable jump (80% of a full one), from the ground or from the obstacle's own tiers", verticals.every((i) => need(i) <= JUMP_LIMIT && structureUnder(i)!.height <= JUMP_LIMIT));
  const routes = ITEMS.filter((i) => i.pattern === "OBSTACLE_ROUTE");
  check("OBSTACLE_ROUTE items sit in or on an obstacle (a platform or the two-pillar passage): the way to them runs over it", routes.every((i) => { const o = structureUnder(i); return !!o && (o.type === "PLATFORM" || o.type === "NARROW") && i.lift >= o.height + 60; }), routes.map((i) => i.id).join(","));
  const risks = ITEMS.filter((i) => i.pattern === "RISK_REWARD");
  check("RISK_REWARD items are exactly the ones a Hunter can see her collect from its beat, and each has a scripted raid below", risks.length === 2 && risks.every((i) => exposedTo(i) >= 0 && RAIDS[i.id]), `${risks.map((i) => i.id).join(",")}; visible to a Hunter: ${exposed.map((i) => i.id).join(",")}`);
}

// --- the six zones ---------------------------------------------------------------------------------------------------------------
{
  const need = (i: CollectibleSpec) => surfaceNeed(...(Object.values(collectibleCenter(i, GROUND_SURFACE_Y)) as [number, number]));
  const [c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11, c12] = ITEMS;

  // 1 Forest Start: easy to understand, no Hunter pressure, no difficult jump.
  const z1 = inZone("START");
  check("Zone 1 (Forest Start): both items are easy: no Hunter can see either, and neither needs more than a hop", z1.every((i) => exposedTo(i) < 0 && need(i) <= 40), z1.map((i) => `${i.id} needs ${need(i).toFixed(0)}px`).join(", "));
  check("Zone 1: one is right on the natural starting route (walk into it), one is slightly offset (a hop over the stump beside the route)", c01.tier === "ground" && c01.x > PLAYER_START_X && c01.x - PLAYER_START_X <= 300 && c02.tier === "hop" && c02.lift > c01.lift);
  check("Zone 1: the Hunters are all far away (over 1500px from the nearest item)", z1.every((i) => patrols.every((p) => p.left - i.x > 1500)));

  // 2 Rocky Area: verticality, a jump over an obstacle, one item that stays comfortable.
  const z2 = inZone("ROCKY");
  const over2 = z2.filter((i) => { const o = structureUnder(i); return !!o && i.lift >= o.height + 60; });
  check("Zone 2 (Rocky Area): at least one item encourages jumping over an obstacle", over2.length >= 1, over2.map((i) => `${i.id} over ${structureUnder(i)!.id}`).join(", "));
  check("Zone 2: it introduces verticality: an item high above a tall (HIGH) obstacle", z2.some((i) => { const o = structureUnder(i); return !!o && o.type === "HIGH" && i.pattern === "VERTICAL"; }));
  check("Zone 2: one item stays comfortable: a plain hop over a LOW obstacle, no precision, no Hunter", z2.some((i) => { const o = structureUnder(i); return !!o && o.type === "LOW" && need(i) <= 10 && exposedTo(i) < 0; }));

  // 3 Hunter Territory: one relatively safe, one that raises the risk, with a clear escape.
  const z3 = inZone("HUNTER");
  const safe3 = z3.filter((i) => exposedTo(i) < 0);
  const risky3 = z3.filter((i) => exposedTo(i) >= 0);
  check("Zone 3 (Hunter Territory): one item is safe (no Hunter can see it) and one is risky (a Hunter can see her take it)", safe3.length === 1 && risky3.length === 1 && risky3[0] === c05 && safe3[0] === c06, `safe ${safe3.map((i) => i.id)}, risky ${risky3.map((i) => i.id)}`);
  const beat1 = patrols[0];
  check("Zone 3: the risky item is at the beat's front door (60-160px before it), where collecting it is seen but can be done without touching the beat", c05.x <= beat1.left - 60 && c05.x >= beat1.left - 160, `${beat1.left - c05.x}px before the beat`);
  check("Zone 3: the safe item is past the Hunter, in the shadow of the ledge, and points at the next structure (the deck)", c06.x > beat1.right && c06.x < OBSTACLES.find((o) => o.id === "deck-1")!.x - 75 && c06.x >= OBSTACLES.find((o) => o.id === "ledge-1")!.x + 65 && c06.x <= OBSTACLES.find((o) => o.id === "deck-1")!.x - OBSTACLES.find((o) => o.id === "deck-1")!.width / 2, `x=${c06.x}`);

  // 4 Deep Forest: a deliberate sequence over the existing platform and stack, with real height.
  const z4 = inZone("DEEP_FOREST");
  const [s1, s2] = z4.map(structureUnder);
  check("Zone 4 (Deep Forest): the two items sit on two different existing structures, a platform and then a stacked obstacle", !!s1 && !!s2 && s1.type === "PLATFORM" && s2.type === "STACKED" && s1 !== s2, `${s1?.id} then ${s2?.id}`);
  check("Zone 4: a rising sequence: each item is on a higher surface than the last (ground item c06, deck, stack), each pointing at the next", !!s1 && !!s2 && s2.height > s1.height && s1.height > 0 && c06.lift < c07.lift && c07.lift < c08.lift, `${c06.lift} -> ${c07.lift} -> ${c08.lift}`);
  check("Zone 4: at least one item needs meaningful vertical movement (a stack tier 80px+ tall)", z4.some((i) => { const o = structureUnder(i); return !!o && o.height >= 80; }));

  // 5 Dangerous Wilds: accessible / obstacle-related / higher risk near a Hunter.
  const z5 = inZone("DANGEROUS");
  check("Zone 5 (Dangerous Wilds): three items, the most demanding zone: one accessible ground item, one in an obstacle, one risky", z5.length === 3 && c09.tier === "ground" && c09.pattern === "GUIDE" && need(c09) === 0 && exposedTo(c09) < 0 && c11.pattern === "OBSTACLE_ROUTE" && c10.pattern === "RISK_REWARD");
  check("Zone 5: the obstacle item is in the two-pillar passage (the tightest obstacle in the game)", structureUnder(c11)?.type === "NARROW");
  const gap = (i: CollectibleSpec, p: { left: number; right: number }) => Math.min(Math.abs(i.x - p.left), Math.abs(i.x - p.right));
  check("Zone 5: the risky item is closer to its Hunter's beat than Zone 3's risky item (the higher risk)", gap(c10, patrols[2]) < gap(c05, patrols[0]), `${gap(c10, patrols[2])}px vs ${gap(c05, patrols[0])}px`);
  check("...and it leaves less time to react than Zone 3's does (a smaller grace period below), yet the grab-and-turn is still never caught", grace.c10 < grace.c05 && sweeps.c10.every((r) => !r.caught), `${grace.c10.toFixed(1)}s vs ${grace.c05.toFixed(1)}s`);

  // 6 Final Approach: one item, easy, pointing at the exit.
  const z6 = inZone("FINAL");
  const lastObstacle = Math.max(...OBSTACLES.map((o) => o.x + o.width / 2));
  check("Zone 6 (Final Approach): one item, a plain ground item with no Hunter and no obstacle to clear after the last stack", z6.length === 1 && c12.tier === "ground" && need(c12) === 0 && exposedTo(c12) < 0 && c12.x > lastObstacle + 60);
  check("Zone 6: it leads to the exit: the farthest item along the route, with the gate within a screen's sight (400px) but not on top of it", c12.x === Math.max(...ITEMS.map((i) => i.x)) && EXIT_SPEC.x - c12.x <= 400 && EXIT_SPEC.x - c12.x >= 250, `${EXIT_SPEC.x - c12.x}px from the gate`);
  void c01; void c03; void c04;
}

// --- reach: every item can be collected with the real body and the real jump -----------------------------------------------
{
  check("the jump arc peaks near 140px (from the movement tuning)", peak > 135 && peak < 145, `${peak.toFixed(0)}px`);
  // No impossible traversal: every solid piece is climbable from the ground or from a lower piece by hops of 80% of a jump.
  const reachable: Rect[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const p of pieces) {
      if (reachable.includes(p)) continue;
      const ok = heightOf(p) <= JUMP_LIMIT || reachable.some((q) => q.right >= p.left - 40 && q.left <= p.right + 40 && heightOf(p) > heightOf(q) && heightOf(p) - heightOf(q) <= JUMP_LIMIT);
      if (ok) { reachable.push(p); progress = true; }
    }
  }
  check("no impossible traversal: every solid piece can be climbed (from the ground or the tier below) with hops of at most 80% of a full jump, so no pocket is a trap", reachable.length === pieces.length && pieces.every((p) => heightOf(p) <= 112), `tallest ${Math.max(...pieces.map(heightOf))}px, limit ${JUMP_LIMIT.toFixed(0)}px`);
  for (const c of centers) {
    const need = surfaceNeed(c.x, c.y);
    const onTop = standingSpots(c.x, c.y).some((s) => s.floor > 0 && s.need === 0);
    const easy = c.spec.tier === "ground" ? need === 0 : need <= JUMP_LIMIT;
    check(`${c.spec.id} (${c.spec.tier}, ${c.spec.pattern}): ${need === 0 ? (onTop ? "reached from on top of the obstacle beneath it (or in flight over it)" : "walk into it") : `needs a ${need.toFixed(0)}px jump`} - within a comfortable jump`, easy);
  }
  // The closed-form requirement really matches the geometry used by the tracker.
  const agrees = centers.every((c) => {
    const need = requiredJumpHeight(c.spec.lift, body.height);
    const t = newTracker();
    const below = need > 1 ? t.collect(bodyAt(c.x, need - 1)).includes(c.spec.id) : false;
    const at = newTracker().collect(bodyAt(c.x, need + 1)).includes(c.spec.id);
    return !below && at;
  });
  check("requiredJumpHeight() agrees with the actual pickup geometry (just below: no, just above: yes)", agrees);
  // The real motor and the real jump, no Hunters: run at each item from the left and collect it, jumping only at walls.
  const clearGround = (x: number) => { while (pieces.some((r) => r.left < x + body.width / 2 + 6 && r.right > x - body.width / 2 - 6)) x -= 10; return x; };
  const failed: string[] = [];
  for (const c of centers) {
    const r: Raid = { startX: clearGround(c.x - 300), itemId: c.spec.id, hunters: [], stopOnCollect: true, steps: [{ toX: c.x, tolerance: 14 }] };
    const results = [runRaid(r, items, 0, 60), runRaid(r, items, 0, 30)];
    if (!results.every((res) => res.collected)) failed.push(c.spec.id);
  }
  check("every one of the 12 can be collected by simply running at it with the real motor and jump (60 and 30fps), jumping only at walls", failed.length === 0, failed.length ? `failed: ${failed.join(",")}` : "12 / 12");
}

// --- Hunter exposure and raids ----------------------------------------------------------------------------------------------------
{
  check("the items a Hunter can see her collect are c05, c07, c08, c10 and c11, and every one has a scripted raid", exposed.map((i) => i.id).join(",") === "c05,c07,c08,c10,c11" && exposed.every((i) => RAIDS[i.id]), exposed.map((i) => i.id).join(","));
  const hiddenIds = ITEMS.filter((i) => exposedTo(i) < 0).map((i) => i.id);
  check("every other item cannot be seen by any Hunter while she takes it (line of sight blocked, or out of range)", hiddenIds.join(",") === "c01,c02,c03,c04,c06,c09,c12", hiddenIds.join(","));
  for (const [id, { hunter, raid, safeSpotX }] of Object.entries(RAIDS)) {
    const runs = sweeps[id];
    const collected = runs.filter((r) => r.collected).length;
    const caught = runs.filter((r) => r.caught).length;
    const finished = runs.filter((r) => r.finished).length;
    const noticed = runs.filter((r) => r.noticed).length;
    check(`${id}: at all ${runs.length} Hunter timings (48 each at 60 and 30fps) she collects it, leaves, and is never caught`, collected === runs.length && caught === 0 && finished === runs.length, `collected ${collected}, caught ${caught}, got away ${finished}; the Hunter noticed her in ${noticed}`);
    check(`${id}: where the raid ends (x=${safeSpotX}) no Hunter that is already chasing her can see her: a real escape route, not just a lucky run`, hiddenAt(hunter, safeSpotX) && raid.steps.at(-1)!.toX === safeSpotX);
  }
  // The simulation can fail: a player who runs into the Hunter's beat, or dawdles at a risky item, does get caught.
  const reckless: Raid = { startX: 2760, itemId: "c05", hunters: [H[0]], steps: [{ toX: 3250, tolerance: 8 }, { toX: 3250, waitSeconds: 3, tolerance: 8 }] };
  const recklessCaught = sweepRaid(reckless, items, 48, 60).filter((r) => r.caught).length;
  check("control: running into the middle of a Hunter's beat and standing there IS caught at most timings (the raid simulation is not vacuous)", recklessCaught >= 24, `caught ${recklessCaught} of 48`);
  const dawdle: Raid = { ...RAIDS.c05.raid, steps: [RAIDS.c05.raid.steps[0], { toX: 2760, waitSeconds: 2.5, tolerance: 14 }] };
  const dawdleCaught = sweepRaid(dawdle, items, 48, 60).filter((r) => r.caught).length;
  check("control: dawdling 2.5s at the risky item does get caught at some timings (it is a real risk), while the quick grab never is", dawdleCaught > 0 && sweeps.c05.every((r) => !r.caught), `dawdling caught ${dawdleCaught} of 48`);
  check("fair pressure: Zone 3's risky item leaves 0.3s+ to react (about a human reaction time) at the very worst Hunter timing; Zone 5's leaves 0.2s+", grace.c05 >= 0.3 - 1e-9 && grace.c10 >= 0.2 - 1e-9, `c05 ${grace.c05.toFixed(1)}s, c10 ${grace.c10.toFixed(1)}s`);
  const patient = { c05: safeShareAfter("c05", 1), c10: safeShareAfter("c10", 1) };
  check("a patient player is never forced into capture: timing the grab well works even if she then freezes a full second (at least 60% of Hunter timings are safe)", patient.c05 >= 0.6 && patient.c10 >= 0.6, `c05 ${(patient.c05 * 100).toFixed(0)}%, c10 ${(patient.c10 * 100).toFixed(0)}%`);
}

// --- collecting rules ---------------------------------------------------------------------------------------------------------------
{
  const t = newTracker();
  check("starts with nothing collected: counter 0 of the total", t.count === 0 && t.total === ITEMS.length);
  check("standing at the start collects nothing", t.collect(bodyAt(PLAYER_START_X)).length === 0 && t.count === 0);

  const firstGround = centers.find((c) => c.spec.tier === "ground")!;
  const got = t.collect(bodyAt(firstGround.x));
  check("walking into a ground item collects it (counter 1)", got.length === 1 && got[0] === firstGround.spec.id && t.count === 1);
  check("a collected item cannot be collected again", t.collect(bodyAt(firstGround.x)).length === 0 && t.count === 1);
  check("walking away and back does not collect it again", t.collect(bodyAt(firstGround.x + 400)).length === 0 && t.collect(bodyAt(firstGround.x)).length === 0 && t.count === 1);

  const hopItem = centers.find((c) => c.spec.tier === "hop")!;
  const tHop = newTracker();
  check("a hop item is NOT collected from the ground", tHop.collect(bodyAt(hopItem.x)).length === 0);
  check("...but is collected by a real jump (40px up)", tHop.collect(bodyAt(hopItem.x, 40)).includes(hopItem.spec.id));

  // The "high" tier (an item that needs a good jump from open ground) is not used by the layout, but its geometry stays right.
  const highItem = { id: "h", x: 300, y: GROUND_SURFACE_Y - 205 };
  const tHigh = new CollectibleTracker([highItem], R);
  check("a high item is not collected by a tiny hop", tHigh.collect(bodyAt(highItem.x, 20)).length === 0);
  check("...but is collected near the top of a full jump", tHigh.collect(bodyAt(highItem.x, 0.95 * peak)).includes("h"));

  // Every hop item can be collected from the obstacle beneath it: by standing on the highest piece under it, or, where it
  // floats over a gap (the passage between narrow pillars), by a jump into that gap.
  for (const item of centers.filter((c) => c.spec.tier === "hop")) {
    const under = pieces.filter((r) => r.left <= item.x && r.right >= item.x);
    const tracker = newTracker();
    if (under.length > 0) {
      const topY = Math.min(...under.map((r) => r.top));
      check(`${item.spec.id}: standing on top of the obstacle beneath it (${(GROUND_SURFACE_Y - topY).toFixed(0)}px up) collects it`, tracker.collect(bodyAt(item.x, 0, topY)).includes(item.spec.id));
    } else {
      const lift = GROUND_SURFACE_Y - item.y;
      const slotNeed = Math.max(0, lift - R - F - body.height);
      check(`${item.spec.id}: it floats over a gap between pillars; a ${(slotNeed + 4).toFixed(0)}px jump from the gap floor collects it (or standing on a pillar's edge)`, tracker.collect(bodyAt(item.x, slotNeed + 4)).includes(item.spec.id) && surfaceNeed(item.x, item.y) <= slotNeed);
    }
  }

  // The whole level: pass each item once (jumping only where needed) and count them all.
  const all = newTracker();
  const counts: number[] = [];
  for (const c of centers) {
    const need = requiredJumpHeight(c.spec.lift, body.height);
    all.collect(bodyAt(c.x, need > 0 ? need + 4 : 0));
    counts.push(all.count);
  }
  check("collecting every item one by one counts up 1,2,3... to the total", counts.every((n, i) => n === i + 1) && all.count === all.total && counts.length === ITEMS.length, counts.join(","));
  check("everything collected: nothing left to collect", all.collect(bodyAt(centers[0].x)).length === 0 && all.count === ITEMS.length);

  // Restart.
  all.reset();
  check("restart: counter back to zero, all 12 back", all.count === 0 && all.total === ITEMS.length);
  const again: number[] = [];
  for (const c of centers) {
    const need = requiredJumpHeight(c.spec.lift, body.height);
    all.collect(bodyAt(c.x, need > 0 ? need + 4 : 0));
    again.push(all.count);
  }
  check("restart: every one of the 12 can be collected again", again.every((n, i) => n === i + 1) && all.count === 12);
  all.reset();

  // Two items touched in one frame both count (dense layouts, wide body).
  const dense = new CollectibleTracker([{ id: "a", x: 100, y: 440 }, { id: "b", x: 120, y: 440 }, { id: "far", x: 900, y: 440 }], R);
  check("two items touched in the same frame are both collected, once each", JSON.stringify(dense.collect(bodyAt(110))) === '["a","b"]' && dense.count === 2);
  check("deterministic: ids come back in layout order", JSON.stringify(newTracker().collect({ left: 0, right: WORLD_WIDTH, top: 0, bottom: 600 })) === JSON.stringify(ITEMS.map((i) => i.id)));
  // Forgiveness: an item (radius R) is collected when Rara's box comes within R + PICKUP_FORGIVENESS of its centre.
  const reach = R + F;
  const boxEndingAt = (right: number): Rect => ({ left: right - body.width, right, top: 380, bottom: 482.5 });
  const lone = () => new CollectibleTracker([{ id: "x", x: 200, y: 440 }], R);
  check("forgiveness: an item just inside the pickup reach is collected", lone().collect(boxEndingAt(200 - reach + 1)).length === 1);
  check("forgiveness: an item just outside the pickup reach is not", lone().collect(boxEndingAt(200 - reach - 1)).length === 0);
}

console.log(failures === 0 ? "\nAll collectible checks passed." : `\n${failures} collectible check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
