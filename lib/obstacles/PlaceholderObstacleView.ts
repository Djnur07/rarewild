/**
 * Temporary obstacle art drawn with Phaser shapes in the mangrove palette
 * (mossy grey-green rocks, brown wood): no image assets. The existing root
 * art is a thin decorative arc, too slight to read as a solid box, so it is
 * not used here. Every shape fills its collision box exactly.
 *
 *   rock   mossy boulder with a dark base and a highlight
 *   stump  tree stump with flared roots and a ringed top
 *   log    a pile of two stacked logs with end rings
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ObstacleView } from "./ObstacleView.ts";
import type { ObstacleSpec } from "./types.ts";

const OUTLINE = 0x1c1a14;

export function createPlaceholderObstacleView(scene: Phaser.Scene, spec: ObstacleSpec, rect: Rect): ObstacleView {
  const { width: w, height: h } = spec;
  // Local origin: bottom centre of the box, so the art sits exactly on the ground.
  const g = scene.add.graphics().setPosition(spec.x, rect.bottom);
  g.lineStyle(2, OUTLINE, 0.9);

  if (spec.kind === "rock") {
    g.fillStyle(0x5b675c).fillRoundedRect(-w / 2, -h, w, h, { tl: h * 0.42, tr: h * 0.34, bl: 5, br: 5 });
    g.fillStyle(0x46514a).fillRoundedRect(-w / 2, -h * 0.34, w, h * 0.34, { tl: 0, tr: 0, bl: 5, br: 5 });
    g.fillStyle(0x7d8a80).fillEllipse(-w * 0.16, -h * 0.66, w * 0.3, h * 0.2);
    g.fillStyle(0x3f6f49).fillRoundedRect(-w / 2 + 3, -h, w * 0.66, 12, { tl: 16, tr: 10, bl: 0, br: 6 });
    g.strokeRoundedRect(-w / 2, -h, w, h, { tl: h * 0.42, tr: h * 0.34, bl: 5, br: 5 });
  } else if (spec.kind === "stump") {
    const trunkW = w - 12;
    g.fillStyle(0x5e412a).fillRect(-trunkW / 2, -h + 8, trunkW, h - 8);
    g.fillStyle(0x4a3220).fillTriangle(-w / 2, 0, -trunkW / 2, 0, -trunkW / 2, -h * 0.4);
    g.fillStyle(0x4a3220).fillTriangle(w / 2, 0, trunkW / 2, 0, trunkW / 2, -h * 0.4);
    g.fillStyle(0x3b2818).fillRect(-trunkW / 2 + 4, -h * 0.5, 4, h * 0.5);
    g.fillStyle(0x9a7650).fillEllipse(0, -h + 8, w, 16);
    g.fillStyle(0x86653f).fillEllipse(0, -h + 8, w * 0.62, 9);
    g.strokeEllipse(0, -h + 8, w, 16);
    g.strokeRect(-trunkW / 2, -h + 8, trunkW, h - 8);
    g.fillStyle(0x3f6f49).fillEllipse(-w * 0.18, -h + 14, w * 0.34, 7);
  } else {
    const half = h / 2;
    g.fillStyle(0x64452b).fillRoundedRect(-w / 2, -half, w, half, 8);
    g.fillStyle(0x714f30).fillRoundedRect(-w / 2 + 6, -h, w - 12, half, 8);
    g.fillStyle(0x9a7a54).fillEllipse(-w / 2 + 6, -half * 1.5, 12, half - 4);
    g.fillStyle(0x86653f).fillEllipse(-w / 2 + 6, -half * 1.5, 6, half - 12);
    g.fillStyle(0x9a7a54).fillEllipse(w / 2 - 4, -half * 0.5, 12, half - 4);
    g.fillStyle(0x3f6f49).fillRoundedRect(-w * 0.18, -h, w * 0.4, 7, 4);
    g.strokeRoundedRect(-w / 2, -half, w, half, 8);
    g.strokeRoundedRect(-w / 2 + 6, -h, w - 12, half, 8);
  }

  return { destroy: () => g.destroy() };
}
