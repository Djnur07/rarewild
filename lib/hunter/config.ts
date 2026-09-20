/**
 * Hunter tuning. Every number that decides how the Hunter perceives and moves
 * lives here, so balancing never means touching the AI or the scene.
 *
 * Units: pixels, pixels/second, pixels/second^2 and SECONDS, in WORLD space.
 * Independent of NFTs and skins: nothing here reads wallet or token data.
 */
export interface HunterConfig {
  // --- movement
  /** Walking speed while patrolling, px/s. */
  patrolSpeed: number;
  /** Running speed while chasing, px/s. Well below Rara's top speed so escape is always possible. */
  chaseSpeed: number;
  /** Walking speed while searching the last known position, px/s. */
  searchSpeed: number;
  /** Speeding up, px/s^2. */
  acceleration: number;
  /** Braking and reversing, px/s^2. */
  deceleration: number;

  // --- detection
  /** How far ahead the Hunter sees, px (horizontal). */
  detectionRange: number;
  /** How far above/below the Hunter's centre Rara is still seen, px. */
  detectionVerticalRange: number;
  /** Rara this close (any direction, even behind) is noticed regardless of facing, px. */
  awarenessRadius: number;
  /** While alert/chasing the Hunter tracks Rara out to range * this, in all directions. */
  chaseRangeMultiplier: number;

  // --- state timings
  /** ALERT: pause between noticing Rara and starting to run, s. */
  alertDuration: number;
  /** CHASE: how long Rara must stay out of sight before the Hunter gives up, s. */
  lostDelay: number;
  /** PATROL: pause at each end of the patrol route, s. */
  idleDuration: number;
  /** LOST: how long the Hunter looks around at the last known position, s. */
  searchDuration: number;
  /** LOST: how often the Hunter turns to look the other way, s. */
  searchLookInterval: number;

  // --- patrol route and steering
  /** The patrol route runs from spawnX - patrolRadius to spawnX + patrolRadius, px. */
  patrolRadius: number;
  /** Within this of a waypoint / search point counts as arrived, px. */
  arriveTolerance: number;
  /** While chasing, Rara this close horizontally is "right here": the Hunter stops steering instead of jittering, px. */
  turnDeadzone: number;

  // --- body and catching
  /** Hunter collision box, px. Small enough that Rara can jump over it. */
  body: { width: number; height: number };
  /** Contact = body boxes overlapping by more than this on both axes, px (a little forgiveness). */
  contactInset: number;

  // --- presentation (rendering only; the AI never reads it)
  /** Draw the faint detection area in front of the Hunter so players can read its sight. */
  showDetectionArea: boolean;
}

export const DEFAULT_HUNTER_CONFIG: HunterConfig = {
  patrolSpeed: 90,
  chaseSpeed: 230,
  searchSpeed: 130,
  acceleration: 700,
  deceleration: 900,

  detectionRange: 420,
  detectionVerticalRange: 180,
  awarenessRadius: 80,
  chaseRangeMultiplier: 1.5,

  alertDuration: 0.45,
  lostDelay: 2.0,
  idleDuration: 1.2,
  searchDuration: 2.5,
  searchLookInterval: 0.6,

  patrolRadius: 180,
  arriveTolerance: 8,
  turnDeadzone: 16,

  body: { width: 40, height: 96 },
  contactInset: 4,

  showDetectionArea: true,
};

/** Where the (single, for now) Hunter starts. */
export interface HunterSpawnConfig {
  /** Preferred horizontal spawn position, world px. */
  x: number;
  /** The Hunter is never placed closer than this to the player's start, px. */
  minDistanceFromPlayer: number;
}

export const DEFAULT_HUNTER_SPAWN: HunterSpawnConfig = {
  x: 1500,
  minDistanceFromPlayer: 700,
};
