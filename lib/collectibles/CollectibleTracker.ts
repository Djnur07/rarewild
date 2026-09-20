/**
 * The collecting rules, with no Phaser: which items exist, which are
 * collected, and what Rara's body touches. An item is collected once (it
 * cannot be collected again until `reset()`, i.e. a restart).
 */

import { circleIntersectsRect, type Rect } from "../level/geometry.ts";
import { PICKUP_FORGIVENESS } from "./config.ts";

export interface TrackedItem {
  id: string;
  x: number;
  y: number;
}

export class CollectibleTracker {
  private readonly items: readonly TrackedItem[];
  private readonly radius: number;
  private readonly collected = new Set<string>();

  constructor(items: readonly TrackedItem[], radius: number) {
    this.items = items;
    this.radius = radius;
  }

  get count(): number {
    return this.collected.size;
  }
  get total(): number {
    return this.items.length;
  }
  has(id: string): boolean {
    return this.collected.has(id);
  }

  /** Collects every uncollected item touching Rara's body and returns their ids (in layout order). */
  collect(body: Rect): string[] {
    const fresh: string[] = [];
    for (const item of this.items) {
      if (this.collected.has(item.id)) continue;
      if (circleIntersectsRect(item.x, item.y, this.radius + PICKUP_FORGIVENESS, body)) {
        this.collected.add(item.id);
        fresh.push(item.id);
      }
    }
    return fresh;
  }

  /** A restart: everything is collectible again and the count is zero. */
  reset() {
    this.collected.clear();
  }
}
