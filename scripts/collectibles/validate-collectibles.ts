/**
 * Validation for the collectible layout and the collecting rules (count,
 * collect-once, reset on restart). No browser: the rules are pure, so they are
 * exercised directly with Rara's real body size and the real jump arc.
 *
 *   node scripts/collectibles/validate-collectibles.ts
 */

import { COLLECTIBLE_RADIUS, PICKUP_FORGIVENESS } from "../../lib/collectibles/config.ts";
import { CollectibleTracker } from "../../lib/collectibles/CollectibleTracker.ts";
import { FIRST_LEVEL_COLLECTIBLES as ITEMS, collectibleCenter, requiredJumpHeight } from "../../lib/collectibles/placement.ts";
import { DEFAULT_HUNTER_CONFIG as HUNTER, DEFAULT_HUNTER_SPAWN } from "../../lib/hunter/config.ts";
import { resolveHunterSpawnX } from "../../lib/hunter/spawn.ts";
import {
  CHARACTER_SCALE, GROUND_SURFACE_Y, HAZARD_X, MOVE_MAX_X, MOVE_MIN_X, PLAYER_START_X, SEED_X,
} from "../../lib/level/constants.ts";
import { circleIntersectsRect, type Rect } from "../../lib/level/geometry.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import { FIRST_LEVEL_OBSTACLES as OBSTACLES, obstacleRect } from "../../lib/obstacles/placement.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const body = bodySize(CHARACTER_SCALE);
const R = COLLECTIBLE_RADIUS;
const peak = MOVE.jumpVelocity ** 2 / (2 * MOVE.gravity); // theoretical peak of a held jump (~140px); measured ~134
const centers = ITEMS.map((i) => ({ spec: i, ...collectibleCenter(i, GROUND_SURFACE_Y) }));

/** Rara's body box when standing on a surface at `standY`, lifted `lift` px into the air, at centre x. */
const bodyAt = (x: number, lift = 0, standY = GROUND_SURFACE_Y): Rect => ({
  left: x - body.width / 2,
  right: x + body.width / 2,
  top: standY - lift - body.height,
  bottom: standY - lift,
});
const newTracker = () => new CollectibleTracker(centers.map((c) => ({ id: c.spec.id, x: c.x, y: c.y })), R);

// --- layout -----------------------------------------------------------------------------------------
{
  const ids = ITEMS.map((i) => i.id);
  check("a first level of 10-16 collectibles with unique ids", ITEMS.length >= 10 && ITEMS.length <= 16 && new Set(ids).size === ids.length, `${ITEMS.length} items`);
  check("all items are inside the playable world", ITEMS.every((i) => i.x >= MOVE_MIN_X && i.x <= MOVE_MAX_X));
  const boxes = OBSTACLES.map((o) => obstacleRect(o, GROUND_SURFACE_Y));
  check("no item is inside (or touching) a solid obstacle", centers.every((c) => boxes.every((b) => !circleIntersectsRect(c.x, c.y, R, b))));
  check("no item sits inside the ground", centers.every((c) => c.y + R < GROUND_SURFACE_Y));
  const xs = ITEMS.map((i) => i.x).sort((a, b) => a - b);
  check("items are spread out (at least 90px apart)", xs.every((x, i) => i === 0 || x - xs[i - 1] >= 90), `closest ${Math.min(...xs.slice(1).map((x, i) => x - xs[i]))}px`);
  check("spread across the level (first in the start area, last near the end)", xs[0] <= PLAYER_START_X && xs.at(-1)! >= 2200);
  check("nothing on top of Rara's start, and clear of the existing seed and hazard", ITEMS.every((i) => Math.abs(i.x - PLAYER_START_X) >= 100 && Math.abs(i.x - SEED_X) >= 80 && Math.abs(i.x - HAZARD_X) >= 80));
  const tiers = { ground: 0, hop: 0, high: 0 };
  for (const i of ITEMS) tiers[i.tier]++;
  check("a mix: mostly easy, a few hops near obstacles, only a couple that need a good jump", tiers.ground >= 5 && tiers.hop >= 3 && tiers.high >= 1 && tiers.high <= 3 && tiers.ground + tiers.hop >= ITEMS.length * 0.75, JSON.stringify(tiers));
  const hopsOk = ITEMS.filter((i) => i.tier === "hop").every((i) => OBSTACLES.some((o) => Math.abs(o.x - i.x) <= 8 && i.lift >= o.height + 60 && i.lift <= o.height + 80));
  check("hop items float just above an obstacle (they reward jumping over it)", hopsOk);
  const nearObstacle = ITEMS.filter((i) => OBSTACLES.some((o) => Math.abs(o.x - i.x) < 130)).length;
  check("several items sit near obstacles to encourage jumping", nearObstacle >= 4, `${nearObstacle} items`);
  const huntSpan = { left: resolveHunterSpawnX(DEFAULT_HUNTER_SPAWN, PLAYER_START_X, { minX: MOVE_MIN_X, maxX: MOVE_MAX_X }) - HUNTER.patrolRadius, right: 0 };
  huntSpan.right = huntSpan.left + 2 * HUNTER.patrolRadius;
  check("there is a risk/reward item in the Hunter's area", ITEMS.some((i) => i.x >= huntSpan.left - 150 && i.x <= huntSpan.right + 150));
}

