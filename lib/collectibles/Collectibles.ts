/**
 * The collectibles as a game entity: a `CollectibleTracker` (the rules) plus
 * one view per item. The scene calls `update()` once per frame with Rara's
 * body box and reads `count` / `total` for the HUD. Collecting is pure
 * overlap testing, not physics: items never push or block anything.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import { COLLECTIBLE_RADIUS } from "./config.ts";
import type { CollectibleView, CollectibleViewFactory } from "./CollectibleView.ts";
import { CollectibleTracker } from "./CollectibleTracker.ts";
import { collectibleCenter, FIRST_LEVEL_COLLECTIBLES } from "./placement.ts";
import { createPlaceholderCollectibleView } from "./PlaceholderCollectibleView.ts";
import type { CollectibleSpec } from "./types.ts";

export interface CollectiblesOptions {
  groundSurfaceY: number;
  specs?: readonly CollectibleSpec[];
  createView?: CollectibleViewFactory;
  /** Told where each item was when it was collected, so the scene can add feedback there. It cannot affect collecting. */
  onCollect?: (item: { id: string; x: number; y: number }) => void;
}

export class Collectibles {
  private readonly tracker: CollectibleTracker;
  private readonly views = new Map<string, CollectibleView>();
  private readonly positions = new Map<string, { x: number; y: number }>();
  private readonly onCollect?: CollectiblesOptions["onCollect"];

  constructor(scene: Phaser.Scene, options: CollectiblesOptions) {
    const specs = options.specs ?? FIRST_LEVEL_COLLECTIBLES;
    const createView = options.createView ?? createPlaceholderCollectibleView;
    const items = specs.map((spec) => ({ id: spec.id, ...collectibleCenter(spec, options.groundSurfaceY) }));
    this.tracker = new CollectibleTracker(items, COLLECTIBLE_RADIUS);
    this.onCollect = options.onCollect;
    for (const item of items) {
      this.views.set(item.id, createView(scene, item.x, item.y, COLLECTIBLE_RADIUS));
      this.positions.set(item.id, { x: item.x, y: item.y });
    }
  }

  get count(): number {
    return this.tracker.count;
  }
  get total(): number {
    return this.tracker.total;
  }

  /**
   * Call every frame. `body` is Rara's body box, or null when she cannot collect
   * (e.g. she has been caught). Returns how many items were collected this frame.
   */
  update(timeMs: number, body: Rect | null): number {
    const fresh = body ? this.tracker.collect(body) : [];
    for (const id of fresh) {
      this.views.get(id)?.collect();
      const at = this.positions.get(id);
      if (at) this.onCollect?.({ id, ...at });
    }
    for (const [id, view] of this.views) if (!this.tracker.has(id)) view.update(timeMs);
    return fresh.length;
  }

  /** A restart: every item is back and the count is zero. */
  reset() {
    this.tracker.reset();
    for (const view of this.views.values()) view.show();
  }

  destroy() {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.positions.clear();
  }
}
