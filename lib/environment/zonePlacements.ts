/**
 * Zone-aware decoration for worlds of any width. Pure and deterministic (no
 * Phaser, no Math.random): same seed + same zones in -> same forest out.
 *
 * Every zone scatters the same asset families (trees, roots, foliage, hanging
 * vines, distant silhouettes) with its own spacing and small/medium/large mix,
 * so the world thickens into the deep forest and thins toward the final
 * approach without ever changing style. Placement is jittered (spacing x 0.7-1.3)
 * and a family never repeats the same variant twice in a row, so there is no
 * obvious pattern. Decoration is never solid: it is drawn behind everything the
 * player interacts with.
 *
 * Distant silhouettes sit on a slower parallax layer, so they are placed in that
 * layer's own space (see `parallaxX`) - otherwise the ones at large x would never
 * scroll into view.
 */

import { createPrng, prngRange, type Prng } from "../random/seed.ts";
import type { PlacedDecor } from "./computePlacements.ts";
import type { EnvironmentAssetKey, EnvironmentZone, SizeMix } from "./types.ts";

export interface ZonedPlacements {
  silhouettes: PlacedDecor[];
  trees: PlacedDecor[];
  roots: PlacedDecor[];
  foliage: (PlacedDecor & { hanging: boolean })[];
}

export const SILHOUETTE_SCROLL = 0.5; // must match SILHOUETTE_SCROLL_FACTOR in EnvironmentLayer
/** A typical viewport width in world px, used to line the parallax layer up with the gameplay plane. */
export const REFERENCE_VIEW_WIDTH = 1067;

const EDGE_MARGIN = 60;

type Family = "tree" | "root" | "foliage";
const KEYS: Record<Family, Record<keyof SizeMix, EnvironmentAssetKey>> = {
  tree: { small: "tree-small", medium: "tree-medium", large: "tree-large" },
  root: { small: "root-small", medium: "root-medium", large: "root-large" },
  foliage: { small: "foliage-small", medium: "foliage-medium", large: "foliage-large" },
};

function pickVariant(prng: Prng, family: Family, mix: SizeMix, previous: EnvironmentAssetKey | null): EnvironmentAssetKey {
  const entries = (Object.keys(mix) as (keyof SizeMix)[]).filter((size) => mix[size] > 0);
  const total = entries.reduce((sum, size) => sum + mix[size], 0);
  const roll = (): EnvironmentAssetKey => {
    let r = prng() * total;
    for (const size of entries) {
      r -= mix[size];
      if (r < 0) return KEYS[family][size];
    }
    return KEYS[family][entries[entries.length - 1]];
  };
  const first = roll();
  // Never the same variant twice in a row when there is a choice.
  return first === previous && entries.length > 1 ? roll() : first;
}

/** Jittered positions from `start` to `end` with the given average spacing. */
function scatter(prng: Prng, start: number, end: number, spacing: number): number[] {
  const xs: number[] = [];
  let x = start + spacing * prngRange(prng, 0.3, 0.7);
  while (x < end) {
    xs.push(x);
    x += spacing * prngRange(prng, 0.7, 1.3);
  }
  return xs;
}

/** Where a world x shows up in the silhouette layer's own coordinates. */
export function parallaxX(worldX: number, scrollFactor = SILHOUETTE_SCROLL): number {
  return worldX * scrollFactor + (1 - scrollFactor) * (REFERENCE_VIEW_WIDTH / 2);
}

export function computeZonedPlacements(seed: number, zones: readonly EnvironmentZone[]): ZonedPlacements {
  const out: ZonedPlacements = { silhouettes: [], trees: [], roots: [], foliage: [] };

  zones.forEach((zone, index) => {
    const v = zone.visual;
    const lo = zone.start + EDGE_MARGIN * (index === 0 ? 1 : 0);
    const hi = zone.end - (index === zones.length - 1 ? EDGE_MARGIN : 0);
    const salt = 1000 * (index + 1);

    const treePrng = createPrng(seed + salt + 2);
    let prev: EnvironmentAssetKey | null = null;
    for (const x of scatter(treePrng, lo, hi, v.treeSpacing)) {
      prev = pickVariant(treePrng, "tree", v.treeMix, prev);
      out.trees.push({ key: prev, x });
    }

    const rootPrng = createPrng(seed + salt + 3);
    prev = null;
    for (const x of scatter(rootPrng, lo, hi, v.rootSpacing)) {
      prev = pickVariant(rootPrng, "root", v.rootMix, prev);
      out.roots.push({ key: prev, x });
    }

    const foliagePrng = createPrng(seed + salt + 4);
    prev = null;
    for (const x of scatter(foliagePrng, lo, hi, v.foliageSpacing)) {
      if (foliagePrng() < v.hangingChance) {
        out.foliage.push({ key: "foliage-hanging", x, hanging: true });
      } else {
        prev = pickVariant(foliagePrng, "foliage", v.foliageMix, prev);
        out.foliage.push({ key: prev, x, hanging: false });
      }
    }

    const silPrng = createPrng(seed + salt + 1);
    for (const px of scatter(silPrng, parallaxX(lo), parallaxX(hi), v.silhouetteSpacing)) {
      out.silhouettes.push({ key: "tree-silhouette", x: px });
    }
  });

  return out;
}

/** Blend two 0xRRGGBB colours. */
export function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, shift: number) => (c >> shift) & 0xff;
  const mix = (shift: number) => Math.round(ch(a, shift) + (ch(b, shift) - ch(a, shift)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * The colour grade at world x: each zone's wash is centred on the zone and blends
 * smoothly into its neighbours, so there is never a hard visual seam between zones.
 */
export function washAt(zones: readonly EnvironmentZone[], x: number): { color: number; alpha: number } {
  const centers = zones.map((z) => (z.start + z.end) / 2);
  if (x <= centers[0]) return zones[0].visual.wash;
  if (x >= centers[centers.length - 1]) return zones[zones.length - 1].visual.wash;
  let i = 0;
  while (x > centers[i + 1]) i++;
  const t = (x - centers[i]) / (centers[i + 1] - centers[i]);
  const a = zones[i].visual.wash;
  const b = zones[i + 1].visual.wash;
  return { color: lerpColor(a.color, b.color, t), alpha: a.alpha + (b.alpha - a.alpha) * t };
}
