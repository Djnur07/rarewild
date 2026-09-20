/**
 * How a Hunter is drawn. The AI and physics never touch this: `Hunter` feeds a
 * view one small frame of facts per update, so the placeholder art below can
 * be swapped for a real sprite by passing a different `HunterViewFactory`.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { HunterConfig } from "./config.ts";
import type { Facing, HunterState } from "./types.ts";

export interface HunterViewFrame {
  /** The Hunter's body centre, world px. */
  x: number;
  y: number;
  facing: Facing;
  state: HunterState;
  /** The Hunter caught Rara and is standing down. */
  caught: boolean;
}

export interface HunterView {
  update(frame: HunterViewFrame): void;
  destroy(): void;
}

export type HunterViewFactory = (scene: Phaser.Scene, config: HunterConfig) => HunterView;
