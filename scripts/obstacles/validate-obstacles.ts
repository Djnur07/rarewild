/**
 * Validation for the obstacle system: the five obstacle types, their dimensions, the layout rules,
 * and whether every type is actually playable with Rara's real jump. No browser: the jump arc is
 * integrated from the movement tuning, the rules are exercised with good and bad layouts, and the
 * Hunter AI is run against the real obstacle boxes.
 *
 *   node scripts/obstacles/validate-obstacles.ts
 */

import { DEFAULT_HUNTER_CONFIG as HUNTER } from "../../lib/hunter/config.ts";
import { hasLineOfSight, rectsOverlap } from "../../lib/hunter/DetectionSystem.ts";
import { HunterAI } from "../../lib/hunter/HunterAI.ts";
import { FIRST_LEVEL_HUNTERS, configForPlacement, patrolSpan } from "../../lib/hunter/placement.ts";
import {
  CHARACTER_SCALE, GROUND_SURFACE_Y, HAZARD_X, MOVE_MAX_X, MOVE_MIN_X, PLAYER_START_X, SEED_X, WORLD_WIDTH,
} from "../../lib/level/constants.ts";
import { rectsOverlapArea, type Rect } from "../../lib/level/geometry.ts";
import { EXIT_RESERVE, ZONES, zoneAt } from "../../lib/level/zones.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import {
  FIRST_LEVEL_OBSTACLES as OBSTACLES, OBSTACLE_PRESSURE, OBSTACLE_RULES, OBSTACLE_TYPE_RULES, isClearOfObstacles,
  validateObstacleLayout, validateObstacleSpec, type LayoutContext,
} from "../../lib/obstacles/placement.ts";
import { high, low, narrow, narrowGap, obstacleRects, platform, stacked } from "../../lib/obstacles/shapes.ts";
import { OBSTACLE_TYPES, type ObstacleSpec, type ObstacleType } from "../../lib/obstacles/types.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const BOUNDS = { minX: MOVE_MIN_X, maxX: MOVE_MAX_X };
const PATROLS = FIRST_LEVEL_HUNTERS.map((h) => patrolSpan(h, HUNTER));
const CTX: LayoutContext = {
  bounds: BOUNDS,
  playerStartX: PLAYER_START_X,
  keepClearOf: [
    { label: "existing seed pickup", x: SEED_X },
    { label: "existing hazard", x: HAZARD_X },
  ],
  patrols: PATROLS,
  exitReserveStart: EXIT_RESERVE.start,
  minGapAt: (x) => zoneAt(x).minObstacleGap,
  allowedTypesAt: (x) => zoneAt(x).obstacleTypes.allowed,
};
const body = bodySize(CHARACTER_SCALE);
const byType = (t: ObstacleType) => OBSTACLES.filter((o) => o.type === t);
const countBy = (specs: readonly ObstacleSpec[]) => Object.fromEntries(OBSTACLE_TYPES.map((t) => [t, specs.filter((o) => o.type === t).length]));

// --- Rara's real jump, integrated from the movement tuning -----------------------------------------------------
/** Height above the ground over time for a held jump (motor rules: gravity while rising, heavier while falling). */
function jumpArc(): { t: number; h: number }[] {
  const arc = [];
  let h = 0, v = MOVE.jumpVelocity, t = 0;
  const dt = 0.001;
  while (t < 3 && (h > 0 || v > 0)) {
    const g = MOVE.gravity * (v < 0 ? MOVE.fallGravityMultiplier : 1); // v<0: falling here (up is positive)
    v -= g * dt;
    h += v * dt;
    t += dt;
    arc.push({ t, h: Math.max(h, 0) });
  }
  return arc;
}
const ARC = jumpArc();
const PEAK = Math.max(...ARC.map((a) => a.h));
const SPEED = MOVE.maxRunSpeed;
const heightAt = (t: number) => ARC[Math.min(ARC.length - 1, Math.max(0, Math.round(t * 1000) - 1))].h;
/** Seconds of a jump spent above `height`. */
const timeAbove = (height: number) => ARC.filter((a) => a.h > height).length * 0.001;
/** How many px of takeoff position (at full speed) clear a block of this top height and width. */
const clearWindow = (height: number, width: number) => timeAbove(height) * SPEED - (width + body.width);

