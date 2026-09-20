/**
 * Validation for the objective and completion system: the READY / PLAYING /
 * CAUGHT / COMPLETE state machine (the start screen and PLAY), the timer, the exit's locked/open rule, and the
 * exit's placement, all with the real collectible tracker and level layout.
 * No browser needed.
 *
 *   node scripts/objective/validate-objective.ts
 */

import { CollectibleTracker } from "../../lib/collectibles/CollectibleTracker.ts";
import { COLLECTIBLE_RADIUS } from "../../lib/collectibles/config.ts";
import { collectibleCenter, FIRST_LEVEL_COLLECTIBLES as ITEMS, requiredJumpHeight } from "../../lib/collectibles/placement.ts";
import { DEFAULT_HUNTER_CONFIG as HUNTER } from "../../lib/hunter/config.ts";
import { FIRST_LEVEL_HUNTERS, patrolSpan } from "../../lib/hunter/placement.ts";
import { CHARACTER_SCALE, GROUND_SURFACE_Y, MOVE_MAX_X, WORLD_WIDTH } from "../../lib/level/constants.ts";
import { circleIntersectsRect, rectsOverlapArea, type Rect } from "../../lib/level/geometry.ts";
import { EXIT_RESERVE, WATER_SEGMENTS, ZONE_FINAL, zoneAt } from "../../lib/level/zones.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";
import { bodySize } from "../../lib/movement/physicsBody.ts";
import { ObjectiveState, formatTime } from "../../lib/objective/ObjectiveState.ts";
import { EXIT_SPEC, EXIT_TRIGGER_MARGIN, exitRect, exitTriggerRect, touchesExit } from "../../lib/objective/placement.ts";
import { FIRST_LEVEL_OBSTACLES as OBSTACLES } from "../../lib/obstacles/placement.ts";
import { obstacleRects } from "../../lib/obstacles/shapes.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const TOTAL = ITEMS.length;
const body = bodySize(CHARACTER_SCALE);
const peak = MOVE.jumpVelocity ** 2 / (2 * MOVE.gravity);
const run = (state: ObjectiveState, seconds: number, hz = 60) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) state.update(1000 / hz);
};
/** A run that has begun: PLAY pressed at scene time 0. */
const newRun = () => {
  const s = new ObjectiveState(TOTAL);
  s.start(0);
  return s;
};

// --- the start screen: READY --------------------------------------------------------------------------------------
{
  check("the objective is 'collect all 12 and reach the exit': 12 collectibles", TOTAL === 12);
  const s = new ObjectiveState(TOTAL);
  check("new game: READY, timer 0, no start time", s.phase === "READY" && s.elapsedMs === 0 && s.startedAtMs === null);
  check("READY shows 00:00", formatTime(s.elapsedMs) === "00:00");
  run(s, 30);
  check("the timer does NOT run while READY, however long the page sits open", s.elapsedMs === 0 && s.phase === "READY" && s.startedAtMs === null);
  check("touching the exit is ignored in READY (even with 12/12)", s.touchExit(12) === "IGNORED" && s.phase === "READY");
  check("a Hunter catch is ignored in READY (the Hunters cannot target her yet)", s.caught() === false && s.phase === "READY");
  check("READY -> PLAYING happens only through start()", s.start(4200) === true && s.phase === "PLAYING");
  check("start() records the scene time of the PLAY press, not of construction", s.startedAtMs === 4200);
  check("the timer starts at 0 the moment PLAY is pressed", s.elapsedMs === 0);
  s.update(1000 / 60);
  check("and counts from the very next frame", s.elapsedMs > 0);
  check("a second start() (double tap) changes nothing", s.start(9999) === false && s.startedAtMs === 4200 && s.phase === "PLAYING");
}

