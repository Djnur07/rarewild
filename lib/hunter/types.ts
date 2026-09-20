/** The Hunter's behaviour states. */
export type HunterState = "IDLE" | "PATROL" | "ALERT" | "CHASE" | "LOST";

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box in world px. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Facing = 1 | -1;

/** Everything the AI is told about the world for one frame. The AI never reads the scene itself. */
export interface HunterPercept {
  /** The Hunter's own centre. */
  position: Vec2;
  /** Rara's centre. */
  target: Vec2;
  /** Solid geometry that blocks the Hunter's line of sight. */
  blockers: readonly Rect[];
  /** True when the Hunter's body and Rara's body are touching. */
  contact: boolean;
}

/** Gameplay events the AI reports; the scene decides what they mean. */
export type HunterEvent =
  | { type: "STATE_CHANGED"; from: HunterState; to: HunterState }
  /** Rara was first noticed (patrol/idle/lost -> alert). */
  | { type: "PLAYER_DETECTED" }
  /** The chase was given up (chase -> lost). */
  | { type: "PLAYER_LOST" }
  /** The Hunter caught Rara. Reported once; the Hunter then stands down until reset. */
  | { type: "PLAYER_CAUGHT" };

export interface HunterFrame {
  state: HunterState;
  facing: Facing;
  /** The velocity the body should have this frame, px/s (smoothed by acceleration/deceleration). */
  velocityX: number;
  /** True once Rara was caught (until reset). */
  caught: boolean;
  events: HunterEvent[];
}