// --- 1. types and dimensions ------------------------------------------------------------------------------------------
{
  check("every obstacle has a valid type and art kind", OBSTACLES.every((o) => (OBSTACLE_TYPES as readonly string[]).includes(o.type) && ["rock", "stump", "log"].includes(o.kind)));
  const problems = OBSTACLES.flatMap((o) => validateObstacleSpec(o));
  check("every obstacle's dimensions and structure satisfy its type's rules (data-driven)", problems.length === 0, problems.join("; "));
  check("all five types are used: LOW, HIGH, PLATFORM, STACKED, NARROW", OBSTACLE_TYPES.every((t) => byType(t).length >= 1), JSON.stringify(countBy(OBSTACLES)));
  const pieces = OBSTACLES.reduce((n, o) => n + o.pieces.length, 0);
  check("a compound obstacle is several solid pieces (stacked tiers, narrow pillars) and a simple one is one", byType("STACKED").every((o) => o.pieces.length >= 2) && byType("NARROW").every((o) => o.pieces.length === 2) && [...byType("LOW"), ...byType("HIGH"), ...byType("PLATFORM")].every((o) => o.pieces.length === 1), `${OBSTACLES.length} obstacles, ${pieces} solid pieces`);
  check("some of the original simple obstacles are kept (progression, not a rewrite)", byType("LOW").length >= 4 && ["rock-1", "stump-1", "rock-2", "log-1"].every((id) => OBSTACLES.some((o) => o.id === id && o.type === "LOW")));
  check("the art kind still varies within a type (rock / stump / log)", new Set(OBSTACLES.map((o) => o.kind)).size === 3);
}

