/**
 * Landing detection for the feedback effects, with no Phaser. It only WATCHES Rara's body (is she on
 * the floor, how fast is she falling); it never moves her or changes what the motor does.
 *
 * Arcade zeroes the vertical speed in the step that lands her, so the impact speed is the fastest
 * downward speed seen while she was in the air. A landing counts as "meaningful" only above
 * MIN_IMPACT_SPEED: a walk off a low step or a stutter of the floor flag gives nothing.
 * For scale, with the current jump tuning a hop off the top of a 56px log lands at about 540 px/s and
 * a full 140px jump at about 850 px/s.
 */

/** Below this downward speed (px/s) a landing is not worth marking. */
export const MIN_IMPACT_SPEED = 450;
/** At and above this speed (px/s) a landing is as strong as the effects get. */
export const FULL_IMPACT_SPEED = 900;

/** 0 (not meaningful) .. 1 (the hardest landing) for an impact speed in px/s. */
export function impactStrength(speed: number): number {
  if (speed < MIN_IMPACT_SPEED) return 0;
  return Math.min(1, 0.25 + (0.75 * (speed - MIN_IMPACT_SPEED)) / (FULL_IMPACT_SPEED - MIN_IMPACT_SPEED));
}

export class LandingDetector {
  private airborne = false;
  private peakFall = 0;

  /**
   * Call once per frame with the body's floor flag and vertical speed (px/s, down is positive).
   * Returns the landing strength on the frame she touches down after a meaningful fall, otherwise 0.
   */
  update(onFloor: boolean, velocityY: number): number {
    if (!onFloor) {
      this.airborne = true;
      this.peakFall = Math.max(this.peakFall, velocityY);
      return 0;
    }
    if (!this.airborne) return 0;
    const strength = impactStrength(this.peakFall);
    this.airborne = false;
    this.peakFall = 0;
    return strength;
  }

  /** A restart: forget any flight in progress. */
  reset() {
    this.airborne = false;
    this.peakFall = 0;
  }
}
