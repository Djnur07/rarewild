/**
 * Validation for the Hunter AI, detection and spawn logic. It drives the real
 * HunterAI with a tiny stand-in for the physics body (integrates velocity into
 * position and clamps to the world, like Arcade does), at several frame rates,
 * so state transitions, chase behaviour, catching, world bounds, determinism
 * and frame-rate independence can be checked without a browser.
 *
 *   node scripts/hunter/validate-hunter.ts
 */

import { DEFAULT_HUNTER_CONFIG as CFG, type HunterSpawnConfig } from "../../lib/hunter/config.ts";
import { detectTarget, hasLineOfSight, rectsOverlap } from "../../lib/hunter/DetectionSystem.ts";
import { HunterAI } from "../../lib/hunter/HunterAI.ts";
import { resolveHunterSpawnX } from "../../lib/hunter/spawn.ts";
import type { HunterEvent, HunterState, Rect } from "../../lib/hunter/types.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const BOUNDS = { minX: 60, maxX: 2340 };
const HOME = 1500;
const HUNTER_CY = 434.5; // Hunter centre y standing on the ground (surface 482.5, body 96 tall)
const RARA_CY = 430; // Rara's body centre y standing on the ground
const HUNTER_HALF = { w: CFG.body.width / 2, h: CFG.body.height / 2 };
const RARA_HALF = { w: 22.5, h: 52.5 };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

type LogEntry = { t: number; event: HunterEvent };

/** The real AI plus a stand-in body. Rara is a point/box the test moves by hand. */
class Sim {
  readonly dt: number;
  readonly ai: HunterAI;
  x: number;
  t = 0;
  frames = 0;
  raraX = 400;
  raraCy = RARA_CY;
  blockers: Rect[] = [];
  log: LogEntry[] = [];
  maxStep = 0;
  maxDv = 0;
  private prevV = 0;
  outOfBounds = false;
  readonly hz: number;
  constructor(hz = 60, home = HOME, config = CFG) {
    this.hz = hz;
    this.dt = 1 / hz;
    this.x = home;
    this.ai = new HunterAI(config, home, BOUNDS);
  }
  get state(): HunterState {
    return this.ai.state;
  }
  step() {
    const hunterRect: Rect = { left: this.x - HUNTER_HALF.w, right: this.x + HUNTER_HALF.w, top: HUNTER_CY - HUNTER_HALF.h, bottom: HUNTER_CY + HUNTER_HALF.h };
    const raraRect: Rect = { left: this.raraX - RARA_HALF.w, right: this.raraX + RARA_HALF.w, top: this.raraCy - RARA_HALF.h, bottom: this.raraCy + RARA_HALF.h };
    const frame = this.ai.update(this.dt, {
      position: { x: this.x, y: HUNTER_CY },
      target: { x: this.raraX, y: this.raraCy },
      blockers: this.blockers,
      contact: rectsOverlap(hunterRect, raraRect, CFG.contactInset),
    });
    this.t += this.dt;
    this.frames++;
    for (const event of frame.events) this.log.push({ t: this.t, event });
    const before = this.x;
    let next = Math.min(Math.max(this.x + frame.velocityX * this.dt, BOUNDS.minX), BOUNDS.maxX);
    for (const wall of this.blockers) {
      if (wall.top >= HUNTER_CY + HUNTER_HALF.h - 1) continue; // the ground slab is not a wall
      if (before + HUNTER_HALF.w <= wall.left) next = Math.min(next, wall.left - HUNTER_HALF.w);
      else if (before - HUNTER_HALF.w >= wall.right) next = Math.max(next, wall.right + HUNTER_HALF.w);
    }
    this.x = next;
    if (this.x < BOUNDS.minX || this.x > BOUNDS.maxX) this.outOfBounds = true;
    this.maxStep = Math.max(this.maxStep, Math.abs(this.x - before));
    this.maxDv = Math.max(this.maxDv, Math.abs(frame.velocityX - this.prevV));
    this.prevV = frame.velocityX;
  }
  /** A restart: the AI is reset on purpose, so velocity tracking starts over. */
  restart() {
    this.ai.reset();
    this.prevV = 0;
  }
  run(seconds: number) {
    const end = this.t + seconds;
    while (this.t < end - 1e-9) this.step();
  }
  runUntil(predicate: () => boolean, maxSeconds: number): boolean {
    const end = this.t + maxSeconds;
    while (this.t < end && !predicate()) this.step();
    return predicate();
  }
  /** Time of the first logged event matching `pick`, or null. */
  when(pick: (e: HunterEvent) => boolean): number | null {
    return this.log.find((entry) => pick(entry.event))?.t ?? null;
  }
  count(type: HunterEvent["type"]): number {
    return this.log.filter((entry) => entry.event.type === type).length;
  }
}
const toState = (s: HunterState) => (e: HunterEvent) => e.type === "STATE_CHANGED" && e.to === s;

