/**
 * Pixel recolor used to build a skin's sprite sheets from the default ones.
 * Pure (typed array in, typed array out) so it can be tested without a
 * browser or Phaser.
 */

import type { BodyColorRecolor } from "../rareWild/bodyColor.ts";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function hueToChannel(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

/** Recolor RGBA pixels in place. Alpha is never changed; fully transparent pixels are skipped. */
export function recolorRgba(data: Uint8ClampedArray, recolor: BodyColorRecolor): void {
  const hueShift = recolor.hueShift / 360;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let l = (max + min) / 2;
    let s = 0;
    let h = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }

    h = (((h + hueShift) % 1) + 1) % 1;
    s = clamp01(s * recolor.saturation);
    l = clamp01(l * recolor.lightness);

    if (s === 0) {
      const gray = Math.round(l * 255);
      data[i] = data[i + 1] = data[i + 2] = gray;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      data[i] = Math.round(hueToChannel(p, q, h + 1 / 3) * 255);
      data[i + 1] = Math.round(hueToChannel(p, q, h) * 255);
      data[i + 2] = Math.round(hueToChannel(p, q, h - 1 / 3) * 255);
    }
  }
}
