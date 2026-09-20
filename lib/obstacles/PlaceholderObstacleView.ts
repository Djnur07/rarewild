/**
 * Temporary obstacle art drawn with Phaser shapes in the mangrove palette: no image assets. The
 * existing root art is a thin decorative arc, too slight to read as a solid box, so it is not used
 * here. Every shape fills its piece's collision box exactly.
 *
 * Each type has its own look so it can be read at a glance, before the player gets close:
 *
 *   LOW       the original mossy rock, tree stump or log pile (grey-green / brown)
 *   HIGH      taller and darker: a slate standing stone, or a broken dead snag
 *   PLATFORM  wide, warm, with a bright mossy rim along the top: a surface to stand on
 *             (a stone ledge, or a deck of logs)
 *   STACKED   a stepped pile of stones that gets lighter toward the top (each tier a step)
 *   NARROW    two dark trunk pillars with a vine drooping across the passage between them
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ObstacleView } from "./ObstacleView.ts";
import type { ObstacleKind, ObstacleSpec } from "./types.ts";

const OUTLINE = 0x1c1a14;

type Graphics = Phaser.GameObjects.Graphics;

/** A piece's box as centre-bottom origin + size, so the art can be described relative to the ground. */
interface Box {
  cx: number;
  bottom: number;
  w: number;
  h: number;
}
const boxOf = (r: Rect): Box => ({ cx: (r.left + r.right) / 2, bottom: r.bottom, w: r.right - r.left, h: r.bottom - r.top });

/** The original look: a mossy boulder. */
function rock(g: Graphics, { cx, bottom, w, h }: Box, body = 0x5b675c, shade = 0x46514a, shine = 0x7d8a80) {
  const radii = { tl: h * 0.42, tr: h * 0.34, bl: 5, br: 5 };
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(body).fillRoundedRect(cx - w / 2, bottom - h, w, h, radii);
  g.fillStyle(shade).fillRoundedRect(cx - w / 2, bottom - h * 0.34, w, h * 0.34, { tl: 0, tr: 0, bl: 5, br: 5 });
  g.fillStyle(shine).fillEllipse(cx - w * 0.16, bottom - h * 0.66, w * 0.3, h * 0.2);
  g.fillStyle(0x3f6f49).fillRoundedRect(cx - w / 2 + 3, bottom - h, w * 0.66, 12, { tl: 16, tr: 10, bl: 0, br: 6 });
  g.strokeRoundedRect(cx - w / 2, bottom - h, w, h, radii);
}

/** The original look: a tree stump with flared roots and a ringed top. */
function stump(g: Graphics, { cx, bottom, w, h }: Box) {
  const trunkW = w - 12;
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x5e412a).fillRect(cx - trunkW / 2, bottom - h + 8, trunkW, h - 8);
  g.fillStyle(0x4a3220).fillTriangle(cx - w / 2, bottom, cx - trunkW / 2, bottom, cx - trunkW / 2, bottom - h * 0.4);
  g.fillStyle(0x4a3220).fillTriangle(cx + w / 2, bottom, cx + trunkW / 2, bottom, cx + trunkW / 2, bottom - h * 0.4);
  g.fillStyle(0x3b2818).fillRect(cx - trunkW / 2 + 4, bottom - h * 0.5, 4, h * 0.5);
  g.fillStyle(0x9a7650).fillEllipse(cx, bottom - h + 8, w, 16);
  g.fillStyle(0x86653f).fillEllipse(cx, bottom - h + 8, w * 0.62, 9);
  g.strokeEllipse(cx, bottom - h + 8, w, 16);
  g.strokeRect(cx - trunkW / 2, bottom - h + 8, trunkW, h - 8);
  g.fillStyle(0x3f6f49).fillEllipse(cx - w * 0.18, bottom - h + 14, w * 0.34, 7);
}

/** The original look: two stacked logs with end rings. */
function logPile(g: Graphics, { cx, bottom, w, h }: Box) {
  const half = h / 2;
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x64452b).fillRoundedRect(cx - w / 2, bottom - half, w, half, 8);
  g.fillStyle(0x714f30).fillRoundedRect(cx - w / 2 + 6, bottom - h, w - 12, half, 8);
  g.fillStyle(0x9a7a54).fillEllipse(cx - w / 2 + 6, bottom - half * 1.5, 12, half - 4);
  g.fillStyle(0x86653f).fillEllipse(cx - w / 2 + 6, bottom - half * 1.5, 6, half - 12);
  g.fillStyle(0x9a7a54).fillEllipse(cx + w / 2 - 4, bottom - half * 0.5, 12, half - 4);
  g.fillStyle(0x3f6f49).fillRoundedRect(cx - w * 0.18, bottom - h, w * 0.4, 7, 4);
  g.strokeRoundedRect(cx - w / 2, bottom - half, w, half, 8);
  g.strokeRoundedRect(cx - w / 2 + 6, bottom - h, w - 12, half, 8);
}

