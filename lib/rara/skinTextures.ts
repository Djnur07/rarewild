/**
 * Builds and caches the Phaser textures behind a RAREWILD skin.
 *
 *  - Body color: the 7 default sheets are recolored once per body color on a
 *    canvas (lib/rara/recolor.ts) and registered as extra textures +
 *    animations. There are only 10 body colors, so the cache is bounded and
 *    picking the same color again — from any token — is free.
 *  - Portrait: the token's real 800x800 artwork, loaded on demand for the one
 *    selected token (never preloaded), kept in a small LRU cache so flipping
 *    between a few skins doesn't re-download anything.
 */

import type Phaser from "phaser";
import { BODY_COLOR_RECOLOR, isIdentityRecolor } from "../rareWild/bodyColor.ts";
import type { RareWildBodyColor } from "../rareWild/traits.ts";
import type { RareWildSkin } from "../rareWild/types.ts";
import { ANIMATION_SHEETS, ANIMATION_STATES, skinTextureKey } from "./animationManifest.ts";
import { recolorRgba } from "./recolor.ts";

/** Slug used inside texture keys and as the character's skin key. */
export function bodyColorSkinKey(bodyColor: RareWildBodyColor): string {
  return bodyColor.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Make sure the recolored sheets + animations for `bodyColor` exist and
 * return their skin key. Returns null when the default sheets already look
 * right (Original Brown) or the recolor couldn't be built — the character
 * then simply keeps the default look.
 */
export function ensureBodyColorSkin(scene: Phaser.Scene, bodyColor: RareWildBodyColor): string | null {
  const recolor = BODY_COLOR_RECOLOR[bodyColor];
  if (!recolor || isIdentityRecolor(recolor)) return null;

  const skinKey = bodyColorSkinKey(bodyColor);
  for (const state of ANIMATION_STATES) {
    const sheet = ANIMATION_SHEETS[state];
    const key = skinTextureKey(state, skinKey);
    if (scene.anims.exists(key)) continue;

    if (!scene.textures.exists(key)) {
      const source = scene.textures.get(sheet.textureKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      recolorRgba(pixels.data, recolor);
      context.putImageData(pixels, 0, 0);

      const texture = scene.textures.addCanvas(key, canvas);
      if (!texture) return null;
      for (let frame = 0; frame < sheet.frameCount; frame++) {
        texture.add(frame, 0, frame * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight);
      }
    }

    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key, { start: 0, end: sheet.frameCount - 1 }),
      frameRate: sheet.frameRate,
      repeat: sheet.repeat,
    });
  }
  return skinKey;
}

/** Anything that can wear a skin key (RaraCharacter). */
export interface SkinnableCharacter {
  setSkinKey(skinKey: string | null): void;
}

/** Apply a skin's look to the character. The default skin (or anything unbuildable) restores the default look. */
export function applyRareWildSkin(scene: Phaser.Scene, character: SkinnableCharacter, skin: RareWildSkin) {
  character.setSkinKey(skin.isDefault ? null : ensureBodyColorSkin(scene, skin.bodyColor));
}

// ---------------------------------------------------------------- portraits

const MAX_CACHED_PORTRAITS = 8;

type PortraitState = {
  /** Least-recently-used first. */
  order: number[];
  loading: Map<number, Promise<string | null>>;
};

const portraitStates = new WeakMap<Phaser.Scene, PortraitState>();

function portraitKey(tokenId: number): string {
  return `rarewild-portrait-${tokenId}`;
}

function stateFor(scene: Phaser.Scene): PortraitState {
  let state = portraitStates.get(scene);
  if (!state) {
    state = { order: [], loading: new Map() };
    portraitStates.set(scene, state);
  }
  return state;
}

function touch(state: PortraitState, tokenId: number) {
  state.order = state.order.filter((id) => id !== tokenId);
  state.order.push(tokenId);
}

function evictOldest(scene: Phaser.Scene, state: PortraitState, keep: number) {
  while (state.order.length > MAX_CACHED_PORTRAITS) {
    const index = state.order.findIndex((id) => id !== keep);
    if (index < 0) return;
    const [evicted] = state.order.splice(index, 1);
    scene.textures.remove(portraitKey(evicted));
  }
}

/**
 * Ensure the token's artwork is in the texture cache and resolve its
 * texture key (null if it failed to load — the caller just shows no
 * portrait). Concurrent and repeated requests share one download.
 */
export function ensureSkinPortrait(scene: Phaser.Scene, skin: RareWildSkin): Promise<string | null> {
  if (skin.isDefault) return Promise.resolve(null);
  const key = portraitKey(skin.tokenId);
  const state = stateFor(scene);

  if (scene.textures.exists(key)) {
    touch(state, skin.tokenId);
    return Promise.resolve(key);
  }
  const inFlight = state.loading.get(skin.tokenId);
  if (inFlight) return inFlight;

  const promise = new Promise<string | null>((resolve) => {
    const finish = (result: string | null) => {
      scene.load.off(`filecomplete-image-${key}`, onComplete);
      scene.load.off("loaderror", onError);
      state.loading.delete(skin.tokenId);
      if (result) {
        touch(state, skin.tokenId);
        evictOldest(scene, state, skin.tokenId);
      }
      resolve(result);
    };
    const onComplete = () => finish(key);
    const onError = (file: { key: string }) => {
      if (file.key === key) finish(null);
    };
    scene.load.on(`filecomplete-image-${key}`, onComplete);
    scene.load.on("loaderror", onError);
    scene.load.image(key, skin.imagePath);
    if (!scene.load.isLoading()) scene.load.start();
  });
  state.loading.set(skin.tokenId, promise);
  return promise;
}
