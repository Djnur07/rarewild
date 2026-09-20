/**
 * Phaser Arcade wiring for Rara's movement: the character's physics body, the
 * world's playable bounds and the static solids (ground today; platforms,
 * logs or other obstacles later) the character stands on.
 *
 * Pure functions over an already-constructed scene/sprite; only `import type
 * Phaser` so the module stays SSR-safe (see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { MovementConfig } from "./config.ts";

/**
 * Rara's collision box, in unscaled sprite-frame pixels (every animation frame
 * is 300x300; see lib/rara/animationManifest.ts). It covers the body from the
 * head down to the feet (frame y 65-275) and is deliberately narrower than the
 * drawn sprite so the tail doesn't snag on scenery. The box is fixed and
 * skin-independent: skins recolor the same frames.
 */
const BODY = { frameSize: 300, width: 90, height: 210, offsetX: 105, offsetY: 65 };

export type SolidsGroup = Phaser.Physics.Arcade.StaticGroup;

/**
 * Give the character an Arcade body sized for `scale`, keep it inside
 * [minX, maxX] (character-centre coordinates) and cap its fall speed. Gravity
 * comes from the physics world (see `physicsConfig`), tuned per frame by the motor.
 */
export function attachCharacterBody(
  scene: Phaser.Scene,
  character: Phaser.GameObjects.Sprite,
  config: MovementConfig,
  bounds: { minX: number; maxX: number; height: number },
): Phaser.Physics.Arcade.Body {
  scene.physics.add.existing(character);
  const body = character.body as Phaser.Physics.Arcade.Body;
  body.setSize(BODY.width, BODY.height, false).setOffset(BODY.offsetX, BODY.offsetY);
  body.setMaxVelocity(config.maxRunSpeed * 2, config.maxFallSpeed);
  body.setCollideWorldBounds(true);

  // World bounds constrain the body's edges, so widen them by half the body to bound the centre.
  const halfWidth = (BODY.width * character.scaleX) / 2;
  scene.physics.world.setBounds(
    bounds.minX - halfWidth,
    0,
    bounds.maxX - bounds.minX + halfWidth * 2,
    bounds.height,
  );
  return body;
}

/** The character's collision box size in world px at `scale`. */
export function bodySize(scale: number): { width: number; height: number } {
  return { width: BODY.width * scale, height: BODY.height * scale };
}

/** Distance from the character sprite's centre down to the bottom of its collision box (its feet). */
export function feetOffset(scale: number): number {
  return (BODY.offsetY + BODY.height - BODY.frameSize / 2) * scale;
}

/**
 * Create the group of static, immovable colliders and its first member: a
 * ground slab whose walkable top edge is at `surfaceY`. Add future platforms
 * and obstacles to the same group so the one collider keeps covering them.
 */
export function createSolids(scene: Phaser.Scene, worldWidth: number, surfaceY: number, worldHeight: number): SolidsGroup {
  const solids = scene.physics.add.staticGroup();
  const thickness = Math.max(worldHeight - surfaceY, 1);
  const ground = scene.add.zone(worldWidth / 2, surfaceY + thickness / 2, worldWidth, thickness);
  solids.add(ground);
  return solids;
}
