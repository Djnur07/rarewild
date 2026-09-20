/**
 * How an obstacle is drawn. Gameplay (the collision boxes) never depends on the view: swap the
 * placeholder art by passing a different `ObstacleViewFactory` to `createObstacles`. The art must
 * fill the obstacle's pieces exactly (what you see is what you collide with).
 *
 * The view gets the whole obstacle (its type and kind) and the box of every piece, so it can draw
 * each type differently.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ObstacleSpec } from "./types.ts";

export interface ObstacleView {
  destroy(): void;
}

/** `rects[i]` is the box of `spec.pieces[i]`, in world px. */
export type ObstacleViewFactory = (scene: Phaser.Scene, spec: ObstacleSpec, rects: Rect[]) => ObstacleView;
