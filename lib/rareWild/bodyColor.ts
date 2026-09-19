/**
 * Body Color -> recolor of Rara's animation sheets.
 *
 * Each entry is an HSL transform applied to every pixel of the default
 * (Original Brown) sheets: rotate hue by `hueShift` degrees, multiply
 * saturation and lightness. The numbers were measured from the real
 * RAREWILD artwork (head color of a token per body color vs the Original
 * Brown head), so the animated sprite matches the NFT's body color. Purely
 * cosmetic — nothing here touches movement or gameplay.
 */

import type { RareWildBodyColor } from "./traits.ts";

export type BodyColorRecolor = {
  hueShift: number;
  saturation: number;
  lightness: number;
};

export const BODY_COLOR_RECOLOR: Record<RareWildBodyColor, BodyColorRecolor> = {
  "Original Brown": { hueShift: 0, saturation: 1, lightness: 1 },
  "Charcoal Grey": { hueShift: 39.4, saturation: 0.041, lightness: 0.699 },
  "Golden Tan": { hueShift: 34.3, saturation: 0.837, lightness: 1.195 },
  "Rusty Orange": { hueShift: -20.6, saturation: 1.211, lightness: 0.991 },
  "Cocoa Red": { hueShift: 8.7, saturation: 1.431, lightness: 0.858 },
  "Mossy Green": { hueShift: 102, saturation: 0.635, lightness: 1.035 },
  "Slate Blue": { hueShift: -161.6, saturation: 0.504, lightness: 1.133 },
  "Royal Purple": { hueShift: -107.2, saturation: 0.72, lightness: 1.071 },
  "Midnight Black": { hueShift: -20.6, saturation: 0.154, lightness: 0.372 },
  "Albino White": { hueShift: -0.6, saturation: 0.042, lightness: 2.062 },
};

/** True when the sheets need no recoloring (the default sheets already are Original Brown). */
export function isIdentityRecolor(recolor: BodyColorRecolor): boolean {
  return recolor.hueShift === 0 && recolor.saturation === 1 && recolor.lightness === 1;
}