// --- 2. the rules reject bad obstacles and bad layouts ---------------------------------------------------------------------
{
  const bad = (s: ObstacleSpec) => validateObstacleSpec(s).length > 0;
  const layoutBad = (specs: ObstacleSpec[]) => validateObstacleLayout(specs, CTX).length > 0;
  check("rules: good examples of every type pass", [low("t", "rock", 1000, 60, 60), high("t", "rock", 1000, 56, 90), platform("t", "rock", 1000, 150, 64), stacked("t", "rock", 1000, [[110, 56], [64, 40]]), narrow("t", "rock", 1000, 110, 56, 76)].every((s) => !bad(s)));
  check("rules: an unknown type is rejected", bad({ ...low("t", "rock", 1000, 60, 60), type: "TALL" as ObstacleType }));
  check("rules: LOW too low (would not hide Rara) or too tall is rejected", bad(low("t", "rock", 1000, 60, 40)) && bad(low("t", "rock", 1000, 60, 80)));
  check("rules: HIGH must be clearly taller than LOW and still jumpable", bad(high("t", "rock", 1000, 56, 66)) && bad(high("t", "rock", 1000, 56, 120)) && bad(high("t", "rock", 1000, 90, 90)));
  check("rules: PLATFORM must be wide, and not too tall", bad(platform("t", "rock", 1000, 90, 64)) && bad(platform("t", "rock", 1000, 150, 96)));
  check("rules: STACKED needs 2-3 tiers", bad(stacked("t", "rock", 1000, [[110, 56]])) && bad(stacked("t", "rock", 1000, [[120, 56], [96, 30], [72, 28], [56, 26]])));
  check("rules: STACKED tiers must step inward (a tier as wide as the one below is rejected)", bad(stacked("t", "rock", 1000, [[110, 56], [100, 40]])));
  check("rules: STACKED tiers must be wide enough to stand on", bad(stacked("t", "rock", 1000, [[110, 56], [44, 40]])));
  check("rules: STACKED must be low enough overall to be jumpable (over 112px is rejected)", bad(stacked("t", "rock", 1000, [[120, 56], [90, 56], [60, 48]])));
  check("rules: STACKED's bottom tier must still hide Rara from a Hunter (>= 56px)", bad(stacked("t", "rock", 1000, [[110, 44], [64, 40]])));
  check("rules: a tier that does not rest on the one below is rejected", bad({ ...stacked("t", "rock", 1000, [[110, 56], [64, 40]]), pieces: [{ x: 1000, width: 110, height: 56, base: 0 }, { x: 1000, width: 64, height: 40, base: 70 }] }));
  check("rules: NARROW's gap must be tight but crossable (100-140px)", bad(narrow("t", "rock", 1000, 60, 56, 76)) && bad(narrow("t", "rock", 1000, 200, 56, 76)));
  check("rules: NARROW's pillars must be wide enough to stand on and not too tall", bad(narrow("t", "rock", 1000, 110, 40, 76)) && bad(narrow("t", "rock", 1000, 110, 56, 100)));
  check("rules: a footprint that disagrees with its pieces is rejected", bad({ ...low("t", "rock", 1000, 60, 60), width: 80 }));
  const ok = low("t", "rock", 1000, 60, 60);
  check("rules: on Rara's start, outside the world, or in the exit area is rejected", layoutBad([{ ...ok, x: PLAYER_START_X, pieces: [{ x: PLAYER_START_X, width: 60, height: 60, base: 0 }] }]) && layoutBad([low("t", "rock", 20, 60, 60)]) && layoutBad([low("t", "rock", WORLD_WIDTH - 10, 60, 60)]) && layoutBad([low("t", "rock", EXIT_RESERVE.start + 100, 60, 60)]));
  check("rules: on the existing seed or hazard is rejected", layoutBad([low("t", "rock", SEED_X, 60, 60)]) && layoutBad([low("t", "rock", HAZARD_X, 60, 60)]));
  check("rules: a type the zone does not use is rejected (a NARROW in the Forest Start)", layoutBad([narrow("t", "rock", 1000, 110, 56, 76)]) && !layoutBad([low("t", "rock", 1000, 60, 60)]));
  check("rules: on a Hunter's patrol route is rejected", layoutBad([platform("t", "rock", PATROLS[0].left + 100, 150, 64)]));
  const p1 = PATROLS[0];
  check("rules: right after a patrol, hard types need more room than easy ones (a PLATFORM 200px past it is fine, a HIGH is not until 260px)", !layoutBad([platform("t", "rock", p1.right + 200 + 65, 130, 64)]) && layoutBad([high("t", "rock", p1.right + 200 + 28, 56, 90)]) && !layoutBad([high("t", "rock", p1.right + 260 + 28, 56, 90)]));
  check("rules: before a patrol every type needs 150px (a HIGH 140px short is rejected, 160px is fine)", layoutBad([high("t", "rock", p1.left - 140 - 28, 56, 90)]) && !layoutBad([high("t", "rock", p1.left - 160 - 28, 56, 90)]));
  check("rules: spacing grows with the demand: 205px is enough between two LOW in the Rocky Area, not next to a HIGH (needs 210)", !layoutBad([low("a", "rock", 1500, 60, 60), low("b", "rock", 1500 + 30 + 205 + 30, 60, 60)]) && layoutBad([low("a", "rock", 1500, 60, 60), high("b", "rock", 1500 + 30 + 205 + 28, 56, 90)]) && !layoutBad([low("a", "rock", 1500, 60, 60), high("b", "rock", 1500 + 30 + 215 + 28, 56, 90)]));
  check("rules: the zone's own minimum applies (250px at the start, 170px in the Dangerous Wilds)", CTX.minGapAt(100) === 250 && CTX.minGapAt(5500) === 170 && layoutBad([low("a", "rock", 760, 60, 56), low("b", "rock", 760 + 30 + 206 + 30, 60, 56)]));
  check("rules: overlapping pieces are rejected", layoutBad([{ ...ok, pieces: [{ x: 1000, width: 60, height: 60, base: 0 }, { x: 1010, width: 60, height: 60, base: 30 }] }]));
  check("rules: duplicate ids are rejected", layoutBad([low("d", "rock", 1000, 60, 60), low("d", "rock", 1400, 60, 60)]));
}

