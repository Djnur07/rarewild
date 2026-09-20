/**
 * Validation for the obstacle layout and the rules that keep it playable. No
 * browser: the layout is checked against the level constants and the real
 * movement/Hunter configuration, the jump arc is integrated from the movement
 * tuning, and the Hunter AI is run against the real obstacle boxes.
 *
 *   node scripts/obstacles/validate-obstacles.ts
 */

import { DEFAULT_HUNTER_CONFIG as HUNTER, DEFAULT_HUNTER_SPAWN } from "../../lib/hunter/config.ts";
import { hasLineOfSight, rectsOverlap } from "../../lib/hunter/DetectionSystem.ts";
import { HunterAI } from "../../lib/hunter/HunterAI.ts";
import { resolveHunterSpawnX } from "../../lib/hunter/spawn.ts";
import {
  CHARACTER_SCALE, GROUND_SURFACE_Y, HAZARD_X, MOVE_MAX_X, MOVE_MIN_X, PLAYER_START_X, SEED_X,
} from "../../lib/level/constants.ts";
import type { Rect } from "../../lib/level/geometry.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import {
  FIRST_LEVEL_OBSTACLES as OBSTACLES, OBSTACLE_RULES, isClearOfObstacles, obstacleRect, validateObstacleLayout,
  type LayoutContext,
} from "../../lib/obstacles/placement.ts";
import type { ObstacleSpec } from "../../lib/obstacles/types.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const BOUNDS = { minX: MOVE_MIN_X, maxX: MOVE_MAX_X };
const hunterX = resolveHunterSpawnX(DEFAULT_HUNTER_SPAWN, PLAYER_START_X, BOUNDS);
const CTX: LayoutContext = {
  bounds: BOUNDS,
  playerStartX: PLAYER_START_X,
  keepClearOf: [
    { label: "existing seed pickup", x: SEED_X },
    { label: "existing hazard", x: HAZARD_X },
  ],
  patrol: { left: hunterX - HUNTER.patrolRadius, right: hunterX + HUNTER.patrolRadius },
};
const body = bodySize(CHARACTER_SCALE);

// --- the shipped layout obeys every rule --------------------------------------------------------
{
  const problems = validateObstacleLayout(OBSTACLES, CTX);
  check("the first-level layout satisfies every placement rule", problems.length === 0, problems.join("; "));
  check("a small controlled set (3-6 obstacles, not random)", OBSTACLES.length >= 3 && OBSTACLES.length <= 6, `${OBSTACLES.length} obstacles`);
  const [first] = [...OBSTACLES].sort((a, b) => a.x - b.x);
  check("nothing on or near Rara's starting position", OBSTACLES.every((o) => Math.abs(o.x - PLAYER_START_X) >= OBSTACLE_RULES.minDistanceFromStart), `nearest at x=${first.x}`);
  check("the Hunter's whole patrol route is free of obstacles", OBSTACLES.every((o) => o.x + o.width / 2 < CTX.patrol.left || o.x - o.width / 2 > CTX.patrol.right), `route ${CTX.patrol.left}-${CTX.patrol.right}`);
}

// --- the rules really catch bad layouts (so a future edit can't quietly break the level) ------------
{
  const bad = (spec: ObstacleSpec[]) => validateObstacleLayout(spec, CTX).length > 0;
  const ok: ObstacleSpec = { id: "t", kind: "rock", x: 1000, width: 60, height: 60 };
  check("rules: a valid single obstacle passes", !bad([ok]));
  check("rules: on the player's start is rejected", bad([{ ...ok, x: PLAYER_START_X }]) && bad([{ ...ok, x: PLAYER_START_X + 100 }]));
  check("rules: outside the world is rejected", bad([{ ...ok, x: 20 }]) && bad([{ ...ok, x: 2390 }]));
  check("rules: too low (would not block sight) or too tall is rejected", bad([{ ...ok, height: 40 }]) && bad([{ ...ok, height: 100 }]));
  check("rules: too wide or too narrow is rejected", bad([{ ...ok, width: 200 }]) && bad([{ ...ok, width: 10 }]));
  check("rules: two obstacles too close together are rejected", bad([ok, { ...ok, id: "u", x: 1080 }]));
  check("rules: two obstacles with room between them pass", !bad([{ ...ok, x: 800 }, { ...ok, id: "u", x: 1060 }]));
  check("rules: on the existing seed or hazard is rejected", bad([{ ...ok, x: SEED_X }]) && bad([{ ...ok, x: HAZARD_X }]));
  check("rules: blocking the Hunter's patrol route is rejected", bad([{ ...ok, x: hunterX }]) && bad([{ ...ok, x: CTX.patrol.left - 50 }]));
  check("rules: duplicate ids are rejected", bad([ok, { ...ok, x: 2000 }]));
}