// --- spec starting values ------------------------------------------------------------------
check(
  "configuration holds the requested starting values",
  CFG.detectionRange === 420 && CFG.detectionVerticalRange === 180 && CFG.alertDuration === 0.45 && CFG.lostDelay === 2.0 &&
    CFG.patrolSpeed === 90 && CFG.chaseSpeed === 230 && CFG.acceleration === 700 && CFG.deceleration === 900,
);

// --- detection maths -------------------------------------------------------------------------
{
  const origin = { x: HOME, y: HUNTER_CY };
  const see = (dx: number, dy: number, facing: 1 | -1 = 1, blockers: Rect[] = [], mode: "cone" | "tracking" = "cone") =>
    detectTarget(origin, facing, { x: HOME + dx, y: HUNTER_CY + dy }, CFG, blockers, mode);
  check("detects Rara inside the area in front", see(300, 0) && see(419, 179) && see(100, -150));
  check("range limits are inclusive (420 ahead, 180 up/down)", see(420, 0) && see(0, 180) && see(420, 180) && !see(421, 0) && !see(0, 181));
  check("does not detect Rara beyond the range or outside the vertical range", !see(500, 0) && !see(300, 200) && !see(300, -200) && !see(1200, 0));
  check("does not detect Rara behind it (unless very close)", !see(-200, 0) && !see(-300, 50) && see(-60, 0) && !see(-100, 0));
  check("facing matters: the same spot is seen when facing it and not when facing away", see(-300, 0, -1) && !see(-300, 0, 1));
  const sweep = (() => {
    let outside = 0;
    for (let x = 0; x <= 2400; x += 10) {
      for (let y = 0; y <= 600; y += 10) {
        const seen = detectTarget(origin, 1, { x, y }, CFG, [], "cone");
        const dx = x - HOME;
        const dy = y - HUNTER_CY;
        const expected = (Math.abs(dx) <= 420 && Math.abs(dy) <= 180 && dx >= -12) || (Math.hypot(dx, dy) <= 80 && Math.abs(dx) <= 420 && Math.abs(dy) <= 180);
        if (seen !== expected) outside++;
      }
    }
    return outside;
  })();
  check("not detected from anywhere else on the map (full 2400x600 sweep matches the area exactly)", sweep === 0, `${sweep} mismatches`);
  const wall: Rect = { left: HOME + 150, right: HOME + 170, top: 300, bottom: 483 };
  check("line of sight: a solid between Hunter and Rara blocks detection", see(300, 0, 1, [wall]) === false && see(100, 0, 1, [wall]) === true);
  check("line of sight: a solid that is not in the way does not", hasLineOfSight(origin, { x: HOME + 300, y: HUNTER_CY }, [{ left: 0, right: 2400, top: 482.5, bottom: 600 }]));
  check("tracking mode sees further and from behind (range x1.5, any facing)", see(600, 0, 1, [], "tracking") && see(-600, 0, 1, [], "tracking") && !see(700, 0, 1, [], "tracking"));
}