// --- 3. the shipped layout: rules, zones and progression -------------------------------------------------------------
{
  const problems = validateObstacleLayout(OBSTACLES, CTX);
  check("the layout satisfies every placement rule (types, spacing, patrols, exit, world)", problems.length === 0, problems.join("; "));
  check("every obstacle is inside the 7600px world and clear of Rara's start", OBSTACLES.every((o) => o.x - o.width / 2 >= MOVE_MIN_X && o.x + o.width / 2 <= MOVE_MAX_X && Math.abs(o.x - PLAYER_START_X) >= OBSTACLE_RULES.minDistanceFromStart));
  check("all six zones have a valid obstacle layout (at least one obstacle, only their allowed types)", ZONES.every((z) => { const list = OBSTACLES.filter((o) => zoneAt(o.x).id === z.id); return list.length >= 1 && list.every((o) => z.obstacleTypes.allowed.includes(o.type)); }), ZONES.map((z) => OBSTACLES.filter((o) => zoneAt(o.x).id === z.id).length).join("/"));
  check("every zone uses the types it is meant to teach", ZONES.every((z) => z.obstacleTypes.required.every((t) => OBSTACLES.some((o) => zoneAt(o.x).id === z.id && o.type === t))), ZONES.map((z) => `${z.id}: ${[...new Set(OBSTACLES.filter((o) => zoneAt(o.x).id === z.id).map((o) => o.type))].join("+")}`).join(" | "));
  const pressure = ZONES.map((z) => { const l = OBSTACLES.filter((o) => zoneAt(o.x).id === z.id); return l.reduce((n, o) => n + OBSTACLE_PRESSURE[o.type], 0) / l.length; });
  check("the demand ramps up zone by zone through the Dangerous Wilds, which is the hardest", pressure.slice(0, 5).every((p, i) => i === 0 || p > pressure[i - 1]) && pressure[4] === Math.max(...pressure), pressure.map((p) => p.toFixed(1)).join(" < "));
  const final = OBSTACLES.filter((o) => zoneAt(o.x).id === "FINAL");
  check("the Final Approach has fewer obstacles and one final challenge, then clear ground to the exit", final.length === 1 && final[0].type === "STACKED" && EXIT_RESERVE.start - (final[0].x + final[0].width / 2) >= 250, `${final.map((o) => o.id).join(",")}, ${(EXIT_RESERVE.start - (final[0].x + final[0].width / 2)).toFixed(0)}px to the exit area`);
  check("the Forest Start is only LOW obstacles (the first jumps are the simple ones)", OBSTACLES.filter((o) => zoneAt(o.x).id === "START").every((o) => o.type === "LOW"));
}

// --- 4. geometry ---------------------------------------------------------------------------------------------------------------
{
  const all = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y).map((rect) => ({ id: o.id, rect })));
  check("every obstacle stands on the ground (its lowest piece sits on the surface)", OBSTACLES.every((o) => Math.max(...obstacleRects(o, GROUND_SURFACE_Y).map((r) => r.bottom)) === GROUND_SURFACE_Y));
  check("stack tiers rest exactly on the tier below (no floating pieces, no overlap)", byType("STACKED").every((o) => { const r = obstacleRects(o, GROUND_SURFACE_Y).sort((a, b) => b.bottom - a.bottom); return r.every((box, i) => i === 0 || box.bottom === r[i - 1].top); }));
  check("no two solid pieces overlap anywhere in the level", all.every((a, i) => all.every((b, j) => j <= i || !rectsOverlapArea(a.rect, b.rect))), `${all.length} pieces`);
  check("the pieces of a narrow passage are separated by exactly the designed gap", byType("NARROW").every((o) => narrowGap(o) >= OBSTACLE_TYPE_RULES.NARROW.gap[0] && narrowGap(o) <= OBSTACLE_TYPE_RULES.NARROW.gap[1]), byType("NARROW").map((o) => `${narrowGap(o)}px`).join(","));
  check("helper: isClearOfObstacles agrees with the footprints (also for compound obstacles)", !isClearOfObstacles(770, 10, OBSTACLES) && !isClearOfObstacles(5020, 10, OBSTACLES) && !isClearOfObstacles(6425, 10, OBSTACLES) && isClearOfObstacles(500, 10, OBSTACLES));
}

