/**
 * How an obstacle is drawn. Gameplay (the collision box) never depends on the
 * view: swap the placeholder art by passing a different `ObstacleViewFactory`
 * to `createObstacles`. Art must fill the obstacle's box exactly.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ObstacleSpec } from "./types.ts";

export interface ObstacleView {
  destroy(): void;
}

export type ObstacleViewFactory = (scene: Phaser.Scene, spec: ObstacleSpec, rect: Rect) => ObstacleView;
