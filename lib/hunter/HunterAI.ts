/**
 * HunterAI: the Hunter's brain. A small state machine that turns "what the
 * Hunter can perceive this frame" into a facing direction and a velocity.
 *
 *   PATROL  walk between two waypoints at patrolSpeed
 *      |    (reaching one -> IDLE: stand, turn around, then walk to the other)
 *   IDLE    stand still for idleDuration
 *      |
 *      |  Rara enters the detection area ("cone" sight)
 *      v
 *   ALERT   stop, face Rara, hold for alertDuration (the reaction window)
 *      |
 *      v
 *   CHASE   run toward Rara at chaseSpeed with acceleration/deceleration
 *      |    Rara out of sight for lostDelay -> gives up (PLAYER_LOST)
 *      v
 *   LOST    walk to where Rara was last seen, look left and right for
 *      |    searchDuration, then go back to PATROL. Seeing Rara again -> ALERT.
 *
 * Touching Rara in ANY state fires PLAYER_CAUGHT once; the Hunter then stands
 * down (brakes to a stop, stops seeing) until `reset()`.
 *
 * Pure and deterministic: no Phaser, no randomness, no clocks. All timing
 * comes from the `deltaSeconds` passed in and velocity changes are rate
 * limited per second, so behaviour does not depend on the frame rate. The
 * scene applies `velocityX` to the physics body; position and collisions stay
 * with Arcade physics (see Hunter.ts).
 */

import { approach } from "../movement/CharacterMotor.ts";
import type { HunterConfig } from "./config.ts";
import { detectTarget } from "./DetectionSystem.ts";
import type { Facing, HunterEvent, HunterFrame, HunterPercept, HunterState } from "./types.ts";

/** A long frame (tab in the background) must not become one huge step. */
const MAX_DELTA_SECONDS = 0.05;

/**
 * Blocked-by-terrain detection (there is no pathfinding yet): the AI is "trying to walk" (its own
 * speed above STUCK_MIN_SPEED) but the body barely moves (below STUCK_MAX_MOVED px/s) for STUCK_SECONDS.
 * Speeds, not per-frame distances, so it behaves the same at any frame rate.
 */
const STUCK_MIN_SPEED = 40;
const STUCK_MAX_MOVED = 5;
const STUCK_SECONDS = 0.4;

/** Accelerate when speeding up; brake (and reverse) at the deceleration rate otherwise. */
export function stepSpeed(current: number, target: number, acceleration: number, deceleration: number, dt: number): number {
  const speedingUp = target !== 0 && Math.sign(target) === Math.sign(current || target) && Math.abs(target) > Math.abs(current);
  return approach(current, target, (speedingUp ? acceleration : deceleration) * dt);
}

export class HunterAI {
  private readonly config: HunterConfig;
  private readonly bounds: { minX: number; maxX: number };
  private readonly waypoints: [number, number];

  private _state: HunterState = "PATROL";
  private _facing: Facing = 1;
  private _velocityX = 0;
  private _caught = false;

  private stateTime = 0;
  private timeSinceSeen = 0;
  private lastKnownX = 0;
  /** Index of the waypoint the Hunter is walking to (or will walk to next). */
  private patrolIndex: 0 | 1 = 1;
  private turnedInIdle = false;
  private searchArrived = false;
  private searchTime = 0;
  private lookTime = 0;
  private previousX: number | null = null;
  private stuckTime = 0;

  /** `homeX` is the centre of the patrol route; `bounds` is the playable range for the Hunter's centre. */
  constructor(config: HunterConfig, homeX: number, bounds: { minX: number; maxX: number }) {
    this.config = config;
    this.bounds = bounds;
    const clamp = (x: number) => Math.min(Math.max(x, bounds.minX), bounds.maxX);
    this.waypoints = [clamp(homeX - config.patrolRadius), clamp(homeX + config.patrolRadius)];
  }

  get state(): HunterState {
    return this._state;
  }
  get facing(): Facing {
    return this._facing;
  }
  get velocityX(): number {
    return this._velocityX;
  }
  get caught(): boolean {
    return this._caught;
  }
  get patrolWaypoints(): readonly [number, number] {
    return this.waypoints;
  }

  /** Back to a fresh patrol (used when a run restarts). */
  reset() {
    this._state = "PATROL";
    this._facing = 1;
    this._velocityX = 0;
    this._caught = false;
    this.patrolIndex = 1;
    this.stateTime = 0;
    this.timeSinceSeen = 0;
    this.turnedInIdle = false;
    this.searchArrived = false;
    this.previousX = null;
    this.stuckTime = 0;
  }

  update(deltaSeconds: number, percept: HunterPercept): HunterFrame {
    const dt = Math.min(Math.max(deltaSeconds, 0), MAX_DELTA_SECONDS);
    const events: HunterEvent[] = [];
    const cfg = this.config;
    this.stateTime += dt;

    // Is the Hunter trying to walk but not getting anywhere (blocked by terrain)?
    const movedSpeed = this.previousX === null || dt === 0 ? Infinity : Math.abs(percept.position.x - this.previousX) / dt;
    this.stuckTime = Math.abs(this._velocityX) >= STUCK_MIN_SPEED && movedSpeed < STUCK_MAX_MOVED ? this.stuckTime + dt : 0;
    this.previousX = percept.position.x;

    let desiredSpeed = 0;
    if (this._caught) {
      // Standing down: brake to a stop.
    } else if (percept.contact) {
      this._caught = true;
      events.push({ type: "PLAYER_CAUGHT" });
      this.enter("IDLE", events);
    } else {
      desiredSpeed = this.think(dt, percept, events);
    }

    // Never push against the edge of the world.
    const x = percept.position.x;
    if ((x <= this.bounds.minX && desiredSpeed < 0) || (x >= this.bounds.maxX && desiredSpeed > 0)) desiredSpeed = 0;
    let velocity = stepSpeed(this._velocityX, desiredSpeed, cfg.acceleration, cfg.deceleration, dt);
    if ((x <= this.bounds.minX && velocity < 0) || (x >= this.bounds.maxX && velocity > 0)) velocity = 0;
    this._velocityX = velocity;

    return { state: this._state, facing: this._facing, velocityX: velocity, caught: this._caught, events };
  }

