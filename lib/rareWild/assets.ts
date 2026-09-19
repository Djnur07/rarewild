/**
 * Where RAREWILD artwork is served from.
 *
 * Default: `/assets/rareWild/skins/<tokenId>.png` under Next's public/
 * folder (git-ignored; filled locally by scripts/rareWild/sync-artwork.ts).
 * To serve the 157 MB of artwork from a CDN / static host instead, set
 * NEXT_PUBLIC_RAREWILD_ASSET_BASE (e.g. "https://cdn.example.com/rarewild")
 * — nothing else in the skin API changes, since every image URL is built
 * here.
 */

const DEFAULT_SKIN_ASSET_BASE = "/assets/rareWild/skins";

export function getSkinAssetBase(): string {
  const configured = process.env.NEXT_PUBLIC_RAREWILD_ASSET_BASE;
  const base = configured && configured.length > 0 ? configured : DEFAULT_SKIN_ASSET_BASE;
  return base.replace(/\/+$/, "");
}

export function skinImagePath(fileName: string): string {
  return `${getSkinAssetBase()}/${fileName}`;
}

/** Public URL of the compact metadata dataset (see types.ts / RareWildDatasetFile). */
export function getDatasetUrl(): string {
  return process.env.NEXT_PUBLIC_RAREWILD_DATASET_URL || "/data/rarewild-metadata.json";
}
