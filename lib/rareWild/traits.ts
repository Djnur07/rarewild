/**
 * Canonical RAREWILD trait vocabulary. These lists are the single source of
 * truth for what a valid record may contain: the dataset build script, the
 * runtime decoder, and the validation script all check against them.
 *
 * Order matters — the compact JSON dataset stores trait values as indices
 * into these arrays (see metadata.ts).
 */

export const RAREWILD_SUPPLY = 4444;

export const RAREWILD_TIERS = [
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Mythic",
] as const;

export const RAREWILD_ACCESSORIES = [
  "None",
  "Cap",
  "Cool Shades",
  "Bandana",
  "Gold Chain",
  "Round Specs",
  "Red Scarf",
  "Hoop Earring",
  "Top Hat",
  "Monocle",
  "Crown",
] as const;

export const RAREWILD_BACKGROUNDS = [
  "Forest Night",
  "Deep Ocean",
  "Sunset Amber",
  "Plum Dusk",
  "Steel Grey",
  "Blush Pink",
  "Teal Wave",
  "Crimson",
  "Pure Black",
  "Cosmic Purple",
  "Golden Hour",
  "Holographic",
] as const;

export const RAREWILD_BODY_COLORS = [
  "Original Brown",
  "Charcoal Grey",
  "Golden Tan",
  "Rusty Orange",
  "Cocoa Red",
  "Mossy Green",
  "Slate Blue",
  "Royal Purple",
  "Midnight Black",
  "Albino White",
] as const;

export const RAREWILD_EXPRESSIONS = [
  "Normal",
  "Wink",
  "Sparkle Eyes",
  "Angry Brow",
  "Sleepy",
  "Dizzy",
] as const;

export type RareWildTier = (typeof RAREWILD_TIERS)[number];
export type RareWildAccessory = (typeof RAREWILD_ACCESSORIES)[number];
export type RareWildBackground = (typeof RAREWILD_BACKGROUNDS)[number];
export type RareWildBodyColor = (typeof RAREWILD_BODY_COLORS)[number];
export type RareWildExpression = (typeof RAREWILD_EXPRESSIONS)[number];

/** Trait tables in the order the compact dataset indexes them. */
export const RAREWILD_TRAIT_TABLES = {
  tier: RAREWILD_TIERS,
  accessory: RAREWILD_ACCESSORIES,
  background: RAREWILD_BACKGROUNDS,
  bodyColor: RAREWILD_BODY_COLORS,
  expression: RAREWILD_EXPRESSIONS,
} as const;

export type RareWildTraitCategory = keyof typeof RAREWILD_TRAIT_TABLES;