  /** Runs the current state and returns the speed (signed, px/s) the Hunter is trying to reach. */
  private think(dt: number, p: HunterPercept, events: HunterEvent[]): number {
    const cfg = this.config;
    const x = p.position.x;
    const dx = p.target.x - x;

    // An unaware Hunter (patrolling, idling or searching) notices Rara inside its cone.
    if (
      (this._state === "PATROL" || this._state === "IDLE" || this._state === "LOST") &&
      detectTarget(p.position, this._facing, p.target, cfg, p.blockers, "cone")
    ) {
      this.lastKnownX = this.clampX(p.target.x);
      this.timeSinceSeen = 0;
      events.push({ type: "PLAYER_DETECTED" });
      this.enter("ALERT", events);
      this.faceToward(dx);
      return 0;
    }

    switch (this._state) {
      case "PATROL": {
        const waypoint = this.waypoints[this.patrolIndex];
        const toWaypoint = waypoint - x;
        // A blocked route end counts as reached: turn around instead of pushing on the obstacle forever.
        if (Math.abs(toWaypoint) <= cfg.arriveTolerance || this.stuckTime >= STUCK_SECONDS) {
          this.patrolIndex = this.patrolIndex === 0 ? 1 : 0;
          this.enter("IDLE", events);
          return 0;
        }
        this._facing = toWaypoint > 0 ? 1 : -1;
        return this._facing * cfg.patrolSpeed;
      }

      case "IDLE": {
        // Stand, then turn toward the next waypoint halfway through, so the turn reads before the walk.
        if (!this.turnedInIdle && this.stateTime >= cfg.idleDuration / 2) {
          this._facing = this.waypoints[this.patrolIndex] >= x ? 1 : -1;
          this.turnedInIdle = true;
        }
        if (this.stateTime >= cfg.idleDuration) this.enter("PATROL", events);
        return 0;
      }

      case "ALERT": {
        const sees = detectTarget(p.position, this._facing, p.target, cfg, p.blockers, "tracking");
        if (sees) {
          this.lastKnownX = this.clampX(p.target.x);
          this.timeSinceSeen = 0;
        } else {
          this.timeSinceSeen += dt;
        }
        this.faceToward(this.lastKnownX - x);
        if (this.stateTime >= cfg.alertDuration) this.enter(sees ? "CHASE" : "LOST", events);
        return 0;
      }

      case "CHASE": {
        const sees = detectTarget(p.position, this._facing, p.target, cfg, p.blockers, "tracking");
        if (sees) {
          this.lastKnownX = this.clampX(p.target.x);
          this.timeSinceSeen = 0;
        } else {
          this.timeSinceSeen += dt;
        }
        if (this.timeSinceSeen >= cfg.lostDelay) {
          events.push({ type: "PLAYER_LOST" });
          this.enter("LOST", events);
          return 0;
        }
        // Head for where Rara is (or was last seen). Right on top of her, stop steering rather than flip-flop.
        const toGoal = this.lastKnownX - x;
        if (Math.abs(toGoal) <= cfg.turnDeadzone) return 0;
        this._facing = toGoal > 0 ? 1 : -1;
        return this._facing * cfg.chaseSpeed;
      }

      case "LOST": {
        if (!this.searchArrived) {
          const toPoint = this.lastKnownX - x;
          if (Math.abs(toPoint) <= cfg.arriveTolerance || this.stuckTime >= STUCK_SECONDS) {
            this.searchArrived = true;
            this.searchTime = 0;
            this.lookTime = 0;
            return 0;
          }
          this._facing = toPoint > 0 ? 1 : -1;
          return this._facing * cfg.searchSpeed;
        }
        this.searchTime += dt;
        this.lookTime += dt;
        if (this.lookTime >= cfg.searchLookInterval) {
          this.lookTime -= cfg.searchLookInterval;
          this._facing = this._facing === 1 ? -1 : 1;
        }
        if (this.searchTime >= cfg.searchDuration) {
          // Resume the patrol from whichever end of the route is nearer.
          this.patrolIndex = Math.abs(this.waypoints[0] - x) <= Math.abs(this.waypoints[1] - x) ? 0 : 1;
          this.enter("PATROL", events);
        }
        return 0;
      }
    }
  }

  private enter(next: HunterState, events: HunterEvent[]) {
    if (next === this._state) return;
    events.push({ type: "STATE_CHANGED", from: this._state, to: next });
    this._state = next;
    this.stateTime = 0;
    this.stuckTime = 0;
    this.turnedInIdle = false;
    if (next === "LOST") {
      this.searchArrived = false;
      this.searchTime = 0;
      this.lookTime = 0;
    }
  }

  private faceToward(dx: number) {
    if (dx !== 0) this._facing = dx > 0 ? 1 : -1;
  }

  private clampX(x: number): number {
    return Math.min(Math.max(x, this.bounds.minX), this.bounds.maxX);
  }
}
