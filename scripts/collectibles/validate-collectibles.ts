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
import { DEFAULT_HUNTER_CONFIG as HUNTER } from "../../lib/hunter/config.ts";
import { FIRST_LEVEL_HUNTERS, patrolSpan } from "../../lib/hunter/placement.ts";
import {
  CHARACTER_SCALE, GROUND_SURFACE_Y, HAZARD_X, MOVE_MAX_X, MOVE_MIN_X, PLAYER_START_X, SEED_X, WORLD_WIDTH,
} from "../../lib/level/constants.ts";
import { circleIntersectsRect, type Rect } from "../../lib/level/geometry.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import { FIRST_LEVEL_OBSTACLES as OBSTACLES } from "../../lib/obstacles/placement.ts";
import { obstacleRects } from "../../lib/obstacles/shapes.ts";

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
const pieces = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
/**
 * The smallest jump (px above whatever she is standing on) that touches the item, over every place her body can be:
 * beside an obstacle on the ground, or on top of it. Where the body overlaps a piece horizontally she must be above that
 * piece's top, so that is her floor there.
 */
const surfaceNeed = (cx: number, cy: number) => {
  const reach = COLLECTIBLE_RADIUS + PICKUP_FORGIVENESS + body.width / 2;
  let best = Infinity;
  for (let x = cx - reach; x <= cx + reach; x += 2) {
    const under = pieces.filter((r) => r.left < x + body.width / 2 && r.right > x - body.width / 2);
    const floor = Math.max(0, ...under.map((r) => GROUND_SURFACE_Y - r.top));
    const itemBottom = GROUND_SURFACE_Y - cy - COLLECTIBLE_RADIUS - PICKUP_FORGIVENESS; // the lowest point of the item's reach, as a height above the ground
    const itemTop = GROUND_SURFACE_Y - cy + COLLECTIBLE_RADIUS + PICKUP_FORGIVENESS;
    if (floor > itemTop) continue; // the item would be inside the surface here
    best = Math.min(best, Math.max(0, itemBottom - body.height - floor));
  }
  return best;
};

const newTracker = () => new CollectibleTracker(centers.map((c) => ({ id: c.spec.id, x: c.x, y: c.y })), R);

// --- layout -----------------------------------------------------------------------------------------
{
  const ids = ITEMS.map((i) => i.id);
  check("a first level of 10-16 collectibles with unique ids", ITEMS.length >= 10 && ITEMS.length <= 16 && new Set(ids).size === ids.length, `${ITEMS.length} items`);
  check("all items are inside the playable world", ITEMS.every((i) => i.x >= MOVE_MIN_X && i.x <= MOVE_MAX_X));
  const boxes = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
  check("no item is inside (or touching) a solid obstacle piece (stack tiers and narrow pillars included)", centers.every((c) => boxes.every((b) => !circleIntersectsRect(c.x, c.y, R, b))));
  check("no item sits inside the ground", centers.every((c) => c.y + R < GROUND_SURFACE_Y));
  const xs = ITEMS.map((i) => i.x).sort((a, b) => a - b);
  check("items are spread out (at least 90px apart)", xs.every((x, i) => i === 0 || x - xs[i - 1] >= 90), `closest ${Math.min(...xs.slice(1).map((x, i) => x - xs[i]))}px`);
  check("spread across the whole journey (first in the start area, last near the far end)", xs[0] <= 700 && xs.at(-1)! >= WORLD_WIDTH * 0.85, `${xs[0]} .. ${xs.at(-1)}`);
  check("nothing on top of Rara's start, and clear of the existing seed and hazard", ITEMS.every((i) => Math.abs(i.x - PLAYER_START_X) >= 100 && Math.abs(i.x - SEED_X) >= 80 && Math.abs(i.x - HAZARD_X) >= 80));
  const tiers = { ground: 0, hop: 0, high: 0 };
  for (const i of ITEMS) tiers[i.tier]++;
  check("a mix: mostly easy, a few hops near obstacles, only a couple that need a good jump", tiers.ground >= 5 && tiers.hop >= 3 && tiers.high >= 1 && tiers.high <= 3 && tiers.ground + tiers.hop >= ITEMS.length * 0.75, JSON.stringify(tiers));
  const hopsOk = ITEMS.filter((i) => i.tier === "hop").every((i) => OBSTACLES.some((o) => i.x >= o.x - o.width / 2 && i.x <= o.x + o.width / 2 && i.lift >= o.height + 60 && i.lift <= o.height + 80));
  check("hop items float just above an obstacle of any type (they reward jumping over or onto it)", hopsOk);
  const nearObstacle = ITEMS.filter((i) => OBSTACLES.some((o) => Math.abs(o.x - i.x) < 130)).length;
  check("several items sit near obstacles to encourage jumping", nearObstacle >= 4, `${nearObstacle} items`);
  const beats = FIRST_LEVEL_HUNTERS.map((h) => patrolSpan(h, HUNTER));
  check("every Hunter's area has a risk/reward item near it", beats.every((p) => ITEMS.some((i) => i.x >= p.left - 450 && i.x <= p.right + 450)), beats.map((p) => ITEMS.filter((i) => i.x >= p.left - 450 && i.x <= p.right + 450).length).join("/"));
}

