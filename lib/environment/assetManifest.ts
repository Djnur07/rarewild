/**
 * Environment asset manifest — the single source of truth for every real
 * mangrove environment asset's path and its target in-game pixel size.
 *
 * Source: the real asset package at
 * the mangrove environment package (its own
 * visual-notes/build_environment.py documents each asset's canvas size and
 * which are mathematically tileable — verified against the actual shipped
 * SVGs' viewBox attributes, not assumed). Files were copied unmodified into
 * public/assets/environment/, organized by category.
 *
 * `width`/`height` below are NOT the source viewBox — they're this asset's
 * target on-screen pixel size for this game, i.e. `this.load.svg()` is
 * asked to rasterize directly at game scale, so nothing downstream needs a
 * second runtime resize. The exact per-category scale factors (and the
 * ground/water/water-edge vertical alignment they share) were worked out
 * and visually verified against a composited mockup before being hardcoded
 * here — see EnvironmentLayer.ts for the alignment math itself.
 *
 *   sky (far/mid background):  scale = worldHeight/1080 -> baked at 1067x600 for a 600-tall canvas
 *   mist background:           scale = 0.45              -> 864x189  (source 1920x420)
 *   mist foreground:           scale = 0.5                -> 960x180  (source 1920x360)
 *   gameplay (ground/water/water-edge): scale = 220/460 ≈ 0.478 -> matches build_environment.py's own GROUND_HEIGHT=460 canvas at a 220px-tall in-game band
 *   decorative (trees/roots/foliage):   scale = 0.42
 *   distant silhouette:        scale = 0.32
 */

import type { EnvironmentAssetConfig, EnvironmentAssetKey } from "./types.ts";

export const ENVIRONMENT_ASSET_BASE = "/assets/environment";

function asset(
  key: EnvironmentAssetKey,
  path: string,
  width: number,
  height: number,
  tileable: boolean,
): EnvironmentAssetConfig {
  return { key, path: `${ENVIRONMENT_ASSET_BASE}${path}`, width, height, tileable };
}

export const ENVIRONMENT_ASSETS: Record<EnvironmentAssetKey, EnvironmentAssetConfig> = {
  "background-far": asset("background-far", "/background/mangrove-background-far.svg", 1067, 600, true),
  "background-mid": asset("background-mid", "/background/mangrove-background-mid.svg", 1067, 600, true),
  "mist-background": asset("mist-background", "/atmosphere/mist-background.svg", 864, 189, true),
  "mist-foreground": asset("mist-foreground", "/atmosphere/mist-foreground.svg", 960, 180, true),
  ground: asset("ground", "/gameplay/mangrove-ground.svg", 918, 220, true),
  water: asset("water", "/gameplay/mangrove-water.svg", 918, 153, true),
  "water-edge": asset("water-edge", "/gameplay/mangrove-water-edge.svg", 230, 153, false),
  "root-small": asset("root-small", "/roots/mangrove-root-small.svg", 109, 59, false),
  "root-medium": asset("root-medium", "/roots/mangrove-root-medium.svg", 160, 80, false),
  "root-large": asset("root-large", "/roots/mangrove-root-large.svg", 235, 109, false),
  "tree-small": asset("tree-small", "/trees/mangrove-tree-small.svg", 134, 193, false),
  "tree-medium": asset("tree-medium", "/trees/mangrove-tree-medium.svg", 202, 286, false),
  "tree-large": asset("tree-large", "/trees/mangrove-tree-large.svg", 286, 403, false),
  "tree-silhouette": asset("tree-silhouette", "/trees/mangrove-tree-silhouette.svg", 218, 307, false),
  "foliage-small": asset("foliage-small", "/foliage/foliage-small.svg", 92, 76, false),
  "foliage-medium": asset("foliage-medium", "/foliage/foliage-medium.svg", 143, 109, false),
  "foliage-large": asset("foliage-large", "/foliage/foliage-large.svg", 193, 143, false),
  "foliage-hanging": asset("foliage-hanging", "/foliage/foliage-hanging.svg", 126, 109, false),
};

export const ENVIRONMENT_ASSET_KEYS = Object.keys(ENVIRONMENT_ASSETS) as EnvironmentAssetKey[];

/** Ground-alignment constants shared by EnvironmentLayer.ts (kept here, next to the scale factors they depend on). */
export const GROUND_MUD_SOURCE_Y = 90; // build_environment.py: top_y = 90 within the 460-tall ground canvas
export const WATER_EDGE_SHORE_SOURCE_Y = 150; // build_environment.py: shore_y = 150 within the 320-tall water-edge canvas
export const GAMEPLAY_SCALE = 220 / 460;
