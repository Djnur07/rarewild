/**
 * Skin lookup. The registry is filled once by the loader (browser) or by the
 * validation script (Node) via `installRareWildSkins`; every read is a plain
 * array index, so switching skins never re-parses or re-fetches anything.
 */

import { isValidTokenId } from "./metadata.ts";
import type { RareWildSkin } from "./types.ts";

/** The built-in Rara skin: no NFT, no wallet — the original look. */
const DEFAULT_SKIN: RareWildSkin = Object.freeze({
  tokenId: 0,
  name: "Rara",
  fileName: "",
  imagePath: "",
  rank: 0,
  tier: "Default",
  accessory: "None",
  background: "Default",
  bodyColor: "Original Brown",
  expression: "Normal",
  isDefault: true,
});

let installed: readonly RareWildSkin[] = [];

export function installRareWildSkins(skins: readonly RareWildSkin[]): void {
  installed = skins;
}

export function isRareWildLoaded(): boolean {
  return installed.length > 0;
}

export function getDefaultSkin(): RareWildSkin {
  return DEFAULT_SKIN;
}

export function getRareWildSkins(): readonly RareWildSkin[] {
  return installed;
}

/** Accepts a number or a numeric string (e.g. from a query parameter or input box). */
function normalizeTokenId(tokenId: unknown): number | null {
  const value = typeof tokenId === "string" && /^\d+$/.test(tokenId.trim()) ? Number(tokenId) : tokenId;
  return isValidTokenId(value) ? value : null;
}

/** Strict lookup: null if the id is invalid or the dataset isn't loaded. */
export function findRareWildSkin(tokenId: unknown): RareWildSkin | null {
  const id = normalizeTokenId(tokenId);
  return id === null ? null : (installed[id - 1] ?? null);
}

/** Safe lookup: any invalid id (or an unloaded dataset) yields the default skin. */
export function getRareWildSkin(tokenId: unknown): RareWildSkin {
  return findRareWildSkin(tokenId) ?? DEFAULT_SKIN;
}
