/**
 * Phaser Loader wiring for the mangrove environment assets. Mirrors
 * lib/rara/loader.ts: a pure function over an already-constructed
 * `Phaser.Scene`, only `import type Phaser` (zero runtime Phaser
 * dependency, SSR-safe), called from a Scene's `preload()`.
 *
 * Loads every asset in the manifest — all 18 are actually used by
 * EnvironmentLayer's built scene (verified: every key appears in at least
 * one `buildX`/decorative placement), so this doesn't pull in anything
 * unrelated to what's rendered.
 */

import type Phaser from "phaser";
import { ENVIRONMENT_ASSETS, ENVIRONMENT_ASSET_KEYS } from "./assetManifest.ts";

/**
 * `textureScale` (default 1) rasterises every SVG that many times larger than its game size, for a screen that shows
 * the world magnified (a phone: see lib/render/quality.ts). EnvironmentLayer scales the results back down.
 */
export function preloadEnvironmentAssets(scene: Phaser.Scene, textureScale = 1) {
  for (const key of ENVIRONMENT_ASSET_KEYS) {
    const asset = ENVIRONMENT_ASSETS[key];
    scene.load.svg(asset.key, asset.path, { width: asset.width * textureScale, height: asset.height * textureScale });
  }
}