/** HIGH (stone): a tall slate standing stone with cracks and a mossy cap. */
function standingStone(g: Graphics, { cx, bottom, w, h }: Box) {
  const radii = { tl: w * 0.5, tr: w * 0.42, bl: 4, br: 4 };
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x4d5c63).fillRoundedRect(cx - w / 2, bottom - h, w, h, radii);
  g.fillStyle(0x38454b).fillRect(cx + w * 0.12, bottom - h * 0.85, w * 0.38, h * 0.85); // shaded side
  g.fillStyle(0x6f8088).fillRoundedRect(cx - w / 2 + 4, bottom - h + 6, 7, h * 0.5, 3); // lit edge
  g.lineStyle(2, 0x2c363b, 0.9);
  g.lineBetween(cx - 4, bottom - h * 0.7, cx + 3, bottom - h * 0.45);
  g.lineBetween(cx + 3, bottom - h * 0.45, cx - 2, bottom - h * 0.2);
  g.fillStyle(0x3f6f49).fillRoundedRect(cx - w / 2 + 2, bottom - h, w - 4, 11, { tl: w * 0.5, tr: w * 0.42, bl: 0, br: 4 });
  g.lineStyle(2, OUTLINE, 0.9).strokeRoundedRect(cx - w / 2, bottom - h, w, h, radii);
}

/** HIGH (stump): a broken dead snag: jagged top, dark bark, exposed roots. */
function snag(g: Graphics, { cx, bottom, w, h }: Box) {
  const trunkW = w - 8;
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x4a3527).fillRect(cx - trunkW / 2, bottom - h + 10, trunkW, h - 10);
  g.fillStyle(0x352519).fillTriangle(cx - w / 2 - 4, bottom, cx - trunkW / 2, bottom, cx - trunkW / 2, bottom - h * 0.32);
  g.fillStyle(0x352519).fillTriangle(cx + w / 2 + 4, bottom, cx + trunkW / 2, bottom, cx + trunkW / 2, bottom - h * 0.32);
  // jagged broken top
  g.fillStyle(0x6a5039).fillTriangle(cx - trunkW / 2, bottom - h + 10, cx - trunkW / 4, bottom - h - 2, cx, bottom - h + 10);
  g.fillStyle(0x7d6146).fillTriangle(cx - 2, bottom - h + 10, cx + trunkW / 4, bottom - h + 3, cx + trunkW / 2, bottom - h + 10);
  g.fillStyle(0x2a1d13).fillRect(cx - trunkW / 2 + 5, bottom - h * 0.6, 4, h * 0.6);
  g.fillStyle(0x2a1d13).fillRect(cx + trunkW / 2 - 10, bottom - h * 0.8, 3, h * 0.5);
  g.strokeRect(cx - trunkW / 2, bottom - h + 10, trunkW, h - 10);
  g.fillStyle(0x3f6f49).fillEllipse(cx + w * 0.1, bottom - h * 0.35, w * 0.4, 6);
}

/** PLATFORM (stone): a wide warm ledge with strata and a bright mossy rim to show it can be stood on. */
function ledge(g: Graphics, { cx, bottom, w, h }: Box) {
  const radii = { tl: 10, tr: 10, bl: 4, br: 4 };
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x6b5a46).fillRoundedRect(cx - w / 2, bottom - h, w, h, radii);
  g.fillStyle(0x54463a).fillRect(cx - w / 2 + 2, bottom - h * 0.42, w - 4, h * 0.42);
  g.lineStyle(2, 0x3d3229, 0.7);
  g.lineBetween(cx - w / 2 + 6, bottom - h * 0.62, cx + w / 2 - 6, bottom - h * 0.62);
  g.fillStyle(0x7d6a54).fillEllipse(cx - w * 0.28, bottom - h * 0.3, 18, 9);
  g.fillStyle(0x7d6a54).fillEllipse(cx + w * 0.22, bottom - h * 0.22, 14, 8);
  g.fillStyle(0x4b7a4f).fillRoundedRect(cx - w / 2, bottom - h, w, 10, { tl: 10, tr: 10, bl: 0, br: 0 }); // moss rim
  g.fillStyle(0x9ec27a).fillRect(cx - w / 2 + 8, bottom - h + 1, w - 16, 2); // the bright, walkable edge
  g.lineStyle(2, OUTLINE, 0.9).strokeRoundedRect(cx - w / 2, bottom - h, w, h, radii);
}

/** PLATFORM (log): a deck of logs laid side by side with a flat plank top. */
function logDeck(g: Graphics, { cx, bottom, w, h }: Box) {
  const half = h / 2;
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x5f4229).fillRoundedRect(cx - w / 2, bottom - half, w, half, 8);
  g.fillStyle(0x6e4d30).fillRoundedRect(cx - w / 2 + 3, bottom - h, w - 6, half + 2, 8);
  g.lineStyle(2, 0x3f2c1c, 0.7);
  for (let x = cx - w / 2 + 30; x < cx + w / 2 - 20; x += 34) g.lineBetween(x, bottom - half, x, bottom - 2); // log seams
  g.fillStyle(0x98764f).fillEllipse(cx - w / 2 + 6, bottom - half * 0.5, 12, half - 4);
  g.fillStyle(0x98764f).fillEllipse(cx + w / 2 - 4, bottom - half * 0.5, 12, half - 4);
  g.fillStyle(0x8f6c45).fillRoundedRect(cx - w / 2 + 3, bottom - h, w - 6, 8, 4); // flat plank top
  g.fillStyle(0xb4c98a).fillRect(cx - w / 2 + 10, bottom - h + 1, w - 20, 2); // bright, walkable edge
  g.lineStyle(2, OUTLINE, 0.9).strokeRoundedRect(cx - w / 2, bottom - half, w, half, 8);
  g.strokeRoundedRect(cx - w / 2 + 3, bottom - h, w - 6, half + 2, 8);
}

