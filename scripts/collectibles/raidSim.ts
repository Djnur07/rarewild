/**
 * A small headless world for the collectible validator: Rara (the real CharacterMotor) and a Hunter (the
 * real HunterAI) on the real level geometry, stepped at a fixed frame rate (60 or 30fps) with plain axis-separated box collision
 * standing in for Arcade physics. A "raid" is a scripted run at one item: approach, collect, retreat.
 * It is deterministic (no randomness, no clocks), so a layout either survives it or it does not.
 *
 * The bot is deliberately simple and honest: it runs toward a target and jumps when a wall is close
 * ahead, like a player who is not trying to be clever. It sweeps the Hunter's whole patrol cycle (every
 * phase the Hunter can be in when Rara arrives), so "no capture" means no capture at ANY timing.
 */

import { DEFAULT_HUNTER_CONFIG as HUNTER } from "../../lib/hunter/config.ts";
import { rectsOverlap } from "../../lib/hunter/DetectionSystem.ts";
import { HunterAI } from "../../lib/hunter/HunterAI.ts";
import type { Rect } from "../../lib/hunter/types.ts";
import { CollectibleTracker } from "../../lib/collectibles/CollectibleTracker.ts";
import { COLLECTIBLE_RADIUS } from "../../lib/collectibles/config.ts";
import { CHARACTER_SCALE, GROUND_SURFACE_Y, MOVE_MAX_X, MOVE_MIN_X, WORLD_WIDTH } from "../../lib/level/constants.ts";
import { CharacterMotor } from "../../lib/movement/CharacterMotor.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import { FIRST_LEVEL_OBSTACLES } from "../../lib/obstacles/placement.ts";
import { obstacleRects } from "../../lib/obstacles/shapes.ts";
import type { HunterPlacement } from "../../lib/hunter/placement.ts";
import { configForPlacement } from "../../lib/hunter/placement.ts";

const body = bodySize(CHARACTER_SCALE);
const HUNTER_CY = GROUND_SURFACE_Y - HUNTER.body.height / 2;
const HUNTER_HALF_W = HUNTER.body.width / 2;
const HUNTER_HALF_H = HUNTER.body.height / 2;
/** The whole solid level: every obstacle piece (ground excluded), as Rara and the Hunters collide with it. */
export const SOLIDS: readonly Rect[] = FIRST_LEVEL_OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
/** The same list plus the ground slab, which is what the Hunter's line of sight is tested against. */
const BLOCKERS: readonly Rect[] = [...SOLIDS, { left: 0, right: WORLD_WIDTH, top: GROUND_SURFACE_Y, bottom: 600 }];

export interface RaidStep {
  /** Where to run. The step is done when Rara's centre is within `tolerance` of it (and, if given, `item` is collected). */
  toX: number;
  /** Stay still this long before moving (lets the Hunter's phase move on while she waits, hidden). */
  waitSeconds?: number;
  tolerance?: number;
  /** The step is done the moment the raid's item is collected (a player turns back as soon as the counter ticks), wherever she is. */
  untilCollected?: boolean;
  /** Jump (once, on the floor) when the run passes this x moving in the step's direction. */
  jumpAtX?: number;
}

export interface Raid {
  /** Rara's start x. */
  startX: number;
  steps: readonly RaidStep[];
  /** The item that has to be collected during the raid. */
  itemId: string;
  /** End the raid as soon as the item is collected (used for plain reach checks with no retreat). */
  stopOnCollect?: boolean;
  /** Hunters in play (the raid only needs the nearby one, but all are simulated for honesty). */
  hunters: readonly HunterPlacement[];
}

export interface RaidResult {
  collected: boolean;
  caught: boolean;
  finished: boolean;
  seconds: number;
  /** The Hunter states seen (to tell "it never noticed her" from "it did, and she still got away"). */
  noticed: boolean;
  minGap: number;
}

class Body {
  velocity = { x: 0, y: 0 };
  gravity = { y: 0 };
  onFloorFlag = false;
  onFloor() {
    return this.onFloorFlag;
  }
}

