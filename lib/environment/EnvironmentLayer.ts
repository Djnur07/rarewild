/**
 * Mangrove Environment layer builder.
 *
 * Composes the real environment assets (lib/environment/assetManifest.ts)
 * into the scene's visual depth hierarchy:
 *   far background -> mid background -> distant silhouettes -> mist
 *   background -> gameplay ground/water/water-edge -> decorative
 *   trees/roots/foliage -> [character, built by the caller] ->
 *   foreground mist
 *
 * Parallax is entirely Phaser's own `scrollFactor` + camera-follow — no
 * per-frame code. A GameObject with `scrollFactor < 1` moves less than the
 * camera as it scrolls (reads as "further away"); `1` (the default) moves
 * in lockstep with the camera (the normal gameplay plane); `> 1` moves
 * slightly more (reads as "closer than the gameplay plane"). Every tiled
 * layer is sized to the full world width regardless of its scrollFactor —
 * TileSprite rendering cost doesn't scale with declared size, so this is
 * simpler and just as cheap as computing a tighter per-layer width.
 *
 * Deterministic decorative placement (which size variant + exact x jitter
 * for every tree/root/foliage/silhouette) is pure math in
 * computePlacements.ts — this class is a thin Phaser adapter over it, because
 * Phaser needs browser globals just to import, so the actual placement logic
 * has to live outside this file to be unit-testable (see
 * scripts/validate-environment.ts).
 *
 * This module is intentionally separate from the character and skin
 * systems: nothing here reads NFT-specific state. The seed it takes is a
 * plain number the caller controls — see components/Game.tsx.
 *
 * No factory-of-PhaserNS pattern here (unlike RaraCharacter): this class doesn't itself extend a Phaser base class, it
 * only calls methods (`scene.add.image`, `scene.add.tileSprite`, ...) on an
 * already-constructed Scene instance, so `import type Phaser` (erased at
 * compile time) is enough to stay SSR-safe.
 */

import type Phaser from "phaser";
import { computeDecorativePlacements, type DecorativePlacements } from "./computePlacements.ts";
import { computeZonedPlacements, SILHOUETTE_SCROLL, washAt } from "./zonePlacements.ts";
import {
  ENVIRONMENT_ASSETS,
  GAMEPLAY_SCALE,
  GROUND_MUD_SOURCE_Y,
  WATER_EDGE_SHORE_SOURCE_Y,
} from "./assetManifest.ts";
import type { EnvironmentBuildOptions, WaterSegment } from "./types.ts";

/** The original pool; used when the caller passes no `waterSegments`. */
const DEFAULT_WATER_SEGMENTS: readonly WaterSegment[] = [{ start: 680, end: 920 }];
/** Width of one strip of the zone colour wash, px. Narrow enough that the blend between zones looks smooth. */
const WASH_STRIP_WIDTH = 48;

const MIST_BACKGROUND_TOP_Y = 200;
const MIST_FOREGROUND_OFFSET_ABOVE_GROUND = 60;
const SILHOUETTE_GROUND_OFFSET = 40;
const HANGING_FOLIAGE_TOP_Y = 200;

const TREE_GROUND_SINK = 20;
const ROOT_GROUND_SINK = 30;
const FOLIAGE_GROUND_SINK = 30;

export const SKY_SCROLL_FACTOR = 0.1;
export const MID_BACKGROUND_SCROLL_FACTOR = 0.3;
export const SILHOUETTE_SCROLL_FACTOR = SILHOUETTE_SCROLL;
export const MIST_BACKGROUND_SCROLL_FACTOR = 0.4;
export const GAMEPLAY_SCROLL_FACTOR = 1;
export const MIST_FOREGROUND_SCROLL_FACTOR = 1.1;

export class EnvironmentLayer {
  private readonly scene: Phaser.Scene;
  private readonly options: EnvironmentBuildOptions;
  private readonly placements: DecorativePlacements;

  constructor(scene: Phaser.Scene, options: EnvironmentBuildOptions) {
    this.scene = scene;
    this.options = options;
    // Zoned worlds scatter decoration by zone; without zones the original fixed composition is kept.
    this.placements = options.zones
      ? computeZonedPlacements(options.seed, options.zones)
      : computeDecorativePlacements(options.seed, options.worldWidth);

    this.buildSky();
    this.buildDistantSilhouettes();
    this.buildMistBackground();
    this.buildGameplayGround();
    this.buildDecorative();
    this.buildZoneWash();
  }

  /**
   * Call once, AFTER the character is constructed, so foreground mist
   * renders in front of it — it's the nearest depth layer in the scene, per the intended hierarchy.
   */
  addForegroundMist() {
    const { worldWidth, groundY } = this.options;
    const asset = ENVIRONMENT_ASSETS["mist-foreground"];
    const topY = groundY - MIST_FOREGROUND_OFFSET_ABOVE_GROUND;
    // A layer with scrollFactor > 1 slides left faster than the world scrolls, so a world-wide sprite would
    // end before the screen's right edge near the end of a long world. Widen it by the overshoot (+ a screen).
    const coverWidth = worldWidth * MIST_FOREGROUND_SCROLL_FACTOR + 4096;
    this.scene.add
      .tileSprite(coverWidth / 2, topY + asset.height / 2, coverWidth, asset.height, asset.key)
      .setScrollFactor(MIST_FOREGROUND_SCROLL_FACTOR);
  }

