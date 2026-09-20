/**
 * The exit as a game entity: a static gate that is solid while locked and lets
 * Rara through once opened, plus the trigger area that means "reached the
 * exit". It knows nothing about the objective rules; the scene asks
 * `touching()` and the ObjectiveState decides whether that completes the level.
 *
 * The gate is one invisible static body in the shared `solids` group (like the
 * obstacles), switched on and off with the lock, so it uses the colliders that
 * already exist and never needs a new one.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ExitView, ExitViewFactory } from "./ExitView.ts";
import { EXIT_SPEC, exitRect, exitTriggerRect, touchesExit, type ExitSpec } from "./placement.ts";
import { createPlaceholderExitView } from "./PlaceholderExitView.ts";

export interface ExitGateOptions {
  groundSurfaceY: number;
  solids: Phaser.Physics.Arcade.StaticGroup;
  spec?: ExitSpec;
  createView?: ExitViewFactory;
}

export class ExitGate {
  readonly box: Rect;
  private readonly trigger: Rect;
  private readonly body: Phaser.Physics.Arcade.StaticBody;
  private readonly view: ExitView;
  private opened = false;

  constructor(scene: Phaser.Scene, options: ExitGateOptions) {
    const spec = options.spec ?? EXIT_SPEC;
    this.box = exitRect(spec, options.groundSurfaceY);
    this.trigger = exitTriggerRect(spec, options.groundSurfaceY);
    const zone = scene.add.zone(spec.x, this.box.top + spec.height / 2, spec.width, spec.height);
    options.solids.add(zone);
    this.body = zone.body as Phaser.Physics.Arcade.StaticBody;
    this.view = (options.createView ?? createPlaceholderExitView)(scene, this.box);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Is Rara's body at the exit? (Says nothing about whether it may be completed: that is the objective's call.) */
  touching(body: Rect): boolean {
    return touchesExit(body, this.trigger);
  }

  open() {
    if (this.opened) return;
    this.opened = true;
    this.body.enable = false; // the gate stops blocking
    this.view.open(true);
  }

  /** Back to locked: the gate blocks again (a restart). */
  lock() {
    this.opened = false;
    this.body.enable = true;
    this.view.lock();
  }

  /** Rara touched the locked gate. */
  rejectTouch(collected: number, total: number, nowMs: number) {
    this.view.rejectTouch(collected, total, nowMs);
  }

  update(timeMs: number) {
    this.view.update(timeMs);
  }

  destroy() {
    this.view.destroy();
  }
}
