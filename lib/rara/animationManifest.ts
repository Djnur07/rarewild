/**
 * Rara animation sheet manifest.
 *
 * Frame geometry was verified against the spritesheet descriptors in
 * public/assets/character/animations/<state>/<state>-spritesheet.json (and
 * the PNG pixel sizes). Every sheet is a 300x300-per-frame single-row strip.
 * If the sheets are ever regenerated with different geometry, update this
 * manifest to match.
 */

import type { CharacterAnimationState } from "./types.ts";

export interface AnimationSheetConfig {
  state: CharacterAnimationState;
  /** Phaser texture cache key AND the global animation key. */
  textureKey: string;
  /** Public path to the spritesheet PNG. */
  path: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  frameRate: number;
  /** -1 = loop forever, 0 = play once and hold the last frame. */
  repeat: number;
}

export const CHARACTER_ASSET_BASE = "/assets/character";

function sheet(
  state: CharacterAnimationState,
  frameCount: number,
  frameRate: number,
  repeat: number,
): AnimationSheetConfig {
  return {
    state,
    textureKey: `rara-${state}`,
    path: `${CHARACTER_ASSET_BASE}/animations/${state}/${state}-spritesheet.png`,
    frameWidth: 300,
    frameHeight: 300,
    frameCount,
    frameRate,
    repeat,
  };
}

export const ANIMATION_SHEETS: Record<CharacterAnimationState, AnimationSheetConfig> = {
  idle: sheet("idle", 6, 8, -1),
  run: sheet("run", 8, 14, -1),
  jump: sheet("jump", 6, 14, 0),
  land: sheet("land", 4, 12, 0),
  collect: sheet("collect", 5, 16, 0),
  swing: sheet("swing", 6, 12, 0),
  hit: sheet("hit", 4, 16, 0),
};

export const ANIMATION_STATES = Object.keys(ANIMATION_SHEETS) as CharacterAnimationState[];

/** States that loop continuously while active (vs. one-shot). */
export const CONTINUOUS_ANIMATION_STATES = new Set<CharacterAnimationState>(
  ANIMATION_STATES.filter((state) => ANIMATION_SHEETS[state].repeat === -1),
);

/** Texture/animation key of one state's sheet under a skin ("rara-skin-<skinKey>-<state>"). */
export function skinTextureKey(state: CharacterAnimationState, skinKey: string): string {
  return `rara-skin-${skinKey}-${state}`;
}
