/**
 * Validation for Rara's movement motor. It drives the real CharacterMotor with a
 * tiny stand-in for Phaser's Arcade body (gravity + a floor), stepping at 60fps,
 * so acceleration, deceleration, jumping and the "no air jumps" rules can be
 * checked without a browser.
 *
 *   node scripts/movement/validate-movement.ts
 */

import { CharacterMotor, approach, type MovementIntent } from "../../lib/movement/CharacterMotor.ts";
import { DEFAULT_MOVEMENT_CONFIG as CONFIG } from "../../lib/movement/config.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const DT_MS = 1000 / 60;

/** Arcade-like body: y is height above the floor (up = negative y, like Phaser). */
class FakeBody {
  velocity = { x: 0, y: 0 };
  gravity = { y: 0 };
  x = 0;
  y = 0; // 0 = standing on the floor; negative = in the air
  /** Height of the walkable surface at x: 0 normally, or far below past a ledge. */
  floorAt: (x: number) => number = () => 0;
  onFloor() {
    return this.y >= this.floorAt(this.x);
  }
  /** One Arcade step: integrate gravity and velocity, then rest on the floor. */
  integrate(dt: number) {
    this.velocity.y += (CONFIG.gravity + this.gravity.y) * dt;
    this.velocity.y = Math.min(this.velocity.y, CONFIG.maxFallSpeed);
    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;
    const floor = this.floorAt(this.x);
    if (this.y >= floor) {
      this.y = floor;
      this.velocity.y = 0;
    }
  }
}

class Sim {
  body = new FakeBody();
  motor = new CharacterMotor(this.body, CONFIG, 0);
  now = 0;
  jumps = 0;
  peak = 0;
  intent: MovementIntent = { moveX: 0, jumpHeld: false };
  last = this.motor.update(this.intent, DT_MS, 0);

  /** Advance one 60fps frame with the current intent. */
  frame() {
    this.now += DT_MS;
    this.last = this.motor.update(this.intent, DT_MS, this.now);
    if (this.last.jumped) this.jumps++;
    this.body.integrate(DT_MS / 1000);
    this.peak = Math.min(this.peak, this.body.y);
  }
  run(ms: number) {
    for (let t = 0; t < ms; t += DT_MS) this.frame();
  }
  pressJump() {
    this.motor.queueJump(this.now);
    this.intent.jumpHeld = true;
  }
  runUntilLanded(maxMs = 3000) {
    let elapsed = 0;
    do {
      this.frame();
      elapsed += DT_MS;
    } while (!(this.body.onFloor() && this.body.velocity.y === 0 && this.last.grounded) && elapsed < maxMs);
    return elapsed;
  }
}

// --- horizontal --------------------------------------------------------------
{
  const s = new Sim();
  s.intent.moveX = 1;
  s.frame();
  check("start: first frame accelerates, does not jump to top speed", s.last.velocityX > 0 && s.last.velocityX < CONFIG.maxRunSpeed * 0.5, `vx=${s.last.velocityX.toFixed(0)}`);
  s.run(60);
  s.frame();
  const ramped = s.last.velocityX;
  s.run(300);
  check("start: reaches top speed within ~0.2s and never exceeds it", ramped > CONFIG.maxRunSpeed * 0.5 && s.last.velocityX === CONFIG.maxRunSpeed, `after 0.1s=${ramped.toFixed(0)}, later=${s.last.velocityX}`);
  check("run: locomotion is 'run' at speed", s.last.locomotion === "run");

  s.intent.moveX = 0;
  const startX = s.body.x;
  let frames = 0;
  while (s.body.velocity.x !== 0 && frames < 120) {
    s.frame();
    frames++;
  }
  const slide = s.body.x - startX;
  check("release: stops in under 0.2s", frames * DT_MS < 200, `${(frames * DT_MS).toFixed(0)}ms`);
  check("release: slide distance is short (no uncontrolled sliding)", slide > 0 && slide < 60, `${slide.toFixed(0)}px`);
  s.run(50);
  check("release: stays at rest, locomotion 'idle'", s.body.velocity.x === 0 && s.last.locomotion === "idle");
}
{
  const s = new Sim();
  s.intent.moveX = 1;
  s.run(400);
  s.intent.moveX = -1;
  let frames = 0;
  while (s.body.velocity.x > 0 && frames < 120) {
    s.frame();
    frames++;
  }
  check("turn-around: reverses direction faster than a stop-then-start", frames * DT_MS < 100, `${(frames * DT_MS).toFixed(0)}ms to cross zero`);
  s.run(300);
  check("turn-around: reaches top speed the other way", s.body.velocity.x === -CONFIG.maxRunSpeed);
}
{
  const s = new Sim();
  s.intent.moveX = 1;
  s.pressJump();
  s.frame();
  s.frame();
  const airStart = s.body.velocity.x;
  const groundS = new Sim();
  groundS.intent.moveX = 1;
  groundS.frame();
  groundS.frame();
  check("air control: horizontal acceleration is weaker in the air than on the ground", airStart < groundS.body.velocity.x, `air=${airStart.toFixed(0)} ground=${groundS.body.velocity.x.toFixed(0)}`);
}

