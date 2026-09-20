/**
 * Hunter: the enemy as a game entity. It glues together
 *   - HunterAI        (decisions: pure, testable),
 *   - an Arcade body  (position, gravity, ground and world-bounds collisions),
 *   - a HunterView    (drawing: replaceable placeholder art).
 * Each frame the scene tells it where Rara is; it runs the AI, applies the
 * AI's velocity to its body and updates the view. It never moves itself by
 * hand (so no teleporting and no walking through terrain) and knows nothing
 * about wallets, tokens or skins.
 *
 * The body is an invisible Zone, so the visible art can change freely without
 * touching physics. It collides with the same static `solids` as Rara and its
 * sight is blocked by them (see DetectionSystem.ts).
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { HunterConfig } from "./config.ts";
import { rectsOverlap } from "./DetectionSystem.ts";
import { HunterAI } from "./HunterAI.ts";
import type { HunterView, HunterViewFactory } from "./HunterView.ts";
import { createPlaceholderHunterView } from "./PlaceholderHunterView.ts";
import type { HunterEvent, HunterState, Rect } from "./types.ts";

/** Rara as the Hunter sees her: a centre point and a body box, in world px. */
export interface HunterTarget {
  x: number;
  y: number;
  rect: Rect;
}

export interface HunterOptions {
  config: HunterConfig;
  /** Centre of the patrol route, world px. */
  spawnX: number;
  /** Top of the walkable ground, world px; the Hunter stands on it. */
  groundSurfaceY: number;
  /** Playable range for the Hunter's centre, world px. */
  bounds: { minX: number; maxX: number };
  /** Static colliders the Hunter walks on and cannot see through. */
  solids: Phaser.Physics.Arcade.StaticGroup;
  /** Called for every gameplay event (STATE_CHANGED, PLAYER_DETECTED, PLAYER_LOST, PLAYER_CAUGHT). */
  onEvent?: (event: HunterEvent) => void;
  /** Swap the placeholder art. */
  createView?: HunterViewFactory;
}

const MAX_FALL_SPEED = 1000;

export class Hunter {
  private readonly scene: Phaser.Scene;
  private readonly options: HunterOptions;
  private readonly ai: HunterAI;
  private readonly view: HunterView;
  private readonly carrier: Phaser.GameObjects.Zone;
  private readonly body: Phaser.Physics.Arcade.Body;

  constructor(scene: Phaser.Scene, options: HunterOptions) {
    this.scene = scene;
    this.options = options;
    const { config, spawnX, groundSurfaceY, bounds, solids } = options;

    this.ai = new HunterAI(config, spawnX, bounds);
    this.carrier = scene.add.zone(spawnX, groundSurfaceY - config.body.height / 2, config.body.width, config.body.height);
    scene.physics.add.existing(this.carrier);
    this.body = this.carrier.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setMaxVelocity(config.chaseSpeed * 2, MAX_FALL_SPEED);
    scene.physics.add.collider(this.carrier, solids);

    this.view = (options.createView ?? createPlaceholderHunterView)(scene, config);
    this.syncView();
  }

  get state(): HunterState {
    return this.ai.state;
  }
  get x(): number {
    return this.body.center.x;
  }
  get y(): number {
    return this.body.center.y;
  }
  get caught(): boolean {
    return this.ai.caught;
  }

  /** Call once per frame with the scene's frame time (ms) and Rara's current position. */
  update(deltaMs: number, target: HunterTarget) {
    const { config, solids } = this.options;
    const me = this.body;
    const blockers: Rect[] = solids.getChildren().map((child) => {
      const b = child.body as Phaser.Physics.Arcade.StaticBody;
      return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
    });
    const myRect: Rect = { left: me.left, top: me.top, right: me.right, bottom: me.bottom };

    const frame = this.ai.update(deltaMs / 1000, {
      position: { x: me.center.x, y: me.center.y },
      target: { x: target.x, y: target.y },
      blockers,
      contact: rectsOverlap(myRect, target.rect, config.contactInset),
    });

    me.setVelocityX(frame.velocityX);
    this.syncView();
    if (this.options.onEvent) for (const event of frame.events) this.options.onEvent(event);
  }

  /** Back to the start of the patrol (used when a run restarts). */
  reset() {
    const { config, spawnX, groundSurfaceY } = this.options;
    this.ai.reset();
    this.body.reset(spawnX, groundSurfaceY - config.body.height / 2);
    this.syncView();
  }

  destroy() {
    this.view.destroy();
    this.carrier.destroy();
  }

  private syncView() {
    this.view.update({ x: this.body.center.x, y: this.body.center.y, facing: this.ai.facing, state: this.ai.state, caught: this.ai.caught });
  }
}