// --- the timer ------------------------------------------------------------------------------------------------
{
  const s = newRun();
  check("after PLAY the timer runs whether or not she is moving (no input is needed)", (run(s, 3), s.elapsedMs > 2950 && s.elapsedMs < 3050), `${s.elapsedMs.toFixed(0)}ms`);
  const rates = [30, 60, 120, 144, 240].map((hz) => { const t = newRun(); run(t, 10, hz); return t.elapsedMs; });
  check("frame-rate independent: 10 seconds reads 10.0s at 30/60/120/144/240 Hz (within one frame)", rates.every((r) => Math.abs(r - 10000) <= 34 + 1000 / 30), rates.map((r) => r.toFixed(0)).join(" "));
  const big = newRun();
  big.update(16);
  const before = big.elapsedMs;
  big.update(5000);
  check("one enormous frame (a tab resuming) adds at most 100ms", big.elapsedMs - before <= 100);
  const neg = newRun();
  neg.update(-50);
  check("a negative delta never runs the clock backwards", neg.elapsedMs >= 0);
  const a = newRun(), b = newRun();
  for (const d of [16, 17, 16, 33, 16]) { a.update(d); b.update(d); }
  check("deterministic: the same frames give the same time", a.elapsedMs === b.elapsedMs);
}

// --- MM:SS ---------------------------------------------------------------------------------------------------------
{
  const cases: [number, string][] = [[0, "00:00"], [999, "00:00"], [1000, "00:01"], [37500, "00:37"], [59999, "00:59"], [60000, "01:00"], [61000, "01:01"], [3599000, "59:59"], [5999000, "99:59"], [99999999, "99:59"], [-5, "00:00"]];
  check("formatTime shows MM:SS", cases.every(([ms, text]) => formatTime(ms) === text), cases.filter(([ms, t]) => formatTime(ms) !== t).map(([ms]) => `${ms}->${formatTime(ms)}`).join(" ") || "all cases");
}

// --- the exit is locked until everything is collected --------------------------------------------------------------------
{
  const s = newRun();
  s.update(16);
  check("the exit is closed at 0/12 and open only at 12/12", !s.isExitOpen(0) && !s.isExitOpen(11) && s.isExitOpen(12) && s.isExitOpen(13));
  for (const n of [0, 1, 6, 11]) {
    const r = s.touchExit(n);
    if (r !== "LOCKED" || s.phase !== "PLAYING") check(`touching the exit with ${n}/12 is LOCKED and changes nothing`, false, `${r}/${s.phase}`);
  }
  check("reaching the exit early (0, 1, 6, 11 of 12) does NOT complete the level: it reports LOCKED", s.touchExit(11) === "LOCKED" && s.phase === "PLAYING");
  const t0 = s.elapsedMs;
  s.update(500);
  check("...and the game just carries on (timer still running)", s.elapsedMs > t0);
  check("with all 12 collected, touching the exit completes the level", s.touchExit(12) === "COMPLETE" && s.phase === "COMPLETE");
  const frozen = s.elapsedMs;
  run(s, 2);
  check("COMPLETE stops the timer for good", s.elapsedMs === frozen);
  check("touching the exit again is ignored (cannot complete twice)", s.touchExit(12) === "IGNORED" && s.phase === "COMPLETE");
  check("a Hunter catch after completion is ignored (Hunters no longer affect her)", s.caught() === false && s.phase === "COMPLETE");
  check("start() is ignored once COMPLETE (only reset() leads back to READY)", s.start(1) === false && s.phase === "COMPLETE" && s.elapsedMs === frozen);
}

// --- being caught -------------------------------------------------------------------------------------------------------------
{
  const s = newRun();
  run(s, 2);
  const changed = s.caught();
  const t = s.elapsedMs;
  check("a catch while playing moves to CAUGHT", changed && s.phase === "CAUGHT");
  run(s, 3);
  check("CAUGHT stops the timer", s.elapsedMs === t);
  check("a second catch changes nothing", s.caught() === false && s.phase === "CAUGHT");
  check("a caught player cannot complete the level, even with 12/12", s.touchExit(12) === "IGNORED" && s.phase === "CAUGHT");
  check("start() is ignored once CAUGHT", s.start(1) === false && s.phase === "CAUGHT" && s.elapsedMs === t);
}