// --- jump --------------------------------------------------------------------
{
  const s = new Sim();
  s.run(100);
  s.pressJump();
  s.frame();
  check("jump: launches from the ground on the press frame", s.jumps === 1 && s.last.locomotion === "air" && !s.last.grounded);
  const airtime = s.runUntilLanded() + DT_MS;
  const peak = -s.peak;
  check("jump: peak height is natural (110-170px)", peak > 110 && peak < 170, `${peak.toFixed(0)}px`);
  check("jump: airtime is natural (0.5-0.9s)", airtime > 500 && airtime < 900, `${airtime.toFixed(0)}ms`);
  check("jump: lands back on the ground and is grounded again", s.body.y === 0 && s.last.grounded);
}
{
  // Mash jump for the whole ascent and most of the descent (the last press is >110ms before landing).
  const s = new Sim();
  s.pressJump();
  s.frame();
  for (let i = 0; i < 9; i++) {
    s.run(50);
    s.pressJump();
  }
  check("no air jump: repeated presses mid-air never launch a second jump", s.jumps === 1 && s.body.y < 0, `jumps=${s.jumps}`);
  s.runUntilLanded();
  s.run(200);
  check("no air jump: no stray jump fires after touchdown either", s.jumps === 1 && s.body.y === 0, `jumps=${s.jumps}`);
}
{
  const s = new Sim();
  s.pressJump();
  s.frame();
  s.intent.jumpHeld = false;
  s.run(100);
  // Press again within the buffer window before touching down: fires exactly one jump on landing.
  let pressed = false;
  let guard = 0;
  while (guard++ < 300) {
    if (!pressed && s.body.y > -40 && s.body.velocity.y > 0) {
      s.pressJump();
      pressed = true;
    }
    s.frame();
    if (s.jumps === 2) break;
  }
  check("jump buffer: a press just before landing jumps on touchdown", s.jumps === 2 && pressed);
  s.run(100);
  check("jump buffer: only one buffered jump is fired", s.jumps === 2);
}
{
  const held = new Sim();
  held.pressJump();
  held.runUntilLanded();
  const heldPeak = -held.peak;
  const tapped = new Sim();
  tapped.pressJump();
  tapped.frame();
  tapped.intent.jumpHeld = false;
  tapped.runUntilLanded();
  const tapPeak = -tapped.peak;
  check("variable jump: releasing early gives a lower hop, still a real one", tapPeak < heldPeak * 0.7 && tapPeak > 30, `tap=${tapPeak.toFixed(0)}px held=${heldPeak.toFixed(0)}px`);
}
{
  // Walking off an edge: coyote time allows a late jump once, and only briefly.
  // Find the frame the character stopped being grounded, then wait `delay` before pressing.
  const trial = (delayMs: number) => {
    const t = new Sim();
    t.body.floorAt = (x) => (x > 5 ? 500 : 0);
    t.intent.moveX = 1;
    let guard = 0;
    while (t.last.grounded && guard++ < 200) t.frame();
    t.run(delayMs);
    t.pressJump();
    t.frame();
    return t.jumps;
  };
  check("coyote time: a jump just after leaving a ledge still works", trial(40) === 1);
  check("coyote time: a jump long after leaving a ledge does not", trial(250) === 0);
}

// --- modifiers (hooks for stamina, chases, hiding) ---------------------------
{
  const s = new Sim();
  s.motor.modifiers.speedScale = 0.5;
  s.intent.moveX = 1;
  s.run(500);
  check("modifiers: speedScale scales top speed", s.body.velocity.x === CONFIG.maxRunSpeed * 0.5);
}
{
  const s = new Sim();
  s.motor.modifiers.controlsLocked = true;
  s.intent.moveX = 1;
  s.pressJump();
  s.run(300);
  check("modifiers: controlsLocked ignores movement and jump", s.body.velocity.x === 0 && s.jumps === 0 && s.body.y === 0);
}
check("approach never overshoots its target", approach(5, 8, 10) === 8 && approach(5, 2, 10) === 2 && approach(3, 3, 1) === 3);

console.log(failures === 0 ? "\nAll movement checks passed." : `\n${failures} movement check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
