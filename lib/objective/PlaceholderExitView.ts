/**
 * Temporary exit art drawn with Phaser shapes in the mangrove palette: a rough
 * wooden gate between two posts. Locked: planks across it, a gold padlock and a
 * red lamp, labelled "EXIT LOCKED". Open: the planks are gone, the doorway
 * glows green and the lamp is green, labelled "EXIT OPEN". Touching the locked
 * gate shakes it and floats "EXIT LOCKED - collect all 12 (n / 12)".
 * Small, and it never covers what the player needs to see.
 */

import type Phaser from "phaser";
import type { Rect } from "../level/geometry.ts";
import type { ExitView } from "./ExitView.ts";
import { worldTextResolution } from "../render/quality.ts";

const LABEL_DEPTH = 550; // above the mid rain layer (500), below the foreground rain (600) and the HUD (1000)
const REJECT_COOLDOWN_MS = 1400;
const OUTLINE = 0x1c1a14;

export function createPlaceholderExitView(scene: Phaser.Scene, box: Rect): ExitView {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const cx = (box.left + box.right) / 2;

  const glow = scene.add.graphics().setPosition(cx, box.bottom); // the open doorway's soft light, behind the posts
  const gate = scene.add.graphics().setPosition(cx, box.bottom);
  const label = scene.add
    .text(cx, box.top - 20, "", { fontSize: "16px", fontStyle: "bold", color: "#ff8a75", stroke: "#000000", strokeThickness: 4 })
    .setOrigin(0.5)
    .setResolution(worldTextResolution(2, scene.scale.width, scene.scale.height))
    .setDepth(LABEL_DEPTH);

  let isOpen = false;
  let lastRejectAt = -Infinity;

  const drawPosts = () => {
    gate.lineStyle(2, OUTLINE, 0.9);
    gate.fillStyle(0x5b4030).fillRect(-w / 2, -h, 12, h).fillRect(w / 2 - 12, -h, 12, h); // posts
    gate.strokeRect(-w / 2, -h, 12, h).strokeRect(w / 2 - 12, -h, 12, h);
    gate.fillStyle(0x3f2c1f).fillRect(-w / 2 - 6, -h, w + 12, 12); // top beam
    gate.strokeRect(-w / 2 - 6, -h, w + 12, 12);
  };

  const drawLocked = () => {
    gate.clear();
    glow.clear();
    drawPosts();
    gate.fillStyle(0x4a3524).fillRect(-w / 2 + 12, -h + 12, w - 24, h - 12); // planks
    gate.lineStyle(2, OUTLINE, 0.7);
    for (let y = -h + 30; y < 0; y += 22) gate.lineBetween(-w / 2 + 12, y, w / 2 - 12, y);
    gate.fillStyle(0xd9a441).fillRoundedRect(-9, -h / 2 - 4, 18, 15, 3); // padlock body
    gate.lineStyle(3, 0xb8862e, 1).strokeCircle(0, -h / 2 - 7, 6); // shackle
    gate.fillStyle(0x1c1a14).fillCircle(0, -h / 2 + 3, 2);
    gate.fillStyle(0xe23b2e).fillCircle(0, -h + 6, 5); // red lamp
    label.setText("EXIT LOCKED").setColor("#ff8a75");
  };

  const drawOpen = () => {
    gate.clear();
    drawPosts();
    gate.fillStyle(0x67e08a).fillCircle(0, -h + 6, 5); // green lamp
    gate.fillStyle(0x4a3524).fillRect(-w / 2 + 12, -h + 12, w - 24, 6); // the lifted door, tucked under the beam
    glow.clear();
    glow.fillStyle(0x9ee493, 0.22).fillRect(-w / 2 + 12, -h + 18, w - 24, h - 18);
    glow.fillStyle(0xd8ffd0, 0.16).fillRect(-w / 2 + 22, -h + 26, w - 44, h - 26);
    label.setText("EXIT OPEN").setColor("#9ee493");
  };

  drawLocked();

  return {
    lock() {
      isOpen = false;
      scene.tweens.killTweensOf(gate);
      gate.setPosition(cx, box.bottom).setScale(1);
      drawLocked();
    },
    open(animate) {
      isOpen = true;
      drawOpen();
      if (!animate) return;
      // A subtle unlock: the gate pops a little and a soft ring spreads from the lamp.
      scene.tweens.add({ targets: gate, scaleY: { from: 1.06, to: 1 }, duration: 260, ease: "Quad.easeOut" });
      const ring = scene.add.graphics().setPosition(cx, box.top + 6).setDepth(LABEL_DEPTH);
      ring.lineStyle(3, 0x9ee493, 0.9).strokeCircle(0, 0, 10);
      scene.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 520, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
    },
    rejectTouch(collected, total, nowMs) {
      if (isOpen || nowMs - lastRejectAt < REJECT_COOLDOWN_MS) return;
      lastRejectAt = nowMs;
      scene.tweens.add({ targets: gate, x: { from: cx - 4, to: cx + 4 }, duration: 55, yoyo: true, repeat: 2, onComplete: () => gate.setX(cx) });
      const note = scene.add
        .text(cx, box.top - 46, `EXIT LOCKED\nCollect all ${total} (${collected} / ${total})`, {
          fontSize: "17px",
          fontStyle: "bold",
          align: "center",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setResolution(worldTextResolution(2, scene.scale.width, scene.scale.height))
        .setDepth(LABEL_DEPTH);
      scene.tweens.add({ targets: note, y: note.y - 18, alpha: { from: 1, to: 0 }, delay: 700, duration: 900, onComplete: () => note.destroy() });
    },
    update(timeMs) {
      if (isOpen) glow.setAlpha(0.75 + 0.25 * Math.sin(timeMs / 380));
    },
    destroy() {
      scene.tweens.killTweensOf(gate);
      glow.destroy();
      gate.destroy();
      label.destroy();
    },
  };
}