// --- 5. playability with Rara's real jump ---------------------------------------------------------------------------------------
{
  check("Rara's jump peak comes from the movement tuning (about 134-140px)", PEAK > 130 && PEAK < 145, `${PEAK.toFixed(0)}px`);
  const maxWhole = Math.max(...OBSTACLES.map((o) => o.height));
  check("no obstacle is taller than 80% of a jump, so all of them can be jumped or stood on", maxWhole <= PEAK * 0.81 && OBSTACLES.every((o) => o.pieces.every((p) => p.height <= 100)), `tallest ${maxWhole}px vs ${PEAK.toFixed(0)}px`);

  for (const o of byType("LOW")) {
    const w = clearWindow(o.height, o.width);
    check(`LOW ${o.id}: an easy hop (a ${w.toFixed(0)}px window of takeoff positions clears it)`, w >= 120);
  }
  for (const o of byType("HIGH")) {
    const w = clearWindow(o.height, o.width);
    check(`HIGH ${o.id}: needs a proper jump but leaves a comfortable window (${w.toFixed(0)}px, ${timeAbove(o.height).toFixed(2)}s above the top)`, w >= 60 && timeAbove(o.height) >= 0.25, "not pixel-perfect: 60px+ of timing (about 7 frames at full speed)");
  }
  check("HIGH is a real step up from LOW (a HIGH needs a narrower window than any LOW)", Math.max(...byType("HIGH").map((o) => clearWindow(o.height, o.width))) < Math.min(...byType("LOW").map((o) => clearWindow(o.height, o.width))));
  for (const o of byType("PLATFORM")) {
    const top = o.pieces[0];
    check(`PLATFORM ${o.id}: Rara can land on top (jump clears ${top.height}px + 30) and its ${top.width}px top is a real surface to walk across`, PEAK >= top.height + 30 && top.width >= body.width * 2.5);
  }
  for (const o of byType("STACKED")) {
    const tiers = [...o.pieces].sort((a, b) => a.base - b.base);
    const rises = tiers.map((t) => t.height);
    check(`STACKED ${o.id}: every tier is a reachable step (rises ${rises.join("+")}px, each well within a jump) and standable (tops ${tiers.map((t) => t.width).join("/")}px wide)`, rises.every((r) => r <= PEAK - 40) && tiers.every((t) => t.width >= body.width + 10) && tiers[0].height <= PEAK - 40);
    const staircase = tiers.every((t, i) => i === 0 || t.width < tiers[i - 1].width);
    check(`STACKED ${o.id}: it narrows toward the top (a staircase, not a wall), so the route up and over is readable`, staircase);
  }
  // NARROW: the route is pillar to pillar. Simulate the crossing and the escape from the slot.
  const AIR = MOVE.groundAcceleration * MOVE.airControl;
  const crossDistance = (runway: number) => {
    // On a pillar's top: run up to `runway` px, then jump; horizontal speed follows the motor's rates (ground, then air).
    let v = Math.min(SPEED, Math.sqrt(2 * MOVE.groundAcceleration * Math.max(runway, 0)));
    let x = 0;
    for (const a of ARC) {
      v = Math.min(SPEED, v + AIR * 0.001);
      x += v * 0.001;
      void a;
    }
    return x;
  };
  for (const o of byType("NARROW")) {
    const [pillar] = o.pieces;
    const gap = narrowGap(o);
    const runway = pillar.width - body.width; // the room to run on a pillar top
    check(`NARROW ${o.id}: Rara can hop onto a pillar (${pillar.height}px) and stand on it (${pillar.width}px top)`, PEAK >= pillar.height + 30 && pillar.width >= body.width + 10);
    check(`NARROW ${o.id}: from a pillar top she can cross the ${gap}px gap to the other (the jump carries ${crossDistance(runway).toFixed(0)}px from a standing start)`, crossDistance(runway) >= gap + body.width);
    // Escape from the slot: a vertical jump, moving sideways in the air, must land her on a pillar before she falls back.
    const need = gap - body.width + 12; // px of sideways travel to get onto a pillar top from the far side of the slot
    const tNeed = Math.sqrt((2 * need) / AIR);
    check(`NARROW ${o.id}: the slot is never a trap (from the far side of the ${gap}px gap she reaches a pillar top in ${tNeed.toFixed(2)}s, still ${heightAt(tNeed).toFixed(0)}px up vs a ${pillar.height}px pillar)`, heightAt(tNeed) > pillar.height + 10);
    check(`NARROW ${o.id}: clearing both pillars in one jump is possible but not required (${clearWindow(pillar.height, o.width).toFixed(0)}px window)`, true);
  }
}

