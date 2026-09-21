/**
 * One collectible. `x` is the horizontal centre; `lift` is how far above the
 * ground surface its centre floats:
 *   ground   walk into it (lift ~30, inside Rara's body height while standing)
 *   hop      floats above an obstacle (or open ground): clearing / standing on what is under it collects it
 *   high     a rewarding item that needs a good jump (about 3/4 of full height)
 */
export type CollectibleTier = "ground" | "hop" | "high";

/**
 * Why an item is where it is: the small vocabulary the level's collectible layout is written in
 * (see placement.ts for how each zone uses them, and scripts/collectibles for how each is checked).
 *
 *   GUIDE           a ground item on the natural route that points at what comes next
 *   ARC             floats where a jump over a low obstacle peaks: collected by simply jumping
 *   VERTICAL        floats high above a tall obstacle: it asks for real height (climb or leap onto it)
 *   OBSTACLE_ROUTE  sits in or on an obstacle (a platform, a passage): the way to it runs over that obstacle
 *   RISK_REWARD     sits where a Hunter can see you collect it, with cover and an escape route close by
 *
 * A pattern is a label for the layout's intent. It never changes how an item is picked up.
 */
export type CollectiblePattern = "GUIDE" | "ARC" | "VERTICAL" | "OBSTACLE_ROUTE" | "RISK_REWARD";

export interface CollectibleSpec {
  id: string;
  tier: CollectibleTier;
  pattern: CollectiblePattern;
  x: number;
  lift: number;
}
