/**
 * Factories that build obstacle specs from designer-friendly numbers, and the geometry helpers for
 * their pieces. Pure (no Phaser). Layouts are written with these, so the footprint fields
 * (`x`/`width`/`height`) can never disagree with the pieces.
 *
 *   low("rock-1", "rock", 770, 60, 56)            a 60 x 56 block centred at x=770
 *   high("stump-2", "stump", 2050, 52, 92)        a taller one
 *   platform("ledge-1", "rock", 3695, 130, 64)    a wide one
 *   stacked("stack-1", "rock", 5020, [[110, 56], [64, 40]])   tiers bottom to top: [width, height]
 *   narrow("narrow-1", "stump", 6425, 110, 56, 76)            gap between the pillars, pillar width, height
 */

import type { Rect } from "../level/geometry.ts";
import type { ObstacleKind, ObstaclePiece, ObstacleSpec, ObstacleType } from "./types.ts";

function build(id: string, type: ObstacleType, kind: ObstacleKind, x: number, pieces: ObstaclePiece[]): ObstacleSpec {
  const left = Math.min(...pieces.map((p) => p.x - p.width / 2));
  const right = Math.max(...pieces.map((p) => p.x + p.width / 2));
  const height = Math.max(...pieces.map((p) => p.base + p.height));
  return { id, type, kind, x, width: right - left, height, pieces };
}

const single = (id: string, type: ObstacleType, kind: ObstacleKind, x: number, width: number, height: number) =>
  build(id, type, kind, x, [{ x, width, height, base: 0 }]);

export const low = (id: string, kind: ObstacleKind, x: number, width: number, height: number) => single(id, "LOW", kind, x, width, height);
export const high = (id: string, kind: ObstacleKind, x: number, width: number, height: number) => single(id, "HIGH", kind, x, width, height);
export const platform = (id: string, kind: ObstacleKind, x: number, width: number, height: number) => single(id, "PLATFORM", kind, x, width, height);

/** Tiers from the bottom up, each `[width, height]`, all centred on x and resting on the one below. */
export function stacked(id: string, kind: ObstacleKind, x: number, tiers: readonly (readonly [number, number])[]): ObstacleSpec {
  let base = 0;
  const pieces = tiers.map(([width, height]) => {
    const piece = { x, width, height, base };
    base += height;
    return piece;
  });
  return build(id, "STACKED", kind, x, pieces);
}

/** Two equal pillars, `gap` px apart, the whole thing centred on x. */
export function narrow(id: string, kind: ObstacleKind, x: number, gap: number, pillarWidth: number, height: number): ObstacleSpec {
  const offset = gap / 2 + pillarWidth / 2;
  return build(id, "NARROW", kind, x, [
    { x: x - offset, width: pillarWidth, height, base: 0 },
    { x: x + offset, width: pillarWidth, height, base: 0 },
  ]);
}

/** The box a piece occupies, given the ground surface's y. */
export function pieceRect(piece: ObstaclePiece, groundSurfaceY: number): Rect {
  const bottom = groundSurfaceY - piece.base;
  return { left: piece.x - piece.width / 2, right: piece.x + piece.width / 2, top: bottom - piece.height, bottom };
}

/** Every solid box of an obstacle. */
export function obstacleRects(spec: ObstacleSpec, groundSurfaceY: number): Rect[] {
  return spec.pieces.map((piece) => pieceRect(piece, groundSurfaceY));
}

/** The gap between the pillars of a NARROW obstacle (its two pieces' inner edges). */
export function narrowGap(spec: ObstacleSpec): number {
  const [a, b] = [...spec.pieces].sort((p, q) => p.x - q.x);
  return b.x - b.width / 2 - (a.x + a.width / 2);
}
