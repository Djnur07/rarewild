/**
 * The start screen: a compact green-trimmed panel with a big PLAY button, shown
 * while the game is READY (on load, and again after RESTART / PLAY AGAIN). Same
 * style as the CAUGHT and LEVEL COMPLETE screens: Phaser text and shapes on the
 * 800x600 design frame, laid out as ONE unit by `layout()`.
 *
 * It sits in the band between the HUD rows and Rara's head, so she stays visible
 * standing at the start. The button fires on release (press = pressed look, hover =
 * slightly faded), works with mouse and touch, and needs no keyboard.
 *
 * On a narrow window the HUD shrinks (`hudScale`); this panel shrinks less, so the
 * PLAY button stays a comfortable touch target.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";
import type { OverlayLayout } from "../hunter/caughtOverlay.ts";

export interface ReadyOverlay {
  layout(view: OverlayLayout): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
}

/** Design-frame centre of the panel (the frame's centre is 400,300) and its width. */
const PANEL = { x: 400, y: 262, width: 340, height: 120 };
/** On a narrow window the panel is sized to about this share of the window width (see layout()). */
const NARROW_WINDOW_SHARE = 0.7;

export function createReadyOverlay(scene: Phaser.Scene, depth: number, onPlay: () => void): ReadyOverlay {
  const panel = scene.add
    .rectangle(PANEL.x, PANEL.y, PANEL.width, PANEL.height, 0x081510, 0.88)
    .setStrokeStyle(3, 0x9ee493)
    .setScrollFactor(0)
    .setDepth(depth);
  const hint = scene.add
    .text(PANEL.x, 228, "Collect all. Reach the exit.", { fontSize: "15px", color: "#cfe8d5" })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1);
  const button = scene.add
    .text(PANEL.x, 280, "PLAY", {
      fontSize: "40px",
      fontStyle: "bold",
      color: "#0a1f14",
      backgroundColor: "#9ee493",
      padding: { left: 48, right: 48, top: 10, bottom: 10 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1)
    .setInteractive({ useHandCursor: true });

  // Pressed on pointerdown, activated on pointerup over the button: dragging off before releasing cancels.
  let hovering = false;
  const restyle = (pressed: boolean) => button.setAlpha(pressed ? 0.7 : hovering ? 0.88 : 1);
  button.on("pointerover", () => {
    hovering = true;
    restyle(false);
  });
  button.on("pointerout", () => {
    hovering = false;
    restyle(false);
  });
  button.on("pointerdown", () => restyle(true));
  button.on("pointerup", () => {
    restyle(false);
    onPlay();
  });

  const objects = [panel, hint, button];
  const design = objects.map((object) => ({ object, x: object.x, y: object.y }));
  let visible = false;
  const set = (value: boolean) => {
    visible = value;
    for (const object of objects) object.setVisible(value);
    if (value) button.setInteractive({ useHandCursor: true });
    else button.disableInteractive();
    hovering = false;
    button.setAlpha(1);
  };
  set(false);

  return {
    layout({ width, height, hudScale, zoom }) {
      // On-screen size is design size * zoom * scale, so ask for a panel about 70% of the window wide, but never smaller than the HUD or larger than the design size.
      const scale = Math.max(hudScale, Math.min(1, (NARROW_WINDOW_SHARE * width) / (zoom * PANEL.width)));
      for (const { object, x, y } of design) {
        object.setPosition(width / 2 + (x - 400) * scale, height / 2 + (y - 300) * scale).setScale(scale);
        if ("setResolution" in object) object.setResolution(Math.min(4, Math.max(1, zoom * scale)));
      }
    },
    show() {
      if (visible) return;
      set(true);
      scene.tweens.add({ targets: objects, alpha: { from: 0, to: 1 }, duration: 260 });
    },
    hide: () => set(false),
    get visible() {
      return visible;
    },
  };
}