// --- reach: every item can be collected with the real body and the real jump -----------------------------------
{
  check("rock-height jump arc peaks near 140px (from the movement tuning)", peak > 135 && peak < 145, `${peak.toFixed(0)}px`);
  for (const c of centers) {
    const need = requiredJumpHeight(c.spec.lift, body.height);
    const easy = c.spec.tier === "ground" ? need === 0 : c.spec.tier === "hop" ? need <= 40 : need >= 40 && need <= 0.8 * peak;
    check(`${c.spec.id} (${c.spec.tier}): ${need === 0 ? "walk into it" : `needs a ${need.toFixed(0)}px jump`} - not difficult`, easy && need <= 0.8 * peak);
  }
  // The closed-form requirement really matches the geometry used by the tracker.
  const agrees = centers.every((c) => {
    const need = requiredJumpHeight(c.spec.lift, body.height);
    const t = newTracker();
    const below = need > 1 ? t.collect(bodyAt(c.x, need - 1)).includes(c.spec.id) : false;
    const t2 = newTracker();
    const at = t2.collect(bodyAt(c.x, need + 1)).includes(c.spec.id);
    return !below && at;
  });
  check("requiredJumpHeight() agrees with the actual pickup geometry (just below: no, just above: yes)", agrees);
}

// --- collecting rules ---------------------------------------------------------------------------------------------
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

  const highItem = centers.find((c) => c.spec.tier === "high")!;
  const tHigh = newTracker();
  check("a high item is not collected by a tiny hop", tHigh.collect(bodyAt(highItem.x, 20)).length === 0);
  check("...but is collected near the top of a full jump", tHigh.collect(bodyAt(highItem.x, 0.95 * peak)).includes(highItem.spec.id));

  // Standing on an obstacle collects the hop item above it (a second way to reach it).
  const rock = OBSTACLES.find((o) => o.id === "rock-1")!;
  const rockTop = obstacleRect(rock, GROUND_SURFACE_Y).top;
  const tTop = newTracker();
  check("standing on top of an obstacle collects the item above it", tTop.collect(bodyAt(rock.x, 0, rockTop)).some((id) => id === "c03"));

  // The whole level: pass each item once (jumping only where needed) and count them all.
  const all = newTracker();
  let counted = 0;
  const counts: number[] = [];
  for (const c of centers) {
    const need = requiredJumpHeight(c.spec.lift, body.height);
    all.collect(bodyAt(c.x, need > 0 ? need + 4 : 0));
    counts.push(all.count);
    counted++;
  }
  check("collecting every item one by one counts up 1,2,3... to the total", counts.every((n, i) => n === i + 1) && all.count === all.total && counted === ITEMS.length, counts.join(","));
  check("everything collected: nothing left to collect", all.collect(bodyAt(centers[0].x)).length === 0 && all.count === ITEMS.length);

  // Restart.
  all.reset();
  check("restart: counter back to zero", all.count === 0 && all.total === ITEMS.length);
  check("restart: every item can be collected again", all.collect(bodyAt(firstGround.x)).length === 1 && all.count === 1);

  // Two items touched in one frame both count (dense layouts, wide body).
  const dense = new CollectibleTracker([{ id: "a", x: 100, y: 440 }, { id: "b", x: 120, y: 440 }, { id: "far", x: 900, y: 440 }], R);
  check("two items touched in the same frame are both collected, once each", JSON.stringify(dense.collect(bodyAt(110))) === '["a","b"]' && dense.count === 2);
  check("deterministic: ids come back in layout order", JSON.stringify(newTracker().collect({ left: 0, right: 3000, top: 0, bottom: 600 })) === JSON.stringify(ITEMS.map((i) => i.id)));
  // Forgiveness: an item (radius R) is collected when Rara's box comes within R + PICKUP_FORGIVENESS of its centre.
  const reach = R + PICKUP_FORGIVENESS;
  const boxEndingAt = (right: number): Rect => ({ left: right - body.width, right, top: 380, bottom: 482.5 });
  const lone = () => new CollectibleTracker([{ id: "x", x: 200, y: 440 }], R);
  check("forgiveness: an item just inside the pickup reach is collected", lone().collect(boxEndingAt(200 - reach + 1)).length === 1);
  check("forgiveness: an item just outside the pickup reach is not", lone().collect(boxEndingAt(200 - reach - 1)).length === 0);
}

console.log(failures === 0 ? "\nAll collectible checks passed." : `\n${failures} collectible check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