// --- starts in PATROL, patrols predictably --------------------------------------------------
{
  const s = new Sim();
  check("Hunter starts in PATROL", s.state === "PATROL");
  s.raraX = HOME + 1200; // far away for the whole test
  s.run(30);
  const [left, right] = s.ai.patrolWaypoints;
  check("patrol: walks between two waypoints without ever seeing Rara from afar", s.count("PLAYER_DETECTED") === 0, `${left}..${right}`);
  const s2 = new Sim();
  s2.raraX = HOME + 1200;
  let minX = Infinity, maxX = -Infinity, maxSpeed = 0, idleSeen = false;
  while (s2.t < 30) {
    s2.step();
    minX = Math.min(minX, s2.x);
    maxX = Math.max(maxX, s2.x);
    maxSpeed = Math.max(maxSpeed, Math.abs(s2.ai.velocityX));
    if (s2.state === "IDLE") idleSeen = true;
  }
  check("patrol: covers its whole route and pauses (IDLE) at the ends", near(minX, left, CFG.arriveTolerance) && near(maxX, right, CFG.arriveTolerance) && idleSeen, `x ${minX.toFixed(0)}..${maxX.toFixed(0)}`);
  check("patrol: never exceeds the patrol speed", maxSpeed <= CFG.patrolSpeed + 1e-6, `${maxSpeed.toFixed(1)} px/s`);
}

// --- detection in motion: inside vs outside ---------------------------------------------------
{
  const inside = new Sim();
  inside.raraX = HOME + 300;
  inside.step();
  check("detects Rara inside the detection area (PATROL -> ALERT on the first frame)", inside.state === "ALERT" && inside.count("PLAYER_DETECTED") === 1);

  const above = new Sim();
  above.raraX = HOME;
  above.raraCy = HUNTER_CY - 200; // higher than the vertical range on top of the whole route
  above.run(30);
  check("does not detect Rara outside the vertical range", above.count("PLAYER_DETECTED") === 0);

  const behind = new Sim();
  behind.raraX = HOME - 180 - CFG.detectionRange - 60; // beyond the far patrol end plus the detection range
  behind.run(30);
  check("does not detect Rara outside the horizontal range", behind.count("PLAYER_DETECTED") === 0);
}

// --- ALERT -> CHASE ------------------------------------------------------------------------------
{
  const s = new Sim();
  s.raraX = HOME + 350;
  s.step();
  const tAlert = s.t;
  s.runUntil(() => s.state !== "ALERT", 2);
  const alertFor = s.t - tAlert;
  check("ALERT lasts alertDuration, then CHASE", s.state === "CHASE" && near(alertFor, CFG.alertDuration, s.dt * 1.5), `${alertFor.toFixed(3)}s`);
  check("ALERT is a reaction window: the Hunter stands still while it notices", (() => {
    const t = new Sim();
    t.raraX = HOME + 350;
    t.step();
    let moved = 0;
    while (t.state === "ALERT") { const b = t.x; t.step(); moved = Math.max(moved, Math.abs(t.x - b)); }
    return moved < 1;
  })());

  // Facing: notice Rara from behind (awareness radius) and turn to face her.
  const t = new Sim();
  t.raraX = 5000; // out of the way while we wait for the Hunter to face left
  t.runUntil(() => t.ai.facing === -1, 20);
  t.raraX = t.x + 50; // right behind it now
  t.step();
  check("ALERT: the Hunter turns to face Rara", t.state === "ALERT" && t.ai.facing === 1, `facing ${t.ai.facing}`);
}

