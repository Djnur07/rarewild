/**
 * How the exit looks and reacts. Gameplay only calls these methods; swap the
 * placeholder by passing a different `ExitViewFactory` to `ExitGate`.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";

export interface ExitView {
  /** Show the locked look (also used on restart). */
  lock(): void;
  /** Show the open look. `animate` plays the short unlock effect (off when restoring state silently). */
  open(animate: boolean): void;
  /** Rara touched the locked gate: shake it and say what is missing. Rate limiting is up to the view. */
  rejectTouch(collected: number, total: number, nowMs: number): void;
  /** Idle animation, every frame. */
  update(timeMs: number): void;
  destroy(): void;
}

export type ExitViewFactory = (scene: Phaser.Scene, box: Rect) => ExitView;
