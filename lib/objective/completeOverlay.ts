/**
 * The LEVEL COMPLETE screen: a small gold-trimmed panel (below the HUD rows, so the
 * counter and the frozen timer stay visible above it) with the result and a
 * PLAY AGAIN button, in the same style as the CAUGHT screen (Phaser text and
 * shapes on the 800x600 design frame, scaled as ONE unit by `layout()`).
 *
 *   LEVEL COMPLETE
 *   COLLECTED   12 / 12
 *   TIME        01:23
 *   REWARD      Coming Soon      (a placeholder: no rewards exist yet)
 *   [ PLAY AGAIN (R) ]
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { OverlayLayout } from "../hunter/caughtOverlay.ts";

export interface CompleteSummary {
  collected: number;
  total: number;
  timeText: string;
}

export interface CompleteOverlay {
  layout(view: OverlayLayout): void;
  show(summary: CompleteSummary): void;
  hide(): void;
  readonly visible: boolean;
}

const LABEL = { fontSize: "18px", color: "#8fb39a" };
const VALUE = { fontSize: "24px", fontStyle: "bold", color: "#ffffff" };

export function createCompleteOverlay(scene: Phaser.Scene, depth: number, onPlayAgain: () => void): CompleteOverlay {
  const panel = scene.add
    .rectangle(400, 335, 460, 270, 0x081510, 0.94)
    .setStrokeStyle(3, 0xffd23f)
    .setScrollFactor(0)
    .setDepth(depth);
  const title = scene.add
    .text(400, 236, "LEVEL COMPLETE", { fontSize: "44px", fontStyle: "bold", color: "#ffd23f", stroke: "#000000", strokeThickness: 6 })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1);

  const row = (y: number, label: string, valueStyle: Phaser.Types.GameObjects.Text.TextStyle = VALUE) => {
    const l = scene.add.text(250, y, label, LABEL).setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth + 1);
    const v = scene.add.text(550, y, "", valueStyle).setOrigin(1, 0.5).setScrollFactor(0).setDepth(depth + 1);
    return { l, v };
  };
  const collected = row(290, "COLLECTED");
  const time = row(330, "TIME");
  const reward = row(370, "REWARD", { fontSize: "22px", fontStyle: "italic", color: "#ffd23f" });
  reward.v.setText("Coming Soon");

  const button = scene.add
    .text(400, 432, "PLAY AGAIN  (R)", {
      fontSize: "26px",
      color: "#0a1f14",
      backgroundColor: "#ffd23f",
      padding: { left: 24, right: 24, top: 10, bottom: 10 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1)
    .setInteractive({ useHandCursor: true });
  button.on("pointerdown", onPlayAgain);
  button.on("pointerover", () => button.setAlpha(0.85));
  button.on("pointerout", () => button.setAlpha(1));

  const objects = [panel, title, collected.l, collected.v, time.l, time.v, reward.l, reward.v, button];
  const design = objects.map((object) => ({ object, x: object.x, y: object.y }));
  let visible = false;
  const set = (value: boolean) => {
    visible = value;
    for (const object of objects) object.setVisible(value);
    if (value) button.setInteractive({ useHandCursor: true });
    else button.disableInteractive();
    button.setAlpha(1);
  };
  set(false);

  return {
    layout({ width, height, hudScale, textResolution }) {
      for (const { object, x, y } of design) {
        object.setPosition(width / 2 + (x - 400) * hudScale, height / 2 + (y - 300) * hudScale).setScale(hudScale);
        if ("setResolution" in object) object.setResolution(textResolution);
      }
    },
    show(summary) {
      if (visible) return;
      collected.v.setText(`${summary.collected} / ${summary.total}`);
      time.v.setText(summary.timeText);
      set(true);
      scene.tweens.add({ targets: objects, alpha: { from: 0, to: 1 }, duration: 260 });
    },
    hide: () => set(false),
    get visible() {
      return visible;
    },
  };
}
