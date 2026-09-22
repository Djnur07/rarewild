/**
 * Temporary Hunter art drawn with Phaser shapes: an orange-jacketed figure in
 * a wide-brimmed hat carrying a rifle. Deliberately unlike Rara (a brown
 * monkey) so it reads as the enemy. No image assets are loaded.
 *
 * State feedback, all cheap:
 *   PATROL / IDLE  faint yellow detection area in front (what the Hunter can see)
 *   ALERT          yellow "!" pops up over the head, area turns orange
 *   CHASE          red "!" pulses over the head, area hidden
 *   LOST           blue "?" over the head, area back to faint yellow
 *
 * Replace it by giving Hunter a different HunterViewFactory.
 */

import type Phaser from "phaser";
import type { HunterConfig } from "./config.ts";
import type { HunterView } from "./HunterView.ts";
import type { HunterState } from "./types.ts";
import { worldTextResolution } from "../render/quality.ts";

const INDICATOR_DEPTH = 550; // above the mid rain layer (500), below the foreground rain (600) and the HUD (1000)
const INDICATOR_OFFSET_Y = 26; // px above the top of the Hunter's body

const INDICATORS: Partial<Record<HunterState, { text: string; color: string; size: string; pulse: boolean }>> = {
  ALERT: { text: "!", color: "#ffd23f", size: "34px", pulse: false },
  CHASE: { text: "!", color: "#ff3b1f", size: "40px", pulse: true },
  LOST: { text: "?", color: "#7fd1ff", size: "34px", pulse: false },
};

const AREA_STYLE: Partial<Record<HunterState, { color: number; alpha: number }>> = {
  PATROL: { color: 0xffe08a, alpha: 0.08 },
  IDLE: { color: 0xffe08a, alpha: 0.08 },
  LOST: { color: 0xffe08a, alpha: 0.08 },
  ALERT: { color: 0xff9a2e, alpha: 0.14 },
};

export function createPlaceholderHunterView(scene: Phaser.Scene, config: HunterConfig): HunterView {
  const { height } = config.body;
  const top = -height / 2;

  // The detection area is created first so the figure draws over it.
  const area = scene.add.graphics();
  const figure = scene.add.container(0, 0);
  const art = scene.add.graphics();
  // Boots, trousers, jacket, head, hat and rifle, relative to the body centre, facing right.
  art.fillStyle(0x2b1d14).fillRect(-15, top + 84, 30, 12); // boots
  art.fillStyle(0x6b5a34).fillRect(-13, top + 56, 26, 30); // trousers
  art.fillStyle(0xd9531e).fillRect(-17, top + 26, 34, 34); // jacket
  art.fillStyle(0x8f2f0f).fillRect(-17, top + 26, 34, 5); // collar
  art.fillStyle(0xe0b48a).fillCircle(0, top + 20, 12); // head
  art.fillStyle(0x1b1b1b).fillCircle(6, top + 18, 2); // eye
  art.fillStyle(0x3b2a1a).fillRect(-22, top + 9, 44, 5); // hat brim
  art.fillStyle(0x4a3524).fillRect(-11, top - 2, 22, 12); // hat crown
  art.fillStyle(0x3a3a3a).fillRect(4, top + 40, 34, 5); // rifle barrel
  art.fillStyle(0x5a3a1e).fillRect(-8, top + 40, 14, 6); // rifle stock
  figure.add(art);

  const indicator = scene.add
    .text(0, 0, "!", { fontSize: "34px", fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 5 })
    .setOrigin(0.5)
    .setDepth(INDICATOR_DEPTH)
    .setResolution(worldTextResolution(2, scene.scale.width, scene.scale.height))
    .setVisible(false);

  /** What is currently drawn: the state, or "CAUGHT" (Hunter standing down: no indicator, no detection area). */
  let shownLook: HunterState | "CAUGHT" | null = null;
  let shownFacing: 1 | -1 | null = null;

  const drawArea = (state: HunterState | "CAUGHT", facing: 1 | -1) => {
    area.clear();
    const style = state === "CAUGHT" ? undefined : AREA_STYLE[state];
    if (!config.showDetectionArea || !style) return;
    // The true detection box: detectionRange ahead, +-detectionVerticalRange, down to the ground.
    const rangeX = facing > 0 ? 0 : -config.detectionRange;
    area.fillStyle(style.color, style.alpha);
    area.fillRect(rangeX, -config.detectionVerticalRange, config.detectionRange, config.detectionVerticalRange + height / 2);
  };

  const showIndicator = (state: HunterState | "CAUGHT") => {
    scene.tweens.killTweensOf(indicator);
    const spec = state === "CAUGHT" ? undefined : INDICATORS[state];
    if (!spec) {
      indicator.setVisible(false);
      return;
    }
    indicator.setText(spec.text).setColor(spec.color).setFontSize(spec.size).setVisible(true).setScale(0.4);
    scene.tweens.add({ targets: indicator, scale: 1, duration: 160, ease: "Back.easeOut" });
    if (spec.pulse) {
      scene.tweens.add({ targets: indicator, scale: { from: 1, to: 1.25 }, duration: 240, delay: 160, yoyo: true, repeat: -1 });
    }
  };

  return {
    update(frame) {
      figure.setPosition(frame.x, frame.y).setScale(frame.facing, 1);
      area.setPosition(frame.x, frame.y);
      indicator.setPosition(frame.x, frame.y + top - INDICATOR_OFFSET_Y);

      const look = frame.caught ? "CAUGHT" : frame.state;
      if (look !== shownLook || frame.facing !== shownFacing) {
        if (look !== shownLook) showIndicator(look);
        drawArea(look, frame.facing);
        shownLook = look;
        shownFacing = frame.facing;
      }
    },
    destroy() {
      scene.tweens.killTweensOf(indicator);
      area.destroy();
      figure.destroy();
      indicator.destroy();
    },
  };
}