// --- geometry: solid boxes standing on the ground ----------------------------------------------------
{
  const rects = OBSTACLES.map((o) => obstacleRect(o, GROUND_SURFACE_Y));
  check("every obstacle stands exactly on the ground surface", rects.every((r) => r.bottom === GROUND_SURFACE_Y));
  check("box size matches the spec (what is drawn is what collides)", OBSTACLES.every((o, i) => rects[i].right - rects[i].left === o.width && rects[i].bottom - rects[i].top === o.height));
  check("no two obstacle boxes overlap", rects.every((a, i) => rects.every((b, j) => i === j || !rectsOverlap(a, b))));
  check("helper: isClearOfObstacles agrees with the boxes", !isClearOfObstacles(770, 10, OBSTACLES) && isClearOfObstacles(500, 10, OBSTACLES) && !isClearOfObstacles(770 + 30 + 5, 10, OBSTACLES));
}

// --- jumpability: integrate Rara's real jump arc ---------------------------------------------------------
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
{
  const arc = jumpArc();
  const peak = Math.max(...arc.map((a) => a.h));
  check("Rara's jump peak comes from the movement tuning (about 134-140px)", peak > 130 && peak < 145, `${peak.toFixed(0)}px`);
  const tallest = Math.max(...OBSTACLES.map((o) => o.height));
  check("even the tallest obstacle is clearable with a wide margin (jump peak >= 1.8x its height)", peak >= 1.8 * tallest, `${tallest}px vs ${peak.toFixed(0)}px`);
  check("Rara can land on top of every obstacle and jump again (peak clears height + 30px)", OBSTACLES.every((o) => peak >= o.height + 30));

  // Running at top speed and jumping: how far she travels while her feet are above the obstacle's top.
  const speed = MOVE.maxRunSpeed;
  for (const o of OBSTACLES) {
    const above = arc.filter((a) => a.h > o.height).length * 0.001;
    const span = above * speed;
    const need = o.width + body.width; // her whole body must be past the whole obstacle
    check(`${o.id}: a running jump stays above it long enough to clear it (${span.toFixed(0)}px of travel over it, needs ${need.toFixed(0)}px)`, span >= need * 1.6);
  }
  // A slower, careful jump: still enough hang time above the tallest obstacle to land on top of it.
  const tallestH = Math.max(...OBSTACLES.map((o) => o.height));
  check("hang time above the tallest obstacle is comfortable (over 0.4s)", arc.filter((a) => a.h > tallestH).length * 0.001 > 0.4);
}

// --- a running jump over one obstacle never slams into the side of the next ----------------------------------------
{
  const arc = jumpArc();
  const airtime = arc.length * 0.001;
  const heightAt = (t: number) => arc[Math.min(arc.length - 1, Math.max(0, Math.round(t * 1000) - 1))].h;
  const sorted = [...OBSTACLES].sort((a, b) => a.x - b.x);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    // Take off at full speed just before the first obstacle. When her body's front reaches the next obstacle's
    // side she has either already landed, or is still above its top (so she lands on it / clears it).
    const takeoffX = a.x - a.width / 2 - body.width / 2 - 20;
    const sideX = b.x - b.width / 2 - body.width / 2;
    const t = (sideX - takeoffX) / MOVE.maxRunSpeed;
    const safe = t >= airtime || heightAt(t) > b.height + 10;
    check(`${a.id} -> ${b.id}: a full-speed jump from just before ${a.id} does not hit the side of ${b.id}`, safe, t >= airtime ? "lands first" : `still ${heightAt(t).toFixed(0)}px up vs ${b.height}px obstacle`);
  }
  // How forgiving is the spacing? Of every takeoff point from 20px to 220px before the first obstacle (1px steps,
  // full speed), what fraction never clips the side of the second obstacle?
  const safeFraction = (a: { x: number; width: number }, b: { x: number; width: number; height: number }) => {
    let safe = 0, total = 0;
    for (let before = 20; before <= 220; before++) {
      const takeoffX = a.x - a.width / 2 - body.width / 2 - before;
      const sideX = b.x - b.width / 2 - body.width / 2;
      const t = (sideX - takeoffX) / MOVE.maxRunSpeed;
      total++;
      if (t >= airtime || heightAt(t) > b.height + 10) safe++;
    }
    return safe / total;
  };
  for (let i = 0; i + 1 < sorted.length; i++) {
    const frac = safeFraction(sorted[i], sorted[i + 1]);
    check(`${sorted[i].id} -> ${sorted[i + 1].id}: most full-speed takeoff timings are safe (over 60%)`, frac > 0.6, `${(frac * 100).toFixed(0)}% safe`);
  }
  // A clip is never a trap: the ground between two obstacles is wide enough to stand in, and she can always jump out.
  const roomy = sorted.every((o, i) => i === 0 || o.x - o.width / 2 - (sorted[i - 1].x + sorted[i - 1].width / 2) >= body.width * 3);
  check("no obstacle pair can trap Rara (room between them is at least 3 body-widths, and every obstacle is far below her jump height)", roomy && Math.max(...OBSTACLES.map((o) => o.height)) * 1.8 <= Math.max(...arc.map((a) => a.h)));
}

