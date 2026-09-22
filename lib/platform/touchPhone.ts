/**
 * Is this a phone or tablet driven by touch? The one condition every mobile-only behavior in the game
 * is gated on (touch controls that hold several buttons at once, the larger controls and HUD text,
 * the volume that works on iOS), so that desktop stays exactly as it was.
 *
 * It asks the browser about the PRIMARY input: `(hover: none) and (pointer: coarse)`. A phone or
 * tablet matches; a desktop or laptop with a mouse or trackpad does not, however small its window
 * is, and a touch-screen laptop still reports its trackpad / mouse as primary. There is no user
 * agent sniffing. The answer cannot change while the page is open, so it is read once.
 *
 * SSR-safe: without `window` / `matchMedia` it is false.
 */

let cached: boolean | null = null;

export function isTouchPhone(): boolean {
  if (cached === null) {
    cached = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }
  return cached;
}