  private buildSky() {
    const { worldWidth, worldHeight } = this.options;

    const far = ENVIRONMENT_ASSETS["background-far"];
    this.scene.add
      .tileSprite(worldWidth / 2, worldHeight / 2, worldWidth, far.height, far.key)
      .setScrollFactor(SKY_SCROLL_FACTOR);

    const mid = ENVIRONMENT_ASSETS["background-mid"];
    this.scene.add
      .tileSprite(worldWidth / 2, worldHeight / 2, worldWidth, mid.height, mid.key)
      .setScrollFactor(MID_BACKGROUND_SCROLL_FACTOR);
  }

  private buildDistantSilhouettes() {
    const { groundY } = this.options;
    const distantGroundY = groundY - SILHOUETTE_GROUND_OFFSET;

    for (const placement of this.placements.silhouettes) {
      this.scene.add
        .image(placement.x, distantGroundY, ENVIRONMENT_ASSETS[placement.key].key)
        .setOrigin(0.5, 1)
        .setScrollFactor(SILHOUETTE_SCROLL_FACTOR);
    }
  }

  private buildMistBackground() {
    const { worldWidth } = this.options;
    const asset = ENVIRONMENT_ASSETS["mist-background"];
    this.scene.add
      .tileSprite(worldWidth / 2, MIST_BACKGROUND_TOP_Y + asset.height / 2, worldWidth, asset.height, asset.key)
      .setScrollFactor(MIST_BACKGROUND_SCROLL_FACTOR);
  }

  /**
   * Ground, water, and the water-edge transition share ONE scale
   * (GAMEPLAY_SCALE) and are each aligned to `groundY` via their own
   * "surface reference" point documented in build_environment.py: ground's
   * mud-line (y=90 of its 460-tall source), water's own top edge (its
   * surface), and water-edge's shore line (y=150 of its 320-tall source).
   * Aligning all three to the SAME world y is what makes them read as one
   * continuous floor instead of three mismatched rectangles — verified
   * against a composited mockup before these numbers were finalized.
   * This whole layer renders at the default scrollFactor (1): it's the
   * normal gameplay plane, so it simply follows the camera 1:1.
   */
  private buildGameplayGround() {
    const { worldWidth, groundY } = this.options;

    const ground = ENVIRONMENT_ASSETS.ground;
    const groundTopY = groundY - GROUND_MUD_SOURCE_Y * GAMEPLAY_SCALE;
    this.scene.add.tileSprite(worldWidth / 2, groundTopY + ground.height / 2, worldWidth, ground.height, ground.key);

    const water = ENVIRONMENT_ASSETS.water;
    const edge = ENVIRONMENT_ASSETS["water-edge"];
    const edgeTopY = groundY - WATER_EDGE_SHORE_SOURCE_Y * GAMEPLAY_SCALE;
    const edgeCenterY = edgeTopY + edge.height / 2;
    for (const pool of this.options.waterSegments ?? DEFAULT_WATER_SEGMENTS) {
      const width = pool.end - pool.start;
      this.scene.add.tileSprite((pool.start + pool.end) / 2, groundY + water.height / 2, width, water.height, water.key);
      this.scene.add.image(pool.start, edgeCenterY, edge.key);
      this.scene.add.image(pool.end, edgeCenterY, edge.key).setFlipX(true);
    }
  }

  private buildDecorative() {
    const { groundY } = this.options;
    const { trees, roots, foliage } = this.placements;

    for (const placement of trees) {
      this.scene.add.image(placement.x, groundY + TREE_GROUND_SINK, ENVIRONMENT_ASSETS[placement.key].key).setOrigin(0.5, 1);
    }

    for (const placement of roots) {
      this.scene.add.image(placement.x, groundY + ROOT_GROUND_SINK, ENVIRONMENT_ASSETS[placement.key].key).setOrigin(0.5, 1);
    }

    for (const placement of foliage) {
      if (placement.hanging) {
        this.scene.add
          .image(placement.x, HANGING_FOLIAGE_TOP_Y, ENVIRONMENT_ASSETS[placement.key].key)
          .setOrigin(0.5, 0);
      } else {
        this.scene.add
          .image(placement.x, groundY + FOLIAGE_GROUND_SINK, ENVIRONMENT_ASSETS[placement.key].key)
          .setOrigin(0.5, 1);
      }
    }
  }

  /**
   * A soft colour grade per zone (slate in the rocky area, dark green in the deep forest, ...), drawn as
   * narrow strips whose colour blends smoothly from one zone's centre to the next. It is created before
   * the character, obstacles and pickups, so it grades the scenery only and never dims anything the
   * player has to read. No-op when the world has no zones.
   */
  private buildZoneWash() {
    const { zones, worldWidth, worldHeight } = this.options;
    if (!zones || zones.length === 0) return;
    const wash = this.scene.add.graphics();
    for (let x = 0; x < worldWidth; x += WASH_STRIP_WIDTH) {
      const { color, alpha } = washAt(zones, x + WASH_STRIP_WIDTH / 2);
      wash.fillStyle(color, alpha).fillRect(x, 0, WASH_STRIP_WIDTH + 1, worldHeight);
    }
  }
}
