/**
 * Where the exit is and what counts as reaching it. Pure data and maths (no
 * Phaser), validated by scripts/objective/validate-objective.ts.
 *
 * The exit is a small gate in the reserved end of the Final Approach (the
 * reserve starts at x=7200; this sits around 7420, with the world's wall at
 * 7540 behind it). While locked it is a solid barrier; it is deliberately BELOW
 * the jump height, so it is a gate to be opened, not a wall that could ever
 * trap Rara if she hopped over it. Completing the level never depends on the
 * barrier: the rule is "all collected AND touching the exit" (ObjectiveState).
 */

import type { Rect } from "../level/geometry.ts";
import { rectsOverlapArea } from "../level/geometry.ts";

export interface ExitSpec {
  /** Horizontal centre, world px. */
  x: number;
  width: number;
  height: number;
}

export const EXIT_SPEC: ExitSpec = { x: 7420, width: 64, height: 120 };

/**
 * Touching the exit means getting this close: the gate's box plus a margin at the sides, and extra
 * room above so that hopping over a locked gate still tells the player it is locked.
 */
export const EXIT_TRIGGER_MARGIN = { side: 16, above: 60 } as const;

/** The gate's solid box, standing on the ground. */
export function exitRect(spec: ExitSpec, groundSurfaceY: number): Rect {
  return {
    left: spec.x - spec.width / 2,
    right: spec.x + spec.width / 2,
    top: groundSurfaceY - spec.height,
    bottom: groundSurfaceY,
  };
}

export function exitTriggerRect(spec: ExitSpec, groundSurfaceY: number): Rect {
  const box = exitRect(spec, groundSurfaceY);
  return {
    left: box.left - EXIT_TRIGGER_MARGIN.side,
    right: box.right + EXIT_TRIGGER_MARGIN.side,
    top: box.top - EXIT_TRIGGER_MARGIN.above,
    bottom: box.bottom,
  };
}

/** Is Rara's body touching the exit's trigger area? */
export function touchesExit(body: Rect, trigger: Rect): boolean {
  return rectsOverlapArea(body, trigger);
}