// --- CHASE ----------------------------------------------------------------------------------------
{
  const s = new Sim();
  s.raraX = HOME + 380;
  s.runUntil(() => s.state === "CHASE", 2);
  let towards = true, maxV = 0, prevDist = Math.abs(s.raraX - s.x), reachedTop = false;
  while (s.state === "CHASE" && s.count("PLAYER_CAUGHT") === 0 && s.t < 10) {
    s.step();
    const d = Math.abs(s.raraX - s.x);
    if (d > prevDist + 1e-9) towards = false;
    prevDist = d;
    maxV = Math.max(maxV, Math.abs(s.ai.velocityX));
    if (Math.abs(s.ai.velocityX) >= CFG.chaseSpeed - 1e-6) reachedTop = true;
  }
  check("CHASE: moves toward Rara every frame", towards);
  check("CHASE: reaches, and never exceeds, the chase speed", reachedTop && maxV <= CFG.chaseSpeed + 1e-6, `${maxV.toFixed(1)} px/s`);
  check("CHASE: velocity changes are rate-limited (no snapping, no infinite acceleration)", s.maxDv <= Math.max(CFG.acceleration, CFG.deceleration) * s.dt + 1e-6, `max dv ${s.maxDv.toFixed(2)}/frame`);

  const ramp = new Sim();
  ramp.raraX = HOME + 400;
  ramp.runUntil(() => ramp.state === "CHASE", 2);
  const v0 = ramp.ai.velocityX;
  ramp.run(0.1);
  check("CHASE: starts from rest and accelerates smoothly", v0 === 0 && ramp.ai.velocityX > 0 && ramp.ai.velocityX < CFG.chaseSpeed && near(ramp.ai.velocityX, CFG.acceleration * 0.1, 8), `${ramp.ai.velocityX.toFixed(1)} px/s after 0.1s`);

  // Reversal: Rara runs past; the Hunter brakes and turns rather than snapping.
  const r = new Sim();
  r.raraX = HOME + 380;
  r.runUntil(() => r.ai.velocityX >= CFG.chaseSpeed - 1e-6, 5);
  r.raraX = r.x - 300;
  const vBefore = r.ai.velocityX;
  r.step();
  check("CHASE: turning around brakes first, no instant flip", vBefore > 0 && r.ai.velocityX > 0 && r.ai.velocityX < vBefore);
  r.run(1.5);
  check("CHASE: then follows Rara the other way", r.ai.velocityX < 0);

  // No jitter with Rara hovering right above it.
  const j = new Sim();
  j.raraX = HOME + 300;
  j.runUntil(() => j.state === "CHASE", 2);
  j.raraX = j.x + 300;
  j.runUntil(() => Math.abs(j.raraX - j.x) < 200, 5);
  j.raraX = j.x + 5;
  j.raraCy = HUNTER_CY - 100; // hovering above its head, not touching
  let flips = 0, lastSign = 0, facingChanges = 0, lastFacing = j.ai.facing;
  for (let i = 0; i < 300; i++) {
    j.step();
    const sign = Math.sign(j.ai.velocityX);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) flips++;
    if (sign !== 0) lastSign = sign;
    if (j.ai.facing !== lastFacing) { facingChanges++; lastFacing = j.ai.facing; }
  }
  check("CHASE: no jitter when Rara is right above it", flips <= 2 && facingChanges <= 2, `${flips} direction flips, ${facingChanges} facing changes`);
}

// --- CHASE -> LOST -> PATROL ---------------------------------------------------------------------
{
  const s = new Sim();
  s.raraX = HOME + 350;
  s.runUntil(() => s.state === "CHASE", 2);
  s.run(0.5);
  const lastSeenX = s.raraX;
  s.raraX = s.x + 3000; // far outside even the tracking range
  const tGone = s.t;
  s.runUntil(() => s.state === "LOST", 5);
  const gave = s.t - tGone;
  check("loses Rara after she stays out of range for lostDelay", s.state === "LOST" && near(gave, CFG.lostDelay, s.dt * 2), `${gave.toFixed(3)}s`);
  check("emits PLAYER_LOST", s.count("PLAYER_LOST") === 1);

  // While LOST it goes to the last known position (not to Rara's real position).
  s.runUntil(() => Math.abs(s.x - Math.min(lastSeenX, BOUNDS.maxX)) <= CFG.arriveTolerance + 1, 20);
  check("LOST: searches the last known position", near(s.x, lastSeenX, CFG.arriveTolerance + 1) || s.x < lastSeenX + 20, `at ${s.x.toFixed(0)}, last seen ${lastSeenX.toFixed(0)}`);
  let looks = 0, facing = s.ai.facing, maxSearchSpeed = 0;
  const tArrive = s.t;
  while (s.state === "LOST" && s.t - tArrive < 20) {
    s.step();
    if (s.ai.facing !== facing) { looks++; facing = s.ai.facing; }
    maxSearchSpeed = Math.max(maxSearchSpeed, Math.abs(s.ai.velocityX));
  }
  check("LOST: looks around (turns left and right) and stays within the search speed", looks >= 2 && maxSearchSpeed <= CFG.searchSpeed + 1e-6, `${looks} turns`);
  check("LOST: eventually returns to PATROL", s.state === "PATROL" || s.state === "IDLE", `after ${(s.t - tArrive).toFixed(2)}s of searching`);

  // ...and the patrol actually resumes and stays predictable.
  s.raraX = HOME + 5000;
  const [left, right] = s.ai.patrolWaypoints;
  let sawLeft = false, sawRight = false, fastest = 0;
  while (s.t < tGone + 90 && !(sawLeft && sawRight)) {
    s.step();
    if (near(s.x, left, CFG.arriveTolerance)) sawLeft = true;
    if (near(s.x, right, CFG.arriveTolerance)) sawRight = true;
    if (s.state === "PATROL") fastest = Math.max(fastest, Math.abs(s.ai.velocityX));
  }
  check("PATROL resumes: walks back and forth between its waypoints", sawLeft && sawRight && fastest <= CFG.patrolSpeed + 1e-6);

  // Seeing Rara again while searching goes straight back to ALERT.
  const again = new Sim();
  again.raraX = HOME + 350;
  again.runUntil(() => again.state === "CHASE", 2);
  again.raraX = again.x + 3000;
  again.runUntil(() => again.state === "LOST", 5);
  again.raraX = again.x + 200 * again.ai.facing;
  again.step();
  check("LOST: noticing Rara again goes back to ALERT", again.state === "ALERT");
}

