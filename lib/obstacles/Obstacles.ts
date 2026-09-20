/**
 * Obstacles as real gameplay objects: each one is an invisible static Arcade
 * body added to the shared `solids` group, so it collides with Rara AND the
 * Hunter through the colliders that already exist, and blocks the Hunter's
 * line of sight (Hunter.ts reads every solid). Decorative scenery is never
 * added here, so it stays non-solid.
 *
 * Because they are ordinary solids, Rara collides with the sides (she
 * cannot walk through them), can jump over them, and can land on top and
 * jump again (the motor's ground check is "is anything under my feet").
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ObstacleView, ObstacleViewFactory } from "./ObstacleView.ts";
import { FIRST_LEVEL_OBSTACLES, obstacleRect } from "./placement.ts";
import { createPlaceholderObstacleView } from "./PlaceholderObstacleView.ts";
import type { ObstacleSpec } from "./types.ts";

export interface PlacedObstacle {
  spec: ObstacleSpec;
  rect: Rect;
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
  const parts: { zone: Phaser.GameObjects.Zone; view: ObstacleView }[] = [];

  for (const spec of specs) {
    const rect = obstacleRect(spec, groundSurfaceY);
    const zone = scene.add.zone(spec.x, rect.top + spec.height / 2, spec.width, spec.height);
    solids.add(zone);
    parts.push({ zone, view: createView(scene, spec, rect) });
    placed.push({ spec, rect });
  }

  return {
    obstacles: placed,
    destroy() {
      for (const { zone, view } of parts) {
        solids.remove(zone, true, true);
        view.destroy();
      }
    },
  };
}
