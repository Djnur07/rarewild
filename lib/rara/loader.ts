/**
 * Phaser Loader/AnimationManager wiring for Rara's default sprite sheets.
 * Pure functions over an already-constructed `Phaser.Scene`; only
 * `import type Phaser` so the module stays SSR-safe (Phaser needs browser
 * globals just to be imported — see RaraCharacter.ts).
 */

import type Phaser from "phaser";
import { ANIMATION_SHEETS, ANIMATION_STATES } from "./animationManifest.ts";

export function preloadRaraAssets(scene: Phaser.Scene) {
  for (const state of ANIMATION_STATES) {
    const sheet = ANIMATION_SHEETS[state];
    scene.load.spritesheet(sheet.textureKey, sheet.path, {
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
    });
  }
}

/** Animations are global, so registering more than once is a safe no-op. */
export function registerRaraAnimations(scene: Phaser.Scene) {
  for (const state of ANIMATION_STATES) {
    const sheet = ANIMATION_SHEETS[state];
    if (scene.anims.exists(sheet.textureKey)) continue;

    scene.anims.create({
      key: sheet.textureKey,
      frames: scene.anims.generateFrameNumbers(sheet.textureKey, {
        start: 0,
        end: sheet.frameCount - 1,
      }),
      frameRate: sheet.frameRate,
      repeat: sheet.repeat,
    });
  }
}