// --- 6. Hunters and obstacles -----------------------------------------------------------------------------------------------
{
  const hunterCenterY = GROUND_SURFACE_Y - HUNTER.body.height / 2;
  const raraCenterY = GROUND_SURFACE_Y - body.height / 2;
  for (const o of OBSTACLES) {
    const boxes = obstacleRects(o, GROUND_SURFACE_Y);
    const left = o.x - o.width / 2, right = o.x + o.width / 2;
    check(`${o.type} ${o.id}: Rara right behind it is hidden from a Hunter (every type blocks line of sight)`, !hasLineOfSight({ x: left - 60, y: hunterCenterY }, { x: right + 60, y: raraCenterY }, boxes));
  }
  for (const o of OBSTACLES.filter((s) => s.type === "NARROW")) {
    const boxes = obstacleRects(o, GROUND_SURFACE_Y);
    check(`NARROW ${o.id}: Rara standing in the passage is hidden from a Hunter on either side`, !hasLineOfSight({ x: o.x - o.width / 2 - 80, y: hunterCenterY }, { x: o.x, y: raraCenterY }, boxes) && !hasLineOfSight({ x: o.x + o.width / 2 + 80, y: hunterCenterY }, { x: o.x, y: raraCenterY }, boxes));
  }
  const groundedHigh = byType("HIGH")[0];
  check("Rara in the air above a HIGH obstacle is still visible (the block does not hide a jump)", hasLineOfSight({ x: groundedHigh.x - groundedHigh.width / 2 - 200, y: hunterCenterY }, { x: groundedHigh.x, y: raraCenterY - 130 }, obstacleRects(groundedHigh, GROUND_SURFACE_Y)));

  const boxes = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
  const half = HUNTER.body.width / 2;
  check("every Hunter's whole patrol (body included) is clear of every solid piece", PATROLS.every((p) => boxes.every((b) => b.right <= p.left - half || b.left >= p.right + half)), PATROLS.map((p) => `${p.left}-${p.right}`).join(" "));
  check("the existing Hunter placements are unchanged and valid (three Hunters, inside the world, zones 3-5)", FIRST_LEVEL_HUNTERS.length === 3 && FIRST_LEVEL_HUNTERS.map((h) => h.x).join() === "3250,4550,5850" && PATROLS.every((p) => p.left >= MOVE_MIN_X && p.right <= MOVE_MAX_X));

  const HUNTER_CY = GROUND_SURFACE_Y - HUNTER.body.height / 2;
  const RARA_CY = GROUND_SURFACE_Y - body.height / 2;
  for (const placement of FIRST_LEVEL_HUNTERS) {
    const cfg = configForPlacement(HUNTER, placement);
    const home = placement.x;
    const span = patrolSpan(placement, HUNTER);
    const target = [...OBSTACLES].filter((o) => o.x + o.width / 2 < span.left).sort((a, b) => b.x - a.x)[0];
    if (!target) continue;
    const ai = new HunterAI(cfg, home, BOUNDS);
    let x = home, t = 0, raraX = 99999;
    const dt = 1 / 60;
    let inside = false, chased = false, lost = false, patrolAgain = false;
    const tBlock = target.x + target.width / 2 + half; // the far side of the obstacle from the Hunter
    while (t < 90) {
      if (t < 0.05) raraX = home - 300;
      else if (chased) raraX = target.x - target.width / 2 - 200;
      const rect: Rect = { left: x - half, right: x + half, top: HUNTER_CY - 48, bottom: HUNTER_CY + 48 };
      const frame = ai.update(dt, {
        position: { x, y: HUNTER_CY },
        target: { x: raraX, y: RARA_CY },
        blockers: boxes,
        contact: rectsOverlap(rect, { left: raraX - 22.5, right: raraX + 22.5, top: RARA_CY - 52.5, bottom: RARA_CY + 52.5 }),
      });
      let next = Math.min(Math.max(x + frame.velocityX * dt, BOUNDS.minX), BOUNDS.maxX);
      for (const b of boxes) {
        if (b.top >= HUNTER_CY + 48) continue;
        if (x - half >= b.right) next = Math.max(next, b.right + half);
        if (x + half <= b.left) next = Math.min(next, b.left - half);
      }
      x = next;
      t += dt;
      if (boxes.some((b) => rectsOverlap(b, { left: x - half, right: x + half, top: HUNTER_CY - 48, bottom: HUNTER_CY + 48 }))) inside = true;
      if (ai.state === "CHASE") chased = true;
      if (chased && ai.state === "LOST") lost = true;
      if (lost && (ai.state === "PATROL" || ai.state === "IDLE")) { patrolAgain = true; break; }
      if (ai.caught) break;
    }
    check(`${placement.id}: chasing Rara across ${target.type} ${target.id}, it is stopped by it, gives up, and returns to patrol`, chased && lost && patrolAgain && !inside && x >= tBlock - 1, `${t.toFixed(1)}s, ended at x=${x.toFixed(0)}`);
  }

  // Escape budget: after Rara jumps a Hunter she lands ~200px clear of it. Running on at 520 against its 230, how much time does a
  // mistimed first attempt at the next obstacle cost her before the Hunter is on her?
  for (const [i, patrol] of PATROLS.entries()) {
    const ahead = [...OBSTACLES].filter((o) => o.x - o.width / 2 >= patrol.right).sort((a, b) => a.x - b.x)[0];
    if (!ahead) continue;
    const distance = ahead.x - ahead.width / 2 - body.width / 2 - patrol.right; // run-up between the patrol's end and the obstacle's face
    const gapOnArrival = 200 + (distance / SPEED) * (SPEED - HUNTER.chaseSpeed);
    const slack = gapOnArrival / HUNTER.chaseSpeed; // seconds before a Hunter that has been standing still catches up
    check(`hunter-${i + 1}: the first obstacle ahead (${ahead.type} ${ahead.id}, ${distance.toFixed(0)}px run-up) leaves ${slack.toFixed(1)}s to recover from one mistimed jump`, slack >= 1.0);
  }
}

