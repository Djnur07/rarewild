/**
 * Rara: the playable monkey. `CharacterAnimation + RareWildSkin = Rara`.
 *
 * ONE Phaser Sprite class driven by the shared animation set
 * (public/assets/character/animations/*). Animation state controls pose and
 * movement feel; the active skin only chooses WHICH textures those same
 * animations play from:
 *
 *   - no skin key      -> the default sheets ("rara-<state>")
 *   - a skin key       -> that skin's recolored sheets ("rara-skin-<key>-<state>")
 *
 * `setAnimationState` checks per state that the skin's animation exists and
 * otherwise falls back to the default one, so a skin that isn't fully built
 * degrades gracefully instead of breaking gameplay. This class never loads
 * or generates assets itself (see skinTextures.ts) and knows nothing about
 * tokens or metadata.
 *
 * `Phaser` isn't imported at module scope: components/Game.tsx loads Phaser
 * with a dynamic `import("phaser")` (it touches browser globals on import),
 * so this file exports a factory taking the loaded namespace. `import type`
 * is erased at compile time.
 */

import type Phaser from "phaser";
import { ANIMATION_SHEETS, CONTINUOUS_ANIMATION_STATES, skinTextureKey } from "./animationManifest.ts";
import type { CharacterAnimationState } from "./types.ts";

export function createRaraCharacterClass(PhaserNS: typeof Phaser) {
  return class RaraCharacter extends PhaserNS.GameObjects.Sprite {
    private skinKey: string | null = null;
    /** Named `animState` (not `state`) to avoid colliding with Phaser's own `GameObject#state`. */
    private animState: CharacterAnimationState = "idle";

    constructor(scene: Phaser.Scene, x: number, y: number) {
      super(scene, x, y, ANIMATION_SHEETS.idle.textureKey, 0);
      scene.add.existing(this);
      this.setAnimationState("idle");
    }

    getAnimationState(): CharacterAnimationState {
      return this.animState;
    }

    getSkinKey(): string | null {
      return this.skinKey;
    }

    /** Mirror the sprite to face movement direction. Rendering-only; no gameplay effect. */
    setFacing(direction: 1 | -1) {
      this.setFlipX(direction < 0);
    }

    /**
     * Switch skin (null = default look). The current animation keeps playing
     * from the same frame, so swapping skins never interrupts a jump/run.
     */
    setSkinKey(skinKey: string | null) {
      if (this.skinKey === skinKey) return;
      this.skinKey = skinKey;
      const frameIndex = this.anims.currentFrame ? this.anims.currentFrame.index - 1 : 0;
      this.playState(this.animState, frameIndex);
    }

    /**
     * Switch to the named animation state. Continuous states (idle/run) are
     * a no-op when already active, so per-frame callers (e.g. held movement
     * keys) don't restart the loop every tick. One-shot states always
     * replay from the start.
     */
    setAnimationState(next: CharacterAnimationState) {
      if (this.animState === next && CONTINUOUS_ANIMATION_STATES.has(next)) {
        return;
      }
      this.animState = next;
      this.playState(next, 0);
    }

    private playState(state: CharacterAnimationState, startFrame: number) {
      const sheet = ANIMATION_SHEETS[state];
      const skinned = this.skinKey ? skinTextureKey(state, this.skinKey) : null;
      const key = skinned && this.scene.anims.exists(skinned) ? skinned : sheet.textureKey;
      this.play({ key, startFrame: Math.min(Math.max(startFrame, 0), sheet.frameCount - 1) });
    }
  };
}

export type RaraCharacter = InstanceType<ReturnType<typeof createRaraCharacterClass>>;
