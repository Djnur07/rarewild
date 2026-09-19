/**
 * Environment system types. Separate from the character and skin systems — this
 * module never imports character or skin code; it only reuses the plain
 * deterministic PRNG utilities from lib/random/seed.ts.
 */

export type EnvironmentAssetKey =
  | "background-far"
  | "background-mid"
  | "mist-background"
  | "mist-foreground"
  | "ground"
  | "water"
  | "water-edge"
  | "root-small"
  | "root-medium"
  | "root-large"
  | "tree-small"
  | "tree-medium"
  | "tree-large"
  | "tree-silhouette"
  | "foliage-small"
  | "foliage-medium"
  | "foliage-large"
  | "foliage-hanging";

/**
 * One manifest entry. `width`/`height` are the TARGET game-display pixel
 * size this asset is rasterized at on load (`this.load.svg(key, path, {
 * width, height })`), already scaled down from the source SVG's native
 * viewBox for this game's scale (see assetManifest.ts) — not the source
 * viewBox itself. Baking the scale into the loaded texture means the layer
 * builder never needs a second runtime scale step.
 */
export interface EnvironmentAssetConfig {
  key: EnvironmentAssetKey;
  path: string;
  width: number;
  height: number;
  /** Whether the source SVG is mathematically tileable horizontally (see visual-notes/build_environment.py in the source asset package). */
  tileable: boolean;
}

export interface EnvironmentBuildOptions {
  worldWidth: number;
  worldHeight: number;
  /** World y where the character's feet / the ground's mud-line sit — reuse Game.tsx's own GROUND_Y so the character and ground always agree. */
  groundY: number;
  /** Deterministic seed for decorative placement (never Math.random()). */
  seed: number;
}