// --- restart: back to the start screen, and a fresh run only after PLAY -------------------------------------------------------
{
  for (const how of ["CAUGHT", "COMPLETE"] as const) {
    const s = new ObjectiveState(TOTAL);
    s.start(1000);
    run(s, 5);
    if (how === "CAUGHT") s.caught(); else s.touchExit(12);
    s.reset();
    check(`restart from ${how}: back to READY, timer 0 (00:00), no start time`, s.phase === "READY" && s.elapsedMs === 0 && formatTime(s.elapsedMs) === "00:00" && s.startedAtMs === null);
    run(s, 2);
    check(`restart from ${how}: it does not start by itself (the timer stays at 0 until PLAY)`, s.elapsedMs === 0 && s.phase === "READY");
    check(`restart from ${how}: nothing can be caught or completed before PLAY`, s.caught() === false && s.touchExit(12) === "IGNORED" && s.phase === "READY");
    s.start(8000);
    check(`restart from ${how}: PLAY starts a fresh run with a fresh start time`, s.phase === "PLAYING" && s.elapsedMs === 0 && s.startedAtMs === 8000);
    run(s, 1);
    check(`restart from ${how}: the fresh timer counts from 00:00 (about 1s after 1s)`, s.elapsedMs > 950 && s.elapsedMs < 1050, `${s.elapsedMs.toFixed(0)}ms`);
    check(`restart from ${how}: the new run can be completed normally`, s.touchExit(11) === "LOCKED" && s.touchExit(12) === "COMPLETE");
  }
  const s = newRun();
  s.reset();
  check("reset() while PLAYING also returns to READY (a full reset, never a stuck state)", s.phase === "READY" && s.elapsedMs === 0);
}

// --- with the real collectible tracker: one counter, one source of truth ------------------------------------------------------------
{
  const centers = ITEMS.map((i) => ({ id: i.id, ...collectibleCenter(i, GROUND_SURFACE_Y) }));
  const tracker = new CollectibleTracker(centers, COLLECTIBLE_RADIUS);
  const objective = new ObjectiveState(tracker.total);
  objective.start(0);
  const bodyAt = (x: number, lift = 0): Rect => ({ left: x - body.width / 2, right: x + body.width / 2, top: GROUND_SURFACE_Y - lift - body.height, bottom: GROUND_SURFACE_Y - lift });
  objective.update(16);
  const opened: boolean[] = [];
  const counts: number[] = [];
  for (const item of ITEMS) {
    tracker.collect(bodyAt(item.x, requiredJumpHeight(item.lift, body.height) > 0 ? requiredJumpHeight(item.lift, body.height) + 4 : 0));
    counts.push(tracker.count);
    opened.push(objective.isExitOpen(tracker.count));
  }
  check("collecting all 12 with the real tracker counts 1..12", counts.join() === "1,2,3,4,5,6,7,8,9,10,11,12");
  check("the exit opens exactly when the 12th item is collected (not one before)", opened.slice(0, 11).every((o) => !o) && opened[11], opened.map((o) => (o ? "open" : "locked")).join(" "));
  check("early touch: locked; after 12/12: complete, using the tracker's own count", (() => { const early = new ObjectiveState(tracker.total); early.start(0); early.update(16); return early.touchExit(tracker.count - 1) === "LOCKED" && early.touchExit(tracker.count) === "COMPLETE"; })());
  // Caught with everything collected but before the exit, then a restart resets both together.
  objective.caught();
  tracker.reset();
  objective.reset();
  check("restart resets the counter (tracker) and the objective together: 0/12, locked, READY", tracker.count === 0 && !objective.isExitOpen(tracker.count) && objective.phase === "READY");
}

