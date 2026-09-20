/**
 * CharacterMotor: turns "what the player wants" (a horizontal direction, a
 * jump press) into velocity on a physics body, one frame at a time.
 *
 * It owns the feel, not the world: it never moves anything itself. Phaser's
 * Arcade physics still integrates positions, applies gravity and resolves
 * collisions; the motor only sets horizontal velocity, launches jumps and tunes
 * the per-frame gravity multiplier. It knows nothing about input devices,
 * animation, skins, tokens or the scene, and `Phaser` isn't imported at all, so
 * it is SSR-safe and can be exercised in plain Node (see
 * scripts/movement/validate-movement.ts).
 *
 * Feel features:
 *   - horizontal speed approaches its target at an acceleration / deceleration /
 *     turn-around rate, so there is no instant start and no long slide;
 *   - one jump per touchdown (no air jumps); a press made just before landing is
 *     remembered briefly (jump buffer) and a jump is still allowed for a moment
 *     after walking off an edge (coyote time), but neither can add an air jump;
 *   - gravity is heavier when falling and while rising with the jump released,
 *     giving a snappy, variable-height jump.
 */

import type { MovementConfig, MovementModifiers } from "./config.ts";

/** The slice of Phaser's Arcade `Body` the motor needs (a real Body satisfies this structurally). */
export interface MotorBody {
  velocity: { x: number; y: number };
  /** Per-body gravity, added to the world gravity. */
  gravity: { y: number };
  onFloor(): boolean;
}

export interface MovementIntent {
  /** Horizontal direction wanted this frame. */
  moveX: -1 | 0 | 1;
  /** Whether a jump input is currently held (controls jump height). */
  jumpHeld: boolean;
}

/** Coarse movement state for animation and gameplay to react to. */
export type Locomotion = "idle" | "run" | "air";

export interface MotorFrame {
  grounded: boolean;
  locomotion: Locomotion;
  /** True only on the frame a jump was launched. */
  jumped: boolean;
  velocityX: number;
  velocityY: number;
}

/** Move `current` toward `target` by at most `maxDelta`, never overshooting. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export class CharacterMotor {
  /** Situational multipliers for future systems (stamina, chases, hiding); see MovementModifiers. */
  readonly modifiers: MovementModifiers = { speedScale: 1, jumpScale: 1, controlsLocked: false };

  private readonly body: MotorBody;
  private readonly config: MovementConfig;
  private lastGroundedAt: number;
  private jumpQueuedAt = -Infinity;
  /** A jump has been used since the last touchdown; blocks a second jump (incl. via coyote time). */
  private jumpUsed = false;

  /** `nowMs` is the scene time at creation: the character starts standing, so no frame counts as "just left the ground". */
  constructor(body: MotorBody, config: MovementConfig, nowMs: number) {
    this.body = body;
    this.config = config;
    this.lastGroundedAt = nowMs;
  }

  /** Remember a jump press (call once per key/button press, not while held). */
  queueJump(nowMs: number) {
    this.jumpQueuedAt = nowMs;
  }

  update(intent: MovementIntent, deltaMs: number, nowMs: number): MotorFrame {
    const { config, body, modifiers } = this;
    // A long frame (tab in the background) must not turn into a huge velocity step.
    const dt = Math.min(deltaMs, 50) / 1000;
    const locked = modifiers.controlsLocked;
    const moveX = locked ? 0 : intent.moveX;
    const jumpHeld = !locked && intent.jumpHeld;
    if (locked) this.jumpQueuedAt = -Infinity;

    // Standing on something = supported from below and not moving up (so the
    // frame right after a jump launch never counts as grounded).
    let grounded = body.onFloor() && body.velocity.y >= 0;
    if (grounded) {
      this.lastGroundedAt = nowMs;
      this.jumpUsed = false;
    }

    let jumped = false;
    const jumpQueued = nowMs - this.jumpQueuedAt <= config.jumpBufferMs;
    const canJump = !this.jumpUsed && (grounded || nowMs - this.lastGroundedAt <= config.coyoteTimeMs);
    if (jumpQueued && canJump) {
      body.velocity.y = -config.jumpVelocity * modifiers.jumpScale;
      this.jumpUsed = true;
      this.jumpQueuedAt = -Infinity;
      jumped = true;
      grounded = false;
    }

    // Horizontal: approach the target speed at the rate that fits the situation.
    const targetX = moveX * config.maxRunSpeed * modifiers.speedScale;
    const vx = body.velocity.x;
    let rate: number;
    if (moveX === 0) rate = config.groundDeceleration;
    else if (vx === 0 || Math.sign(vx) === moveX) rate = config.groundAcceleration;
    else rate = config.groundTurnAcceleration;
    if (!grounded) rate *= config.airControl;
    body.velocity.x = approach(vx, targetX, rate * dt);

    // Vertical: Arcade applies world gravity; the body's own gravity adds the multiplier's extra.
    const vy = body.velocity.y;
    let gravityMultiplier = 1;
    if (vy > 0) gravityMultiplier = config.fallGravityMultiplier;
    else if (vy < 0 && !jumpHeld) gravityMultiplier = config.lowJumpGravityMultiplier;
    body.gravity.y = config.gravity * (gravityMultiplier - 1);

    return {
      grounded,
      locomotion: this.locomotionFor(grounded, nowMs),
      jumped,
      velocityX: body.velocity.x,
      velocityY: body.velocity.y,
    };
  }

  private locomotionFor(grounded: boolean, nowMs: number): Locomotion {
    const { config, body } = this;
    if (!grounded && (this.jumpUsed || nowMs - this.lastGroundedAt > config.airAnimationDelayMs)) return "air";
    if (Math.abs(body.velocity.x) > config.runAnimationThreshold) return "run";
    return "idle";
  }
}