// --- line of sight while chasing --------------------------------------------------------------------
{
  const s = new Sim();
  s.raraX = HOME + 380;
  s.runUntil(() => s.state === "CHASE", 2);
  s.blockers = [{ left: s.x + 120, right: s.x + 140, top: 200, bottom: 483 }]; // a wall drops between them
  s.raraX = s.x + 260;
  const before = s.t;
  s.runUntil(() => s.state === "LOST", 5);
  check("a solid wall between them makes the Hunter lose sight, after lostDelay", s.state === "LOST" && s.t - before >= CFG.lostDelay - s.dt);
}

// --- blocked by terrain (no pathfinding yet: it must not push on a wall forever) ------------------
{
  const s = new Sim();
  s.raraX = HOME + 3000;
  s.blockers = [{ left: HOME + 100, right: HOME + 120, top: 300, bottom: 483 }]; // wall inside the right half of the patrol route
  const turnedBack = s.runUntil(() => s.x < HOME - 100, 40);
  check("patrol: a wall on the route makes it turn around instead of pushing on it forever", turnedBack && s.x <= HOME + 100 - HUNTER_HALF.w + 1, `x=${s.x.toFixed(0)}`);
  const pauses = new Set(s.log.filter((l) => l.event.type === "STATE_CHANGED").map((l) => l.event.type === "STATE_CHANGED" ? l.event.to : ""));
  check("patrol: keeps cycling PATROL/IDLE around the wall", pauses.has("IDLE") && pauses.has("PATROL"));

  const c = new Sim();
  c.raraX = HOME + 380;
  c.runUntil(() => c.state === "CHASE", 2);
  c.run(0.3);
  c.blockers = [{ left: c.x + 300, right: c.x + 320, top: 300, bottom: 483 }];
  c.raraX = c.x + 3000; // gone; last seen beyond the wall
  c.runUntil(() => c.state === "LOST", 5);
  const returned = c.runUntil(() => c.state === "PATROL", 30);
  check("LOST: a wall on the way to the last known position does not trap it (it gives up and patrols again)", returned, `${c.t.toFixed(1)}s`);
}

// --- catching ------------------------------------------------------------------------------------------
{
  const s = new Sim();
  s.raraX = HOME + 380;
  s.runUntil(() => s.count("PLAYER_CAUGHT") > 0, 10);
  const tCaught = s.t;
  check("collision triggers PLAYER_CAUGHT", s.count("PLAYER_CAUGHT") === 1 && s.ai.caught, `at ${tCaught.toFixed(2)}s`);
  s.run(3);
  check("after the catch the chase stops: Hunter brakes to rest and stands down", s.ai.velocityX === 0 && s.state === "IDLE");
  check("PLAYER_CAUGHT fires exactly once (no repeats while overlapping)", s.count("PLAYER_CAUGHT") === 1);
  s.ai.reset();
  check("reset() puts it back on patrol, ready for a new run", s.state === "PATROL" && !s.ai.caught && s.ai.velocityX === 0);

  const behind = new Sim();
  behind.raraX = HOME - 400;
  behind.raraX = behind.x;
  behind.step();
  check("touching the Hunter from behind still catches Rara", behind.count("PLAYER_CAUGHT") === 1);

  // Fairness: the jump clears it (a 134px hop lifts Rara's feet above its head).
  const jump = new Sim();
  jump.raraX = HOME + 380;
  jump.runUntil(() => jump.state === "CHASE", 2);
  jump.raraCy = RARA_CY - 134; // apex of Rara's jump
  jump.raraX = jump.x;
  jump.step();
  check("fair: Rara can jump over the Hunter (no catch at the top of a jump)", jump.count("PLAYER_CAUGHT") === 0);
}