/** Run one raid with the Hunters `phase` seconds into their patrols. */
export function runRaid(raid: Raid, items: readonly { id: string; x: number; y: number }[], phase: number, hz = 60, maxSeconds = 25): RaidResult {
  const DT = 1 / hz;
  const bounds = { minX: MOVE_MIN_X, maxX: MOVE_MAX_X };
  const hunters = raid.hunters.map((p) => {
    const config = configForPlacement(HUNTER, p);
    return { ai: new HunterAI(config, p.x, bounds), x: p.x };
  });

  // Rara.
  const rara = new Body();
  const motor = new CharacterMotor(rara, MOVE, 0);
  let rx = raid.startX;
  let feet = GROUND_SURFACE_Y;
  let jumpWasHeld = false;
  const tracker = new CollectibleTracker(items, COLLECTIBLE_RADIUS);
  const raraRect = (): Rect => ({ left: rx - body.width / 2, right: rx + body.width / 2, top: feet - body.height, bottom: feet });

  let t = 0;
  let stepIndex = 0;
  let stepClock = 0;
  let jumpedInStep = false;
  let caught = false;
  let noticed = false;
  let minGap = Infinity;
  let now = 0;

  const advanceHunters = (rectR: Rect) => {
    for (const h of hunters) {
      const rect: Rect = { left: h.x - HUNTER_HALF_W, right: h.x + HUNTER_HALF_W, top: HUNTER_CY - HUNTER_HALF_H, bottom: HUNTER_CY + HUNTER_HALF_H };
      const center = { x: (rectR.left + rectR.right) / 2, y: (rectR.top + rectR.bottom) / 2 };
      const frame = h.ai.update(DT, { position: { x: h.x, y: HUNTER_CY }, target: center, blockers: BLOCKERS, contact: rectsOverlap(rect, rectR, HUNTER.contactInset) });
      if (frame.caught) caught = true;
      if (frame.state === "ALERT" || frame.state === "CHASE") noticed = true;
      const before = h.x;
      let next = Math.min(Math.max(h.x + frame.velocityX * DT, bounds.minX), bounds.maxX);
      for (const wall of SOLIDS) {
        if (before + HUNTER_HALF_W <= wall.left) next = Math.min(next, wall.left - HUNTER_HALF_W);
        else if (before - HUNTER_HALF_W >= wall.right) next = Math.max(next, wall.right + HUNTER_HALF_W);
      }
      h.x = next;
      minGap = Math.min(minGap, Math.abs(h.x - center.x) - HUNTER_HALF_W - body.width / 2);
    }
  };

  // The Hunters' patrols are already `phase` seconds along when Rara starts moving (she waits out of sight at the start).
  for (let s = 0; s < phase; s += DT) advanceHunters({ left: -100, right: -50, top: 0, bottom: 10 });
  caught = false;
  noticed = false;
  minGap = Infinity;

  while (t < maxSeconds && !caught && stepIndex < raid.steps.length) {
    const step = raid.steps[stepIndex];
    const tolerance = step.tolerance ?? 6;
    const dx = step.toX - rx;
    const waiting = stepClock < (step.waitSeconds ?? 0);
    const dir = Math.abs(dx) <= tolerance || waiting ? 0 : Math.sign(dx);
    const grounded = rara.onFloor();

    // Jump: a wall close ahead that is above her feet, or the step's explicit jump point.
    let wantJump = false;
    if (grounded && !waiting && dir !== 0) {
      const ahead = SOLIDS.some((w) => {
        const gap = dir > 0 ? w.left - (rx + body.width / 2) : rx - body.width / 2 - w.right;
        return gap >= -2 && gap <= 70 && w.top < feet - 2 && w.bottom > feet - body.height;
      });
      const atPoint = step.jumpAtX !== undefined && !jumpedInStep && (dir > 0 ? rx >= step.jumpAtX : rx <= step.jumpAtX);
      wantJump = ahead || atPoint;
      if (atPoint) jumpedInStep = true;
    }
    if (wantJump) motor.queueJump(now);
    const rising = rara.velocity.y < 0;
    const jumpHeld: boolean = wantJump || (jumpWasHeld && rising);
    jumpWasHeld = jumpHeld;

    motor.update({ moveX: dir as -1 | 0 | 1, jumpHeld }, DT * 1000, now);

    // Arcade-style integration: gravity, then x with wall pushback, then y with landing.
    rara.velocity.y = Math.min(rara.velocity.y + (MOVE.gravity + rara.gravity.y) * DT, MOVE.maxFallSpeed);
    let nx = rx + rara.velocity.x * DT;
    nx = Math.min(Math.max(nx, MOVE_MIN_X), MOVE_MAX_X);
    const rectX: Rect = { left: nx - body.width / 2, right: nx + body.width / 2, top: feet - body.height, bottom: feet };
    for (const w of SOLIDS) {
      if (rectX.bottom <= w.top + 0.01 || rectX.top >= w.bottom - 0.01) continue;
      if (rectX.right > w.left && rectX.left < w.right) {
        if (rx <= (w.left + w.right) / 2) nx = w.left - body.width / 2;
        else nx = w.right + body.width / 2;
        rara.velocity.x = 0;
        rectX.left = nx - body.width / 2;
        rectX.right = nx + body.width / 2;
      }
    }
    rx = nx;
    let ny = feet + rara.velocity.y * DT;
    rara.onFloorFlag = false;
    if (rara.velocity.y >= 0) {
      const floors = [GROUND_SURFACE_Y, ...SOLIDS.filter((w) => rx + body.width / 2 > w.left && rx - body.width / 2 < w.right && feet <= w.top + 0.01).map((w) => w.top)];
      const floor = Math.min(...floors);
      if (ny >= floor) {
        ny = floor;
        rara.velocity.y = 0;
        rara.onFloorFlag = true;
      }
    } else {
      for (const w of SOLIDS) {
        if (rx + body.width / 2 > w.left && rx - body.width / 2 < w.right && feet - body.height >= w.bottom - 0.01 && ny - body.height < w.bottom) {
          ny = w.bottom + body.height;
          rara.velocity.y = 0;
        }
      }
    }
    feet = ny;

    const rect = raraRect();
    tracker.collect(rect);
    advanceHunters(rect);
    if (raid.stopOnCollect && tracker.has(raid.itemId)) return { collected: true, caught, finished: true, seconds: t, noticed, minGap };

    now += DT * 1000;
    t += DT;
    stepClock += DT;
    // A step is done when she is standing (not flying past) at its target, so an item she skims over on the way is still ahead of her.
    const arrived = step.untilCollected ? tracker.has(raid.itemId) : Math.abs(step.toX - rx) <= tolerance && rara.onFloor();
    if (arrived && stepClock >= (step.waitSeconds ?? 0) && (step.jumpAtX === undefined || jumpedInStep || stepClock > 0.2)) {
      stepIndex++;
      stepClock = 0;
      jumpedInStep = false;
    }
  }

  return { collected: tracker.has(raid.itemId), caught, finished: stepIndex >= raid.steps.length, seconds: t, noticed, minGap };
}

/**
 * Sweep the Hunters' patrol phase: the raid starts at each of `count` evenly spaced points of a full
 * patrol cycle (out and back plus both pauses), so every facing and position a Hunter can have is tried.
 */
export function sweepRaid(raid: Raid, items: readonly { id: string; x: number; y: number }[], count = 48, hz = 60) {
  const cycle = 2 * (2 * HUNTER.patrolRadius) / HUNTER.patrolSpeed + 2 * HUNTER.idleDuration; // upper bound of the longest patrol cycle
  const longest = Math.max(...raid.hunters.map((h) => 2 * (2 * (h.patrolRadius ?? HUNTER.patrolRadius)) / HUNTER.patrolSpeed + 2 * HUNTER.idleDuration), cycle);
  const results: (RaidResult & { phase: number })[] = [];
  for (let i = 0; i < count; i++) {
    const phase = (longest * i) / count;
    results.push({ ...runRaid(raid, items, phase, hz), phase });
  }
  return results;
}