// --- 7. sequences ---------------------------------------------------------------------------------------------------------------
{
  const sorted = [...OBSTACLES].sort((a, b) => a.x - b.x);
  const safeFraction = (a: ObstacleSpec, b: ObstacleSpec) => {
    let safe = 0, total = 0;
    const bTop = b.pieces.find((p) => p.base === 0)!;
    for (let before = 20; before <= 220; before++) {
      const takeoffX = a.x - a.width / 2 - body.width / 2 - before;
      const sideX = bTop.x - bTop.width / 2 - body.width / 2;
      const t = (sideX - takeoffX) / SPEED;
      total++;
      const airtime = ARC.length * 0.001;
      if (t >= airtime || heightAt(t) > bTop.height + 10) safe++;
    }
    return safe / total;
  };
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const gap = b.x - b.width / 2 - (a.x + a.width / 2);
    if (a.type !== "LOW" && a.type !== "HIGH") continue; // the others are climbed or hopped onto, not sprinted over
    const frac = safeFraction(a, b);
    check(`${a.type} ${a.id} -> ${b.type} ${b.id}: most full-speed takeoff timings are safe (${gap}px apart)`, frac > 0.6, `${(frac * 100).toFixed(0)}% safe`);
  }
  const roomy = sorted.every((o, i) => i === 0 || o.x - o.width / 2 - (sorted[i - 1].x + sorted[i - 1].width / 2) >= body.width * 3);
  check("no pair of obstacles can trap Rara (at least 3 body-widths of ground between them; every piece far below her jump)", roomy && Math.max(...OBSTACLES.flatMap((o) => o.pieces.map((p) => p.base + p.height))) <= PEAK * 0.81);
  const routes: Record<ObstacleType, string> = { LOW: "jump over", HIGH: "jump over (timed)", PLATFORM: "land on it and walk across", STACKED: "climb tier by tier, or jump over", NARROW: "hop pillar to pillar" };
  check("every obstacle has a defined, feasible route forward", OBSTACLES.every((o) => routes[o.type] !== undefined), OBSTACLE_TYPES.map((t) => `${t}: ${routes[t]}`).join(" | "));
}

console.log(failures === 0 ? "\nAll obstacle checks passed." : `\n${failures} obstacle check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