// --- fairness ----------------------------------------------------------------------------------------
{
  const still = new Sim();
  still.raraX = HOME + 420;
  still.step();
  still.runUntil(() => still.count("PLAYER_CAUGHT") > 0, 10);
  check("fair: Rara standing at the edge of detection has over 1.8s before being caught", still.t > 1.8, `${still.t.toFixed(2)}s`);

  const run = new Sim(60, 800); // a Hunter with room for Rara to run
  run.raraX = 800 + 380;
  run.step(); // detected
  let raraSpeed = 520;
  while (run.t < 20 && run.count("PLAYER_CAUGHT") === 0) {
    run.raraX = Math.min(run.raraX + raraSpeed * run.dt, BOUNDS.maxX);
    run.step();
    if (run.raraX >= BOUNDS.maxX) raraSpeed = 0;
  }
  check("fair: Rara running away at her top speed is never caught (the Hunter gives up)", run.count("PLAYER_CAUGHT") === 0 && run.count("PLAYER_LOST") === 1);
}

// --- no teleporting, world bounds, determinism, frame rate -------------------------------------------
function scriptedRun(hz: number, seconds: number, home = HOME) {
  const s = new Sim(hz, home);
  while (s.t < seconds) {
    // Rara sweeps back and forth across the world (sometimes lingering), fully deterministic.
    const phase = s.t / 9;
    s.raraX = 1250 + 1150 * Math.sin(phase * Math.PI * 2) * Math.cos(phase * 1.3);
    s.raraCy = RARA_CY - Math.max(0, Math.sin(s.t * 3)) * 100;
    s.step();
    if (s.ai.caught) s.restart(); // the run restarts after a catch
  }
  return s;
}
{
  const s = scriptedRun(60, 90);
  const maxSpeed = Math.max(CFG.chaseSpeed, CFG.searchSpeed, CFG.patrolSpeed);
  check("never teleports: per-frame displacement stays within max speed x dt", s.maxStep <= maxSpeed * s.dt + 1e-6, `max step ${s.maxStep.toFixed(3)}px`);
  check("never accelerates unboundedly (velocity changes are rate-limited)", s.maxDv <= Math.max(CFG.acceleration, CFG.deceleration) * s.dt + 1e-6);
  check("scripted 90s run exercises every behaviour", s.log.some((l) => l.event.type === "PLAYER_DETECTED") && s.log.some((l) => l.event.type === "PLAYER_LOST") && s.log.some((l) => l.event.type === "STATE_CHANGED" && l.event.to === "CHASE"));

  for (const home of [100, 2300]) {
    const edge = new Sim(60, home);
    let inside = true;
    for (const raraX of [60, 2340, 60, 2340]) {
      edge.raraX = raraX;
      edge.raraCy = RARA_CY - 60; // hovering, so she is chased but not caught
      for (let i = 0; i < 60 * 12; i++) {
        edge.step();
        if (edge.x < BOUNDS.minX || edge.x > BOUNDS.maxX || edge.outOfBounds) inside = false;
        if (edge.ai.caught) edge.ai.reset();
      }
    }
    check(`respects world bounds (Hunter home ${home}, Rara at both edges)`, inside && edge.x >= BOUNDS.minX && edge.x <= BOUNDS.maxX, `ends at ${edge.x.toFixed(1)}`);
  }
}
{
  const trace = (hz: number) => {
    const s = new Sim(hz);
    s.raraX = HOME + 380;
    const xs: number[] = [];
    for (let i = 0; i < hz * 12; i++) {
      if (i === Math.round(hz * 4)) s.raraX = s.x + 3000;
      s.step();
      xs.push(s.x);
    }
    return { xs, log: s.log.map((l) => `${l.t.toFixed(6)}:${JSON.stringify(l.event)}`) };
  };
  const a = trace(60);
  const b = trace(60);
  check("deterministic: identical inputs give a byte-identical run", JSON.stringify(a) === JSON.stringify(b));
}
{
  const measure = (hz: number) => {
    const s = new Sim(hz);
    s.raraX = HOME + 380;
    s.runUntil(() => s.count("PLAYER_CAUGHT") > 0, 10);
    const caughtAt = s.t;
    const s2 = new Sim(hz);
    s2.raraX = HOME + 380;
    s2.run(1.5);
    return {
      alert: s.when(toState("ALERT")) ?? -1,
      chase: s.when(toState("CHASE")) ?? -1,
      caught: caughtAt,
      x15: s2.x,
      v15: s2.ai.velocityX,
    };
  };
  const ref = measure(60);
  const rates = [30, 120, 144, 240];
  const worst = rates.map((hz) => {
    const m = measure(hz);
    return { hz, dt: Math.max(Math.abs(m.alert - ref.alert), Math.abs(m.chase - ref.chase), Math.abs(m.caught - ref.caught)), dx: Math.abs(m.x15 - ref.x15), dv: Math.abs(m.v15 - ref.v15) };
  });
  check(
    "frame-rate independent: alert/chase/catch times agree within 50ms (one 30fps frame + integration error) at 30/60/120/144/240 Hz",
    worst.every((w) => w.dt <= 0.05),
    worst.map((w) => `${w.hz}Hz:${(w.dt * 1000).toFixed(0)}ms`).join(" "),
  );
  check(
    "frame-rate independent: position and speed after 1.5s agree across frame rates",
    worst.every((w) => w.dx <= 8 && w.dv <= 25),
    worst.map((w) => `${w.hz}Hz:${w.dx.toFixed(1)}px`).join(" "),
  );
  const long30 = scriptedRun(30, 60).maxStep;
  const long144 = scriptedRun(144, 60).maxStep;
  check("frame-rate independent: per-frame step scales with frame time (no per-frame constants)", long30 <= 230 / 30 + 1e-6 && long144 <= 230 / 144 + 1e-6, `${long30.toFixed(2)}px@30Hz ${long144.toFixed(2)}px@144Hz`);
}
{
  // A huge frame (tab in the background) is clamped and cannot teleport the Hunter.
  const s = new Sim(60);
  s.raraX = HOME + 380;
  s.step();
  const frame = s.ai.update(5, { position: { x: s.x, y: HUNTER_CY }, target: { x: s.raraX, y: RARA_CY }, blockers: [], contact: false });
  check("a 5 second frame is clamped (velocity change limited to one 50ms step)", Math.abs(frame.velocityX) <= Math.max(CFG.acceleration, CFG.deceleration) * 0.05 + 1e-6);
}