// --- reach: every item can be collected with the real body and the real jump -----------------------------------
{
  check("rock-height jump arc peaks near 140px (from the movement tuning)", peak > 135 && peak < 145, `${peak.toFixed(0)}px`);
  for (const c of centers) {
    const need = surfaceNeed(c.x, c.y);
    const easy = c.spec.tier === "ground" ? need === 0 : c.spec.tier === "hop" ? need <= 40 : need >= 40 && need <= 0.8 * peak;
    check(`${c.spec.id} (${c.spec.tier}): ${need === 0 ? "walk into it, or reach it standing on the obstacle beneath" : `needs a ${need.toFixed(0)}px jump`} - not difficult`, easy && need <= 0.8 * peak);
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

  // Every hop item can be collected from the obstacle beneath it: by standing on the highest piece under it, or, where it
  // floats over a gap (the passage between narrow pillars), by a jump into that gap.
  for (const item of centers.filter((c) => c.spec.tier === "hop")) {
    const under = pieces.filter((r) => r.left <= item.x && r.right >= item.x);
    const tracker = newTracker();
    if (under.length > 0) {
      const topY = Math.min(...under.map((r) => r.top));
      check(`${item.spec.id}: standing on top of the obstacle beneath it (${(GROUND_SURFACE_Y - topY).toFixed(0)}px up) collects it`, tracker.collect(bodyAt(item.x, 0, topY)).includes(item.spec.id));
    } else {
      // Over a gap: from the floor of the gap itself she needs this much of a jump (she can also reach it from a pillar's edge).
      const lift = GROUND_SURFACE_Y - item.y;
      const slotNeed = Math.max(0, lift - COLLECTIBLE_RADIUS - PICKUP_FORGIVENESS - body.height);
      check(`${item.spec.id}: it floats over a gap between pillars; a ${(slotNeed + 4).toFixed(0)}px jump from the gap floor collects it (or standing on a pillar's edge)`, tracker.collect(bodyAt(item.x, slotNeed + 4)).includes(item.spec.id) && surfaceNeed(item.x, item.y) <= slotNeed);
    }
  }

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
  check("deterministic: ids come back in layout order", JSON.stringify(newTracker().collect({ left: 0, right: WORLD_WIDTH, top: 0, bottom: 600 })) === JSON.stringify(ITEMS.map((i) => i.id)));
  // Forgiveness: an item (radius R) is collected when Rara's box comes within R + PICKUP_FORGIVENESS of its centre.
  const reach = R + PICKUP_FORGIVENESS;
  const boxEndingAt = (right: number): Rect => ({ left: right - body.width, right, top: 380, bottom: 482.5 });
  const lone = () => new CollectibleTracker([{ id: "x", x: 200, y: 440 }], R);
  check("forgiveness: an item just inside the pickup reach is collected", lone().collect(boxEndingAt(200 - reach + 1)).length === 1);
  check("forgiveness: an item just outside the pickup reach is not", lone().collect(boxEndingAt(200 - reach - 1)).length === 0);
}

console.log(failures === 0 ? "\nAll collectible checks passed." : `\n${failures} collectible check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
