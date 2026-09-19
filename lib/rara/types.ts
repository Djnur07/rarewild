/**
 * Rara's animation states. One fixed animation set drives every skin — a
 * skin (see lib/rareWild) only changes how Rara looks, never which
 * animations exist or how movement works.
 */
export type CharacterAnimationState =
  | "idle"
  | "run"
  | "jump"
  | "land"
  | "collect"
  | "swing"
  | "hit";