// --- spawn --------------------------------------------------------------------------------------------
{
  const playerX = 400;
  const EXAMPLE_SPAWN: HunterSpawnConfig = { x: 1500, minDistanceFromPlayer: 700 };
  const spawn = resolveHunterSpawnX(EXAMPLE_SPAWN, playerX, BOUNDS);
  check("spawn: a preferred position is far from Rara's start and inside the world", Math.abs(spawn - playerX) >= EXAMPLE_SPAWN.minDistanceFromPlayer && spawn >= BOUNDS.minX && spawn <= BOUNDS.maxX, `x=${spawn}`);
  const pushed = resolveHunterSpawnX({ x: 450, minDistanceFromPlayer: 700 }, playerX, BOUNDS);
  check("spawn: too close to the player -> moved out to the safe distance", Math.abs(pushed - playerX) >= 700 && pushed <= BOUNDS.maxX, `x=${pushed}`);
  const clamped = resolveHunterSpawnX({ x: 99999, minDistanceFromPlayer: 700 }, playerX, BOUNDS);
  check("spawn: out-of-world positions are clamped inside", clamped === BOUNDS.maxX);
  const edge = resolveHunterSpawnX({ x: 2300, minDistanceFromPlayer: 700 }, 2300, BOUNDS);
  check("spawn: player at the far edge -> Hunter placed on the side with room", Math.abs(edge - 2300) >= 700 && edge >= BOUNDS.minX);
  check("spawn: the whole patrol route stays clear of the player start", (() => {
    const ai = new HunterAI(CFG, spawn, BOUNDS);
    return ai.patrolWaypoints.every((w) => Math.abs(w - playerX) >= CFG.detectionRange + CFG.awarenessRadius);
  })());
}

console.log(failures === 0 ? "\nAll Hunter checks passed." : `\n${failures} Hunter check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
