/**
 * Small deterministic seed + PRNG utilities (FNV-1a string hash and
 * mulberry32). Generic and collection-agnostic: used by the environment
 * placement code so decorative layout is reproducible across reloads and
 * never depends on Math.random().
 */

/** FNV-1a 32-bit hash of a string. Deterministic, no external deps. */
export function seedFromHash(hash: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < hash.length; i++) {
    h ^= hash.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // Force unsigned 32-bit.
  return h >>> 0;
}

/** A deterministic pseudo-random number generator function, seeded once. */
export type Prng = () => number;

/** mulberry32 PRNG. The same seed always produces the same sequence of floats in [0, 1). */
export function createPrng(seed: number): Prng {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministically pick a float in [min, max) from a PRNG call. */
export function prngRange(prng: Prng, min: number, max: number): number {
  return min + prng() * (max - min);
}
