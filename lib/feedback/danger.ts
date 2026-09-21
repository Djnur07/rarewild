/**
 * How much danger to SHOW, derived only from what the Hunters already report (their public state,
 * position and caught flag). It reads them and draws nothing itself: it never feeds back into the
 * Hunter AI, detection range or speed, so the danger cue cannot change what a Hunter does.
 *
 *   ALERT  the Hunter has just noticed her (the "!" is up): a warning
 *   CHASE  the Hunter is running her down: real danger, stronger the closer it is
 *   any other state (IDLE, PATROL, LOST), or a Hunter that has already caught her: no danger
 *
 * No Phaser, so the numbers are checked in plain Node (scripts/feedback/validate-feedback.ts).
 */

import type { HunterState } from "../hunter/types.ts";

/** The slice of a Hunter this needs (a real `Hunter` satisfies it structurally). */
export interface DangerSource {
  readonly state: HunterState;
  readonly x: number;
  readonly caught: boolean;
}

/** A Hunter this close (px, horizontally) counts as "right on top of her"; farther away the cue eases off. */
export const DANGER_NEAR_PX = 420;
/** The strongest the screen-edge tint ever gets (0..1 alpha), before the pulse. */
export const MAX_EDGE_ALPHA = 0.5;
/** One "lub-dub" every this many ms. */
export const HEARTBEAT_PERIOD_MS = 900;

/** 0 (no danger) .. 1 (a chasing Hunter right beside her): the strongest cue among all Hunters. */
export function dangerLevel(hunters: readonly DangerSource[], raraX: number): number {
  let level = 0;
  for (const hunter of hunters) {
    if (hunter.caught) continue;
    if (hunter.state !== "ALERT" && hunter.state !== "CHASE") continue;
    const closeness = 1 - Math.min(1, Math.abs(hunter.x - raraX) / DANGER_NEAR_PX);
    const value = hunter.state === "CHASE" ? 0.4 + 0.6 * closeness : 0.3 + 0.25 * closeness;
    level = Math.max(level, value);
  }
  return level;
}

/** A two-beat pulse, 0..1, repeating every HEARTBEAT_PERIOD_MS (a strong beat, then a softer one). */
export function heartbeat(timeMs: number): number {
  const phase = (((timeMs % HEARTBEAT_PERIOD_MS) + HEARTBEAT_PERIOD_MS) % HEARTBEAT_PERIOD_MS) / HEARTBEAT_PERIOD_MS;
  const bump = (centre: number, width: number) => {
    const d = Math.min(Math.abs(phase - centre), 1 - Math.abs(phase - centre));
    return Math.exp(-((d / width) ** 2));
  };
  return Math.min(1, bump(0, 0.07) + 0.6 * bump(0.3, 0.07));
}

/**
 * The screen-edge tint alpha for a danger level. Steady with reduced motion (no pulsing at all),
 * otherwise it breathes with the heartbeat but never drops below 70% of its level.
 */
export function dangerEdgeAlpha(level: number, timeMs: number, reducedMotion: boolean): number {
  if (level <= 0) return 0;
  const base = Math.min(1, level) * MAX_EDGE_ALPHA;
  return reducedMotion ? base * 0.85 : base * (0.7 + 0.3 * heartbeat(timeMs));
}
