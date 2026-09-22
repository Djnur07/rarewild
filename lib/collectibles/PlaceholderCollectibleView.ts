/**
 * Temporary collectible art: a glowing golden "mangrove fruit" diamond that
 * bobs gently. Gold, small and glowing, so it cannot be mistaken for the
 * brown/grey solid obstacles, the red hazard or the plain green seed.
 *
 * Pickup feedback (cheap, all tweens on this scene): a bright flash pops at the
 * item, the fruit swells and fades, a gold ring expands and fades, and a "+1"
 * floats up. (The sparkle burst is drawn by the scene's feedback effects.)
 */

import type Phaser from "phaser";
import { BOB_AMPLITUDE, BOB_PERIOD_MS } from "./config.ts";
import type { CollectibleView } from "./CollectibleView.ts";
import { worldTextResolution } from "../render/quality.ts";

const GOLD = 0xffd23f;
const DEPTH_TEXT = 560; // over the mid rain layer (500), under the foreground rain (600) and the HUD (1000)

export function createPlaceholderCollectibleView(scene: Phaser.Scene, x: number, y: number, radius: number): CollectibleView {
  const fruit = scene.add.graphics().setPosition(x, y);
  fruit.fillStyle(GOLD, 0.22).fillCircle(0, 0, radius * 1.55); // glow
  fruit.fillStyle(0xf2a900).fillTriangle(0, -radius, radius * 0.82, 0, 0, radius);
  fruit.fillStyle(0xffe27a).fillTriangle(0, -radius, -radius * 0.82, 0, 0, radius);
  fruit.fillStyle(0xffffff, 0.75).fillTriangle(0, -radius * 0.7, radius * 0.22, -radius * 0.2, -radius * 0.28, -radius * 0.2);
  fruit.lineStyle(2, 0x7a4a00, 0.95);
  fruit.beginPath();
  fruit.moveTo(0, -radius);
  fruit.lineTo(radius * 0.82, 0);
  fruit.lineTo(0, radius);
  fruit.lineTo(-radius * 0.82, 0);
  fruit.closePath();
  fruit.strokePath();

  // A random-looking but deterministic phase so neighbours don't bob in lockstep.
  const phase = (x * 0.013) % (Math.PI * 2);
  let taken = false;

  return {
    update(timeMs) {
      if (taken) return;
      const t = (timeMs / BOB_PERIOD_MS) * Math.PI * 2 + phase;
      fruit.setY(y + Math.sin(t) * BOB_AMPLITUDE);
      fruit.setScale(1 + Math.sin(t * 2) * 0.05);
    },
    collect() {
      taken = true;
      const flash = scene.add.graphics().setPosition(x, y).setDepth(DEPTH_TEXT);
      flash.fillStyle(0xfff3b0, 0.9).fillCircle(0, 0, radius * 0.9);
      scene.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 150, ease: "Quad.easeOut", onComplete: () => flash.destroy() });
      scene.tweens.add({ targets: fruit, scale: 1.8, alpha: 0, duration: 200, ease: "Quad.easeOut", onComplete: () => fruit.setVisible(false) });

      const ring = scene.add.graphics().setPosition(x, y).setDepth(DEPTH_TEXT);
      ring.lineStyle(3, GOLD, 1).strokeCircle(0, 0, radius);
      scene.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 320, ease: "Quad.easeOut", onComplete: () => ring.destroy() });

      const plusOne = scene.add
        .text(x, y - radius, "+1", { fontSize: "22px", fontStyle: "bold", color: "#ffd23f", stroke: "#000000", strokeThickness: 4 })
        .setOrigin(0.5)
        .setResolution(worldTextResolution(2, scene.scale.width, scene.scale.height))
        .setDepth(DEPTH_TEXT);
      scene.tweens.add({ targets: plusOne, y: y - radius - 42, alpha: 0, duration: 650, ease: "Cubic.easeOut", onComplete: () => plusOne.destroy() });
    },
    show() {
      taken = false;
      scene.tweens.killTweensOf(fruit);
      fruit.setVisible(true).setAlpha(1).setScale(1).setY(y);
    },
    destroy() {
      scene.tweens.killTweensOf(fruit);
      fruit.destroy();
    },
  };
}
