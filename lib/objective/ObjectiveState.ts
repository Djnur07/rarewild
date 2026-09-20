/**
 * The level's objective as a tiny state machine, with no Phaser: "collect all
 * of the collectibles, then reach the exit".
 *
 *   READY --start()---------------------> PLAYING     (the player pressed PLAY)
 *   PLAYING --caught()------------------> CAUGHT      (the existing Hunter catch)
 *   PLAYING --touchExit(all collected)--> COMPLETE
 *   CAUGHT / COMPLETE --reset()---------> READY       (restart / play again: back to the start screen)
 *
 * A new game and every restart begin in READY: the world is set up but nothing is
 * live (no movement, no pickups, no Hunter targeting) and the timer reads 00:00
 * until the player presses PLAY.
 *
 * The collected count is NOT stored here: the collectible tracker stays the one
 * source of truth (there is no second counter), and is passed in when needed.
 * The exit can only be completed with every item collected; touching it earlier
 * is reported as LOCKED and changes nothing.
 *
 * The timer runs on the scene's own frame deltas (no second loop). It starts at
 * the moment of `start()` (PLAY), keeps running only while PLAYING, and stops for
 * good on CAUGHT or COMPLETE. It never feeds back into gameplay.
 */

export type GamePhase = "READY" | "PLAYING" | "CAUGHT" | "COMPLETE";

/** What touching the exit did: nothing (not playing), it was locked, or it completed the level. */
export type ExitTouchResult = "IGNORED" | "LOCKED" | "COMPLETE";

/** A very long frame (a hidden tab resuming) must not add its whole length to the clock, ms. */
const MAX_STEP_MS = 100;

export class ObjectiveState {
  private readonly total: number;
  private _phase: GamePhase = "READY";
  private _elapsedMs = 0;
  private _startedAtMs: number | null = null;

  constructor(total: number) {
    this.total = total;
  }

  get phase(): GamePhase {
    return this._phase;
  }
  get elapsedMs(): number {
    return this._elapsedMs;
  }
  /** The scene time (ms) at which PLAY was pressed for this run; null while still READY. */
  get startedAtMs(): number | null {
    return this._startedAtMs;
  }

  isExitOpen(collected: number): boolean {
    return collected >= this.total;
  }

  /** The player pressed PLAY: gameplay goes live and the timer starts now (`nowMs` = scene time). Returns whether the phase changed. */
  start(nowMs: number): boolean {
    if (this._phase !== "READY") return false;
    this._phase = "PLAYING";
    this._elapsedMs = 0;
    this._startedAtMs = nowMs;
    return true;
  }

  /** Advance the timer by one frame. Only counts while PLAYING (so 0 before PLAY, and frozen once CAUGHT or COMPLETE). */
  update(deltaMs: number) {
    if (this._phase !== "PLAYING") return;
    this._elapsedMs += Math.min(Math.max(deltaMs, 0), MAX_STEP_MS);
  }

  /** Rara was caught. Only counts while playing (a catch after completion is ignored). Returns whether the phase changed. */
  caught(): boolean {
    if (this._phase !== "PLAYING") return false;
    this._phase = "CAUGHT";
    return true;
  }

  /** Rara is touching the exit. Completes the level only if everything is collected. */
  touchExit(collected: number): ExitTouchResult {
    if (this._phase !== "PLAYING") return "IGNORED";
    if (!this.isExitOpen(collected)) return "LOCKED";
    this._phase = "COMPLETE";
    return "COMPLETE";
  }

  /** Back to the start screen: READY, timer at zero, no start time. The next run begins only when `start()` is called. */
  reset() {
    this._phase = "READY";
    this._elapsedMs = 0;
    this._startedAtMs = null;
  }
}

/** "MM:SS" (minutes keep counting up to 99; anything longer shows 99:59). */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds >= 99 * 60 + 59) return "99:59";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