/** STACKED: one tier of a stepped stone pile; lighter and more mossy toward the top. */
function tier(g: Graphics, { cx, bottom, w, h }: Box, index: number, count: number) {
  const shades = [0x56624f, 0x66705f, 0x778573];
  const body = shades[Math.min(index, shades.length - 1)];
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(body).fillRoundedRect(cx - w / 2, bottom - h, w, h, index === count - 1 ? { tl: 12, tr: 12, bl: 3, br: 3 } : 5);
  g.fillStyle(0x000000, 0.14).fillRect(cx - w / 2 + 2, bottom - h * 0.32, w - 4, h * 0.32);
  g.fillStyle(0xffffff, 0.12).fillEllipse(cx - w * 0.2, bottom - h * 0.68, w * 0.28, h * 0.22);
  g.lineStyle(2, 0x2c3327, 0.6).lineBetween(cx - w * 0.1, bottom - h * 0.9, cx - w * 0.16, bottom - h * 0.5);
  if (index === count - 1) g.fillStyle(0x3f7a4f).fillRoundedRect(cx - w / 2 + 3, bottom - h, w - 6, 8, { tl: 10, tr: 10, bl: 0, br: 0 });
  g.lineStyle(2, OUTLINE, 0.9).strokeRoundedRect(cx - w / 2, bottom - h, w, h, index === count - 1 ? { tl: 12, tr: 12, bl: 3, br: 3 } : 5);
}

/** NARROW: one dark trunk pillar. */
function pillar(g: Graphics, { cx, bottom, w, h }: Box) {
  g.lineStyle(2, OUTLINE, 0.9);
  g.fillStyle(0x3f3126).fillRoundedRect(cx - w / 2, bottom - h, w, h, { tl: 10, tr: 10, bl: 3, br: 3 });
  g.fillStyle(0x5a4633).fillRoundedRect(cx - w / 2 + 5, bottom - h + 8, 8, h - 14, 3);
  g.fillStyle(0x2a2018).fillRect(cx + w / 2 - 14, bottom - h + 14, 6, h - 22);
  g.fillStyle(0x3f7a4f).fillRoundedRect(cx - w / 2, bottom - h, w, 9, { tl: 10, tr: 10, bl: 0, br: 0 });
  g.strokeRoundedRect(cx - w / 2, bottom - h, w, h, { tl: 10, tr: 10, bl: 3, br: 3 });
}

/** A vine drooping between two points, drawn as a few line segments. */
function vine(g: Graphics, x1: number, x2: number, y: number, sag: number) {
  g.lineStyle(3, 0x3f7a4f, 0.95);
  const steps = 8;
  let px = x1;
  let py = y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const yy = y + Math.sin(t * Math.PI) * sag;
    g.lineBetween(px, py, x, yy);
    px = x;
    py = yy;
  }
}

export function createPlaceholderObstacleView(scene: Phaser.Scene, spec: ObstacleSpec, rects: Rect[]): ObstacleView {
  const g = scene.add.graphics();
  const boxes = rects.map(boxOf);
  const kind: ObstacleKind = spec.kind;

  switch (spec.type) {
    case "LOW":
      if (kind === "rock") rock(g, boxes[0]);
      else if (kind === "stump") stump(g, boxes[0]);
      else logPile(g, boxes[0]);
      break;
    case "HIGH":
      if (kind === "stump") snag(g, boxes[0]);
      else standingStone(g, boxes[0]);
      break;
    case "PLATFORM":
      if (kind === "log") logDeck(g, boxes[0]);
      else ledge(g, boxes[0]);
      break;
    case "STACKED": {
      // Bottom tier first, so each tier is drawn over the top edge of the one below.
      const ordered = boxes.map((b, i) => ({ b, i })).sort((p, q) => q.b.bottom - p.b.bottom);
      ordered.forEach(({ b, i }) => tier(g, b, i, boxes.length));
      break;
    }
    case "NARROW": {
      const [a, b] = [...boxes].sort((p, q) => p.cx - q.cx);
      const top = Math.min(rects[0].top, rects[1].top);
      g.fillStyle(0x000000, 0.22).fillRect(a.cx + a.w / 2, top + 6, b.cx - b.w / 2 - (a.cx + a.w / 2), a.h - 6); // the shaded passage between the pillars
      pillar(g, a);
      pillar(g, b);
      vine(g, a.cx + a.w / 2 - 2, b.cx - b.w / 2 + 2, top + 5, 16);
      break;
    }
  }

  return { destroy: () => g.destroy() };
}
