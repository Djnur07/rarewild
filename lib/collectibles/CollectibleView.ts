/**
 * How a collectible is drawn and how its pickup feels. Gameplay only calls
 * these four methods; swap the placeholder by passing a different
 * `CollectibleViewFactory` to `Collectibles`.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";

export interface CollectibleView {
  /** Idle animation (bobbing/glow), called every frame while it is waiting to be collected. */
  update(timeMs: number): void;
  /** Play the pickup effect, then hide. */
  collect(): void;
  /** Back to the uncollected look (a restart). */
  show(): void;
  destroy(): void;
}

export type CollectibleViewFactory = (scene: Phaser.Scene, x: number, y: number, radius: number) => CollectibleView;
