/**
 * Rara's movement tuning. Every number that decides how movement feels lives
 * here, so retuning (or giving a future area its own feel, e.g. slippery mud or
 * a chase) never means touching the motor or the scene.
 *
 * Units: pixels, seconds and milliseconds in WORLD space (the 600px-tall
 * world; the camera zoom only scales what is drawn).
 *
 * Skins never feed into these values: a RAREWILD skin is cosmetic only.
 */
export interface MovementConfig {
  /** World gravity while rising with the jump held, px/s^2. */
  gravity: number;
  /** Gravity multiplier while falling: a snappier descent than the ascent. */
  fallGravityMultiplier: number;
  /** Gravity multiplier while rising after the jump input was released: releasing early shortens the jump. */
  lowJumpGravityMultiplier: number;
  /** Terminal fall speed, px/s. */
  maxFallSpeed: number;

  /** Top horizontal speed on foot, px/s. */
  maxRunSpeed: number;
  /** Speeding up from a standstill (or in the direction already moving), px/s^2. */
  groundAcceleration: number;
  /** Slowing to a stop once input is released, px/s^2. Higher = less sliding. */
  groundDeceleration: number;
  /** Reversing direction while moving, px/s^2. */
  groundTurnAcceleration: number;
  /** Multiplier on all horizontal rates while airborne (1 = same as ground). */
  airControl: number;

  /** Upward launch speed of a jump, px/s. Peak height is jumpVelocity^2 / (2 * gravity). */
  jumpVelocity: number;
  /** How long after walking off an edge a jump is still allowed, ms. */
  coyoteTimeMs: number;
  /** How early before landing a jump press is remembered and fired on touchdown, ms. */
  jumpBufferMs: number;

  /** Below this horizontal speed a grounded character counts as standing still (idle animation), px/s. */
  runAnimationThreshold: number;
  /** Airborne shorter than this doesn't count as "in the air" for animation, ms (avoids flicker on tiny drops). */
  airAnimationDelayMs: number;
}

export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  gravity: 1850,
  fallGravityMultiplier: 1.4,
  lowJumpGravityMultiplier: 2.2,
  maxFallSpeed: 1000,

  maxRunSpeed: 520,
  groundAcceleration: 3500, // ~0.15s to top speed
  groundDeceleration: 4300, // ~0.12s / ~31px to stop from top speed
  groundTurnAcceleration: 7000,
  airControl: 0.6,

  jumpVelocity: 720, // ~140px peak, ~0.7s in the air
  coyoteTimeMs: 90,
  jumpBufferMs: 110,

  runAnimationThreshold: 30,
  airAnimationDelayMs: 60,
};

/**
 * Situational multipliers a future system can set on the motor without
 * changing the tuning above: stamina drain -> speedScale < 1, a hunter chase
 * -> speedScale > 1, sticky terrain -> jumpScale < 1, hiding or a cutscene ->
 * controlsLocked.
 */
export interface MovementModifiers {
  speedScale: number;
  jumpScale: number;
  controlsLocked: boolean;
}
