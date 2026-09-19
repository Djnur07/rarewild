/**
 * Pure decorative-placement math — no Phaser dependency, so it can be
 * unit-tested in plain Node (Phaser itself needs browser globals just to
 * import).
 * `EnvironmentLayer` is a thin adapter: it calls `computeDecorativePlacements`
 * for the (assetKey, x, y, origin) list, then issues the matching
 * `scene.add.image(...)` calls. All the actual seeded-variation logic lives
 * here and is verified by scripts/validate-environment.ts.
 */

import { createPrng, prngRange } from "../random/seed.ts";
import type { EnvironmentAssetKey } from "./types.ts";

export interface DecorSlot {
  baseX: number;
  candidates: EnvironmentAssetKey[];
}

export interface FoliageSlot {
  baseX: number;
  hanging: boolean;
  candidates: EnvironmentAssetKey[];
}

export const JITTER_RANGE = 30;

export const TREE_SLOTS: DecorSlot[] = [
  { baseX: 150, candidates: ["tree-medium", "tree-large"] },
  { baseX: 350, candidates: ["tree-small", "tree-medium"] },
  { baseX: 950, candidates: ["tree-small", "tree-medium"] },
  { baseX: 1700, candidates: ["tree-medium", "tree-large"] },
  { baseX: 2150, candidates: ["tree-small", "tree-medium"] },
];

export const ROOT_SLOTS: DecorSlot[] = [
  { baseX: 250, candidates: ["root-small", "root-medium"] },
  { baseX: 900, candidates: ["root-medium", "root-large"] },
  { baseX: 1450, candidates: ["root-small", "root-medium"] },
  { baseX: 2000, candidates: ["root-medium", "root-large"] },
];

export const FOLIAGE_SLOTS: FoliageSlot[] = [
  { baseX: 100, hanging: false, candidates: ["foliage-medium", "foliage-large"] },
  { baseX: 420, hanging: false, candidates: ["foliage-small", "foliage-medium"] },
  { baseX: 850, hanging: true, candidates: [] },
  { baseX: 1250, hanging: false, candidates: ["foliage-medium", "foliage-large"] },
  { baseX: 1900, hanging: false, candidates: ["foliage-small", "foliage-medium"] },
  { baseX: 2280, hanging: true, candidates: [] },
];

export const SILHOUETTE_X_FRACTIONS = [0.12, 0.38, 0.7, 0.92];

export interface PlacedDecor {
  key: EnvironmentAssetKey;
  x: number;
}

function pick(prng: () => number, options: EnvironmentAssetKey[]): EnvironmentAssetKey {
  return options[Math.floor(prng() * options.length)];
}

export interface DecorativePlacements {
  silhouettes: PlacedDecor[];
  trees: PlacedDecor[];
  roots: PlacedDecor[];
  foliage: (PlacedDecor & { hanging: boolean })[];
}

/** Same seed in -> same composition out, always. Never Math.random(). */
export function computeDecorativePlacements(seed: number, worldWidth: number): DecorativePlacements {
  const silhouettePrng = createPrng(seed + 1);
  const silhouettes: PlacedDecor[] = SILHOUETTE_X_FRACTIONS.map((fraction) => ({
    key: "tree-silhouette",
    x: fraction * worldWidth + prngRange(silhouettePrng, -JITTER_RANGE, JITTER_RANGE),
  }));

  const treePrng = createPrng(seed + 2);
  const trees: PlacedDecor[] = TREE_SLOTS.map((slot) => ({
    key: pick(treePrng, slot.candidates),
    x: slot.baseX + prngRange(treePrng, -JITTER_RANGE, JITTER_RANGE),
  }));

  const rootPrng = createPrng(seed + 3);
  const roots: PlacedDecor[] = ROOT_SLOTS.map((slot) => ({
    key: pick(rootPrng, slot.candidates),
    x: slot.baseX + prngRange(rootPrng, -JITTER_RANGE, JITTER_RANGE),
  }));

  const foliagePrng = createPrng(seed + 4);
  const foliage = FOLIAGE_SLOTS.map((slot) => {
    const x = slot.baseX + prngRange(foliagePrng, -JITTER_RANGE, JITTER_RANGE);
    if (slot.hanging) {
      return { key: "foliage-hanging" as EnvironmentAssetKey, x, hanging: true };
    }
    return { key: pick(foliagePrng, slot.candidates), x, hanging: false };
  });

  return { silhouettes, trees, roots, foliage };
}
