import type {
  RareWildAccessory,
  RareWildBackground,
  RareWildBodyColor,
  RareWildExpression,
  RareWildTier,
} from "./traits.ts";

/**
 * One RAREWILD NFT viewed as a playable character skin.
 *
 * Identity/collection information only: tier, rank and traits never feed
 * into gameplay (speed, jump height, collision, ...). The built-in default
 * skin uses `tokenId: 0`, `isDefault: true`, tier/background "Default".
 */
export type RareWildSkin = {
  tokenId: number;
  name: string;
  fileName: string;
  /** URL of the 800x800 artwork ("" for the default skin, which has no NFT artwork). */
  imagePath: string;
  rank: number;
  tier: RareWildTier | "Default";
  accessory: RareWildAccessory;
  background: RareWildBackground | "Default";
  bodyColor: RareWildBodyColor;
  expression: RareWildExpression;
  isDefault: boolean;
};

/**
 * Compact on-disk dataset (public/data/rarewild-metadata.json), produced by
 * scripts/rareWild/build-dataset.ts from the collection CSV. Each record is
 * `[tokenId, rank, tier, accessory, background, bodyColor, expression]`,
 * where the last five entries are indexes into `traits[...]` (the canonical
 * lists in traits.ts). `name` ("RAREWILD #<id>") and `fileName`
 * ("<id>.png") are derived from tokenId — the build script refuses to
 * write a dataset in which that isn't true for every row.
 */
export type RareWildDatasetFile = {
  version: 1;
  collection: string;
  supply: number;
  description: string;
  traits: {
    tier: readonly string[];
    accessory: readonly string[];
    background: readonly string[];
    bodyColor: readonly string[];
    expression: readonly string[];
  };
  records: number[][];
};
