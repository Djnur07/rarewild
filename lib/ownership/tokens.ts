/**
 * Owned token ids -> RAREWILD skins. Ownership sources return raw ids in
 * whatever numeric form they like; this is the only place they are cleaned
 * up and matched against the local 4,444-record metadata.
 */

import { RAREWILD_SUPPLY } from "../rareWild/traits.ts";
import { findRareWildSkin } from "../rareWild/registry.ts";
import type { RareWildSkin } from "../rareWild/types.ts";

export type NormalizedTokenIds = {
  /** Valid, de-duplicated, ascending. */
  tokenIds: number[];
  /** How many raw values were dropped (out of range, non-integer, or duplicates). */
  ignored: number;
};

export function normalizeTokenIds(raw: readonly (bigint | number | string)[]): NormalizedTokenIds {
  const seen = new Set<number>();
  let ignored = 0;
  for (const value of raw) {
    let id: number;
    try {
      const big = typeof value === "bigint" ? value : typeof value === "string" ? BigInt(value.trim()) : BigInt(value);
      id = big >= 1n && big <= BigInt(RAREWILD_SUPPLY) ? Number(big) : NaN;
    } catch {
      id = NaN;
    }
    if (Number.isNaN(id) || seen.has(id)) ignored++;
    else seen.add(id);
  }
  return { tokenIds: [...seen].sort((a, b) => a - b), ignored };
}

/** Match token ids to the installed metadata (the dataset must already be loaded). Unknown ids are dropped. */
export function resolveOwnedSkins(tokenIds: readonly number[]): { skins: RareWildSkin[]; unmatched: number } {
  const skins: RareWildSkin[] = [];
  for (const tokenId of tokenIds) {
    const skin = findRareWildSkin(tokenId);
    if (skin) skins.push(skin);
  }
  return { skins, unmatched: tokenIds.length - skins.length };
}
