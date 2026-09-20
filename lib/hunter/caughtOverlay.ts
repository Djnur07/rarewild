/**
 * The "CAUGHT" screen: a small panel with a message and a RESTART button, built
 * from Phaser text and shapes and designed on the same 800x600 frame as the HUD.
 * The scene calls `layout()` on every resize; the whole panel is scaled as ONE
 * unit (unlike the single-object HUD elements), so its box always matches its
 * contents on narrow and wide windows alike.
 * Hidden until `show()`. Restart can be triggered by the button (mouse or touch)
 * or the R / Enter keys, via `onRestart`.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";

/** What the overlay needs to know about the current window (see Game.layout). */
export interface OverlayLayout {
  width: number;
  height: number;
  /** < 1 when the window is too narrow for the 800px-wide design frame. */
  hudScale: number;
  /** Text render resolution matching the on-screen size. */
  textResolution: number;
  /** The camera zoom (window height / design height): on-screen size = design size * zoom * scale. */
  zoom: number;
}

export interface CaughtOverlay {
  objects: (Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle)[];
  layout(view: OverlayLayout): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
}

export function createCaughtOverlay(scene: Phaser.Scene, depth: number, onRestart: () => void): CaughtOverlay {
  const panel = scene.add
    .rectangle(400, 310, 400, 210, 0x120808, 0.92)
    .setStrokeStyle(3, 0xff4a2a)
    .setScrollFactor(0)
    .setDepth(depth);
  const title = scene.add
    .text(400, 255, "CAUGHT!", { fontSize: "56px", fontStyle: "bold", color: "#ff5a3c", stroke: "#000000", strokeThickness: 6 })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1);
  const subtitle = scene.add
    .text(400, 310, "The Hunter got you.", { fontSize: "22px", color: "#ffd9b0" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1);
  const button = scene.add
    .text(400, 375, "RESTART  (R)", {
      fontSize: "26px",
      color: "#ffffff",
      backgroundColor: "#a3361f",
      padding: { left: 24, right: 24, top: 10, bottom: 10 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1)
    .setInteractive({ useHandCursor: true });
  button.on("pointerdown", onRestart);
  button.on("pointerover", () => button.setAlpha(0.8));
  button.on("pointerout", () => button.setAlpha(1));

  const objects = [panel, title, subtitle, button];
  // Design-frame position of each object (the frame's centre is 400,300).
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
    objects,
    layout({ width, height, hudScale, textResolution }) {
      for (const { object, x, y } of design) {
        object.setPosition(width / 2 + (x - 400) * hudScale, height / 2 + (y - 300) * hudScale).setScale(hudScale);
        if ("setResolution" in object) object.setResolution(textResolution);
      }
    },
    show() {
      if (visible) return;
      set(true);
      scene.tweens.add({ targets: objects, alpha: { from: 0, to: 1 }, duration: 220 });
    },
    hide: () => set(false),
    get visible() {
      return visible;
    },
  };
}