// --- sight lines (the Hunter reads every solid, obstacles included) ---------------------------------------
{
  const hunterCenterY = GROUND_SURFACE_Y - HUNTER.body.height / 2;
  const raraCenterY = GROUND_SURFACE_Y - body.height / 2;
  for (const o of OBSTACLES) {
    const r = obstacleRect(o, GROUND_SURFACE_Y);
    const boxes: Rect[] = [r];
    const left = { x: r.left - 60, y: hunterCenterY };
    const right = { x: r.right + 60, y: raraCenterY };
    check(`${o.id}: Rara standing right behind it is hidden from the Hunter`, !hasLineOfSight(left, right, boxes));
    // Rara at the top of a jump, directly over the obstacle, seen by a Hunter standing 200px away on the ground.
    check(`${o.id}: Rara in the air above it is visible`, hasLineOfSight({ x: r.left - 200, y: hunterCenterY }, { x: o.x, y: raraCenterY - 130 }, boxes));
  }
  const lowLog: Rect = { left: 500, right: 560, top: GROUND_SURFACE_Y - 34, bottom: GROUND_SURFACE_Y };
  check("why the 56px minimum: a 34px obstacle would NOT hide Rara (the Hunter would stare across it, stuck)", hasLineOfSight({ x: 440, y: hunterCenterY }, { x: 620, y: raraCenterY }, [lowLog]));
}

// --- Hunter + obstacles: no pathfinding, but it must never get trapped or pass through ----------------------
{
  const HUNTER_CY = GROUND_SURFACE_Y - HUNTER.body.height / 2;
  const RARA_CY = GROUND_SURFACE_Y - body.height / 2;
  const boxes = OBSTACLES.map((o) => obstacleRect(o, GROUND_SURFACE_Y));
  const half = HUNTER.body.width / 2;
  for (const target of OBSTACLES.filter((o) => o.x < hunterX)) {
    const ai = new HunterAI(HUNTER, hunterX, BOUNDS);
    let x = hunterX;
    let t = 0;
    const dt = 1 / 60;
    let raraX = 3000;
    let inside = false, chased = false, lost = false, patrolAgain = false;
    const tBlock = target.x + target.width / 2 + half; // the far side of the obstacle from the Hunter
    while (t < 60) {
      if (t < 0.05) raraX = hunterX - 300; // Rara appears in front of the Hunter
      else if (chased) raraX = target.x - target.width / 2 - 200; // ... then stands 200px beyond the obstacle
      const rect: Rect = { left: x - half, right: x + half, top: HUNTER_CY - 48, bottom: HUNTER_CY + 48 };
      const frame = ai.update(dt, {
        position: { x, y: HUNTER_CY },
        target: { x: raraX, y: RARA_CY },
        blockers: boxes,
        contact: rectsOverlap(rect, { left: raraX - 22.5, right: raraX + 22.5, top: RARA_CY - 52.5, bottom: RARA_CY + 52.5 }),
      });
      let next = Math.min(Math.max(x + frame.velocityX * dt, BOUNDS.minX), BOUNDS.maxX);
      for (const b of boxes) if (x - half >= b.right) next = Math.max(next, b.right + half);
      x = next;
      t += dt;
      if (boxes.some((b) => rectsOverlap(b, { left: x - half, right: x + half, top: HUNTER_CY - 48, bottom: HUNTER_CY + 48 }))) inside = true;
      if (ai.state === "CHASE") chased = true;
      if (chased && ai.state === "LOST") lost = true;
      if (lost && (ai.state === "PATROL" || ai.state === "IDLE")) { patrolAgain = true; break; }
      if (ai.caught) break;
    }
    check(`${target.id}: chasing across it, the Hunter is stopped by it, gives up, and returns to patrol`, chased && lost && patrolAgain && !inside && x >= tBlock - 1, `${t.toFixed(1)}s, ended at x=${x.toFixed(0)}`);
  }
}

console.log(failures === 0 ? "\nAll obstacle checks passed." : `\n${failures} obstacle check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
