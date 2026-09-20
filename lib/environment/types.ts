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
  /**
   * Visual zones covering the world. When given, decoration density/mix and the colour wash follow
   * them; when omitted the original fixed 2400px composition is used.
   */
  zones?: readonly EnvironmentZone[];
  /** Pools of water. Defaults to the single original pool at x 680-920. */
  waterSegments?: readonly WaterSegment[];
}

/**
 * How one stretch of the world looks. Every zone uses the SAME assets and the
 * same layers; only how densely and in what mix they are scattered changes
 * (plus a soft colour wash), so the journey reads as one world going deeper.
 * `*Spacing` is the average distance between items in px (smaller = denser);
 * `*Mix` weights the small/medium/large variants of that asset family.
 */
export interface SizeMix {
  small: number;
  medium: number;
  large: number;
}

export interface ZoneVisual {
  treeSpacing: number;
  treeMix: SizeMix;
  rootSpacing: number;
  rootMix: SizeMix;
  foliageSpacing: number;
  foliageMix: SizeMix;
  /** Chance (0..1) that a foliage slot is hanging vines instead of ground foliage. */
  hangingChance: number;
  /** Average spacing of distant silhouettes, in their own (parallax) space, px. */
  silhouetteSpacing: number;
  /** A soft colour grade over the scenery. Never applied to Rara, obstacles or collectibles. */
  wash: { color: number; alpha: number };
}

export interface EnvironmentZone {
  start: number;
  end: number;
  visual: ZoneVisual;
}

/** A pool of (walkable, purely decorative) water between two world x positions. */
export interface WaterSegment {
  start: number;
  end: number;
}