// --- the exit's place in the level ------------------------------------------------------------------------------------------------------
{
  const gate = exitRect(EXIT_SPEC, GROUND_SURFACE_Y);
  const trigger = exitTriggerRect(EXIT_SPEC, GROUND_SURFACE_Y);
  check("the exit is at the end of the Final Approach, around x=7350-7500", EXIT_SPEC.x >= 7350 && EXIT_SPEC.x <= 7500 && zoneAt(EXIT_SPEC.x).id === "FINAL", `x=${EXIT_SPEC.x}`);
  check("it sits inside the reserved exit area", gate.left >= EXIT_RESERVE.start && gate.right <= EXIT_RESERVE.end);
  check("it is before the world's right wall, with room behind it", gate.right <= MOVE_MAX_X - 40 && gate.right < WORLD_WIDTH, `gate ${gate.left}-${gate.right}, wall ${MOVE_MAX_X}`);
  check("it stands on the ground surface", gate.bottom === GROUND_SURFACE_Y);
  check("it is a modest gate: visible (over 90px) but below the jump height, so it can never trap Rara", EXIT_SPEC.height >= 90 && EXIT_SPEC.height <= peak * 0.9, `${EXIT_SPEC.height}px vs ${peak.toFixed(0)}px jump`);
  const boxes = OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));
  check("it does not overlap any obstacle (any piece of any type)", boxes.every((r) => !rectsOverlapArea(r, gate) && !rectsOverlapArea(r, trigger)));
  const lastObstacle = Math.max(...OBSTACLES.map((o) => o.x + o.width / 2));
  check("the approach to it is clear: no obstacle within 250px (the Final Approach stays calm)", gate.left - lastObstacle >= 250, `${(gate.left - lastObstacle).toFixed(0)}px of open ground`);
  check("no collectible within 250px of it, and none inside it", ITEMS.every((i) => Math.abs(i.x - EXIT_SPEC.x) >= 250) && ITEMS.every((i) => { const c = collectibleCenter(i, GROUND_SURFACE_Y); return !circleIntersectsRect(c.x, c.y, COLLECTIBLE_RADIUS, trigger); }));
  const patrols = FIRST_LEVEL_HUNTERS.map((h) => patrolSpan(h, HUNTER));
  check("no Hunter can see it or reach it (the last Hunter's sight ends far before)", patrols.every((p) => p.right + HUNTER.detectionRange * HUNTER.chaseRangeMultiplier < gate.left - 200));
  check("it is not in a pool of water", WATER_SEGMENTS.every((w) => w.end < gate.left - 200 || w.start > gate.right + 200));
  check("there are still obstacle-free stretches around it (the rest of the final zone is calm)", OBSTACLES.filter((o) => zoneAt(o.x).id === "FINAL").length <= 2 && ZONE_FINAL.end === WORLD_WIDTH);

  const standing = (rightEdgeGap: number, lift = 0): Rect => ({ left: gate.left - rightEdgeGap - body.width, right: gate.left - rightEdgeGap, top: GROUND_SURFACE_Y - lift - body.height, bottom: GROUND_SURFACE_Y - lift });
  check("far from the gate: not touching", !touchesExit(standing(300), trigger));
  check(`${EXIT_TRIGGER_MARGIN.side + 1}px short of the gate: not yet`, !touchesExit(standing(EXIT_TRIGGER_MARGIN.side + 1), trigger));
  check(`${EXIT_TRIGGER_MARGIN.side - 1}px from the gate (about to bump it): touching`, touchesExit(standing(EXIT_TRIGGER_MARGIN.side - 1), trigger));
  check("pressed right against the locked gate: touching", touchesExit(standing(0), trigger));
  check("hopping over the gate still counts as reaching it (so a locked gate always says so)", touchesExit({ left: gate.left, right: gate.left + body.width, top: gate.top - 50 - body.height, bottom: gate.top - 50 }, trigger));
  check("but a jump far above it does not", !touchesExit({ left: gate.left, right: gate.left + body.width, top: gate.top - 120 - body.height, bottom: gate.top - 120 }, trigger));
  check("standing on the other side of the gate touches it too (nowhere to hide from a locked exit)", touchesExit({ left: gate.right + 2, right: gate.right + 2 + body.width, top: GROUND_SURFACE_Y - body.height, bottom: GROUND_SURFACE_Y }, trigger));
}

console.log(failures === 0 ? "\nAll objective checks passed." : `\n${failures} objective check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
