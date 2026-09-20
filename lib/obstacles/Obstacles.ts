/**
 * Obstacles as real gameplay objects: every piece of every obstacle is an invisible static Arcade
 * body added to the shared `solids` group, so it collides with Rara AND the Hunters through the
 * colliders that already exist, and blocks the Hunter's line of sight (Hunter.ts reads every
 * solid). Decorative scenery is never added here, so it stays non-solid.
 *
 * Because they are ordinary solids, Rara collides with the sides (she cannot walk through them),
 * can jump over them, and can land on top of any piece and jump again (the motor's ground check
 * is "is anything under my feet"), which is what makes platforms, stacked steps and pillar-hopping
 * work with no special cases.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ObstacleView, ObstacleViewFactory } from "./ObstacleView.ts";
import { FIRST_LEVEL_OBSTACLES } from "./placement.ts";
import { createPlaceholderObstacleView } from "./PlaceholderObstacleView.ts";
import { obstacleRects } from "./shapes.ts";
import type { ObstacleSpec } from "./types.ts";

export interface PlacedObstacle {
  spec: ObstacleSpec;
  /** The box of each piece, in the same order as `spec.pieces`. */
  pieces: Rect[];
}

export interface ObstacleField {
  obstacles: readonly PlacedObstacle[];
  destroy(): void;
}

export function createObstacles(
  scene: Phaser.Scene,
  solids: Phaser.Physics.Arcade.StaticGroup,
  groundSurfaceY: number,
  specs: readonly ObstacleSpec[] = FIRST_LEVEL_OBSTACLES,
  createView: ObstacleViewFactory = createPlaceholderObstacleView,
): ObstacleField {
  const placed: PlacedObstacle[] = [];
  const zones: Phaser.GameObjects.Zone[] = [];
  const views: ObstacleView[] = [];

  for (const spec of specs) {
    const rects = obstacleRects(spec, groundSurfaceY);
    for (const rect of rects) {
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      const zone = scene.add.zone(rect.left + width / 2, rect.top + height / 2, width, height);
      solids.add(zone);
      zones.push(zone);
    }
    views.push(createView(scene, spec, rects));
    placed.push({ spec, pieces: rects });
  }

  return {
    obstacles: placed,
    destroy() {
      for (const zone of zones) solids.remove(zone, true, true);
      for (const view of views) view.destroy();
    },
  };
}
