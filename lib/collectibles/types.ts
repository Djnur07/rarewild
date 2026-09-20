/**
 * One collectible. `x` is the horizontal centre; `lift` is how far above the
 * ground surface its centre floats:
 *   ground   walk into it (lift ~30, inside Rara's body height while standing)
 *   hop      just above an obstacle: any real jump collects it
 *   high     a rewarding item that needs a good jump (about 3/4 of full height)
 */
export type CollectibleTier = "ground" | "hop" | "high";

export interface CollectibleSpec {
  id: string;
  tier: CollectibleTier;
  x: number;
  lift: number;
}
