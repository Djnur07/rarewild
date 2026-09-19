"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  applyRareWildSkin,
  createRaraCharacterClass,
  ensureSkinPortrait,
  preloadRaraAssets,
  registerRaraAnimations,
} from "@/lib/rara";
import {
  findRareWildSkin,
  getDefaultSkin,
  loadRareWildDataset,
  type RareWildSkin,
} from "@/lib/rareWild";
import { EnvironmentLayer, preloadEnvironmentAssets } from "@/lib/environment";
import { createRainEffect, type RainEffect } from "@/lib/weather/rain";
import SkinSelector from "@/components/SkinSelector";
import WalletPanel from "@/components/WalletPanel";
import OverlayDrawer from "@/components/OverlayDrawer";
import MusicControl from "@/components/MusicControl";

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 600;
const GROUND_Y = 420;
const JUMP_HEIGHT = 140;
const JUMP_DURATION = 260;
const MOVE_STEP = 13; // 2.6x the original value (5) — within the requested 2.5x-3x range
const MOVE_MIN_X = 60;
const MOVE_MAX_X = WORLD_WIDTH - 60;
const CHARACTER_SCALE = 0.5;
const SEED_X = 620;
const HAZARD_X = 140;
const COLLECT_RADIUS = 40;
const HIT_RADIUS = 30;
const HAZARD_COOLDOWN_MS = 1500;
const UI_DEPTH = 1000;
/**
 * The HUD (title, buttons, portrait) is laid out on an 800x600 design frame.
 * The canvas fills the whole window; the camera zooms to the window height and
 * the HUD is re-centered on resize (see MainScene.layout).
 */
const DESIGN_WIDTH = 800;
const DESIGN_HEIGHT = WORLD_HEIGHT;
const PORTRAIT_SIZE = 88;
const PORTRAIT_MARGIN = 16;

/**
 * Fixed level/world seed for decorative environment placement — independent of
 * the selected skin. (Numeric so the mangrove layout stays exactly as it was.)
 */
const ENVIRONMENT_SEED = 1770772245;

/** What the Phaser scene exposes to the React shell for skin changes. */
type SkinApi = {
  applySkin(skin: RareWildSkin): void;
};

export default function Game() {
  const gameRef = useRef<HTMLDivElement>(null);
  const skinApiRef = useRef<SkinApi | null>(null);
  const requestedSkinRef = useRef<RareWildSkin>(getDefaultSkin());
  const selectionCounterRef = useRef(0);
  const [activeSkin, setActiveSkin] = useState<RareWildSkin>(() => getDefaultSkin());
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Local development skin picker: `null` = default Rara, otherwise a token id
   * (number or text). Anything that isn't a valid RAREWILD token falls back to
   * the default skin. No wallet or ownership check — that comes later.
   */
  const selectSkin = useCallback(async (input: string | number | null) => {
    const selection = ++selectionCounterRef.current;
    let skin = getDefaultSkin();
    let message: string | null = null;

    if (input !== null && String(input).trim() !== "") {
      try {
        await loadRareWildDataset();
        const found = findRareWildSkin(input);
        if (found) skin = found;
        else message = `"${String(input).trim()}" is not a valid RAREWILD token (1-4444) - using default Rara.`;
      } catch {
        message = "Could not load RAREWILD data - using default Rara.";
      }
    }

    if (selection !== selectionCounterRef.current) return; // a newer selection superseded this one
    requestedSkinRef.current = skin;
    setActiveSkin(skin);
    setNotice(message);
    skinApiRef.current?.applySkin(skin);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("skin");
    if (requested !== null) void selectSkin(requested);
  }, [selectSkin]);

  useEffect(() => {
    let game: Phaser.Game | undefined;
    // Phaser loads asynchronously, so the effect can be cleaned up (React dev
    // double-mount, fast navigation) before it finishes. Without this guard
    // that first, abandoned instance would still start and keep running.
    let cancelled = false;

    const startGame = async () => {
      if (!gameRef.current) return;

      const Phaser = (await import("phaser")).default;
      if (cancelled) return;
      const RaraCharacter = createRaraCharacterClass(Phaser);

      class MainScene extends Phaser.Scene {
        private character!: InstanceType<typeof RaraCharacter>;
        private environment!: EnvironmentLayer;
        private rain?: RainEffect;
        /** Screen-space HUD objects with the position each has on the 800x600 design frame. */
        private hud: {
          object: Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
          x: number;
          y: number;
        }[] = [];
        private hudScale = 1;
        private portraitFrame!: Phaser.GameObjects.Rectangle;
        private portrait!: Phaser.GameObjects.Image;
        private skinRequest = 0;
        private alive = true;
        private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
        private seed!: Phaser.GameObjects.Arc;
        private hazard!: Phaser.GameObjects.Rectangle;
        private facing: 1 | -1 = 1;
        private leftPressed = false;
        private rightPressed = false;
        private movedThisFrame = false;
        private oneShotActive = false;
        private hazardCooldownUntil = 0;

        constructor() {
          super("MainScene");
        }

        preload() {
          preloadEnvironmentAssets(this);
          preloadRaraAssets(this);
        }

        create() {
          this.cameras.main.setBackgroundColor("#10251d");

          this.environment = new EnvironmentLayer(this, {
            worldWidth: WORLD_WIDTH,
            worldHeight: WORLD_HEIGHT,
            groundY: GROUND_Y,
            seed: ENVIRONMENT_SEED,
          });

          // Purely visual weather. Created here, before the character, so its
          // background layer is drawn behind the character (see lib/weather/rain.ts).
          this.rain = createRainEffect(Phaser, this);

          this.registerHud(
            this.add
              .text(400, 60, "RAREWILD", {
                fontSize: "42px",
                color: "#ffffff",
                fontStyle: "bold",
              })
              .setOrigin(0.5)
              .setScrollFactor(0)
              .setDepth(UI_DEPTH),
          );

          this.registerHud(
            this.add
              .text(400, 115, "SAVE THE MANGROVE", {
                fontSize: "24px",
                color: "#9ee493",
              })
              .setOrigin(0.5)
              .setScrollFactor(0)
              .setDepth(UI_DEPTH),
          );

          registerRaraAnimations(this);

          this.character = new RaraCharacter(this, 400, GROUND_Y);
          this.character.setScale(CHARACTER_SCALE);
          this.character.on("animationcomplete", () => {
            this.onAnimationComplete();
          });

          // Foreground mist is the nearest depth layer, so it's added last —
          // after the character it should render in front of.
          this.environment.addForegroundMist();

          this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
          // lerpY 0 disables vertical tracking: horizontal-follow only, so jumping doesn't bob the camera.
          this.cameras.main.startFollow(this.character, false, 1, 0);

          this.seed = this.add.circle(SEED_X, GROUND_Y, 10, 0x9ee493);
          this.hazard = this.add.rectangle(HAZARD_X, GROUND_Y, 20, 20, 0xff4444);

          this.cursors = this.input.keyboard!.createCursorKeys();
          this.input.keyboard!.on("keydown-X", () => this.swing());

          // Safety net for press-and-hold on-screen buttons: a pointer released
          // anywhere (including outside the button it was pressed on, e.g. a
          // drag-off) always clears both flags, so movement can never get stuck on.
          this.input.on("pointerup", () => {
            this.leftPressed = false;
            this.rightPressed = false;
          });

          this.createControls();
          this.createSkinPortrait();

          // The canvas tracks the window size; re-fit the camera and HUD whenever it changes.
          this.layout();
          this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

          // Hand the React shell a way to change skins, then apply whichever skin
          // was requested before the scene finished starting (default if none).
          skinApiRef.current = { applySkin: (skin) => this.applySkin(skin) };
          this.events.once("shutdown", () => {
            this.alive = false;
            this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
            this.rain?.destroy();
            this.rain = undefined;
            skinApiRef.current = null;
          });
          this.applySkin(requestedSkinRef.current);
        }

        private registerHud(object: (typeof this.hud)[number]["object"]) {
          this.hud.push({ object, x: object.x, y: object.y });
        }

        /**
         * Fit the game to the current canvas size. The camera zooms so the whole
         * 600px-tall world always fills the window height; a wider window just
         * shows more of the world. Screen-space HUD objects are scaled by that same
         * zoom, so each keeps its place on the 800x600 design frame once re-centered
         * on the window. In a window too narrow for the 800px-wide frame, the HUD
         * alone shrinks horizontally (`hudScale`) so the controls stay on screen.
         * Purely presentational — no gameplay values are touched.
         */
        private layout() {
          const width = this.scale.width;
          const height = this.scale.height;
          const zoom = height / DESIGN_HEIGHT;
          this.cameras.main.setZoom(zoom);
          // The area a scroll-factor-0 object can see, in camera-local coordinates: the rain fills exactly this.
          this.rain?.resize({
            left: width / 2 - width / (2 * zoom),
            top: height / 2 - height / (2 * zoom),
            width: width / zoom,
            height: height / zoom,
          });

          const hudScale = Math.min(1, width / zoom / DESIGN_WIDTH);
          this.hudScale = hudScale;
          // Render text at the on-screen size so the zoom doesn't blur it.
          const textResolution = Math.min(4, Math.max(1, zoom * hudScale));
          for (const { object, x, y } of this.hud) {
            object.setPosition(
              width / 2 + (x - DESIGN_WIDTH / 2) * hudScale,
              height / 2 + (y - DESIGN_HEIGHT / 2),
            );
            if (object === this.portrait) object.setDisplaySize(PORTRAIT_SIZE * hudScale, PORTRAIT_SIZE * hudScale);
            else object.setScale(hudScale);
            if (object instanceof Phaser.GameObjects.Text) object.setResolution(textResolution);
          }
        }

        /** Skins are purely cosmetic: this never touches movement, animation state, or collisions. */
        private applySkin(skin: RareWildSkin) {
          const request = ++this.skinRequest;
          applyRareWildSkin(this, this.character, skin);
          void this.showPortrait(skin, request);
        }

        private createSkinPortrait() {
          this.portraitFrame = this.add
            .rectangle(
              PORTRAIT_MARGIN - 2,
              PORTRAIT_MARGIN - 2,
              PORTRAIT_SIZE + 4,
              PORTRAIT_SIZE + 4,
              0x000000,
              0.6,
            )
            .setOrigin(0)
            .setStrokeStyle(2, 0x9ee493)
            .setScrollFactor(0)
            .setDepth(UI_DEPTH)
            .setVisible(false);
          this.registerHud(this.portraitFrame);
          this.portrait = this.add
            .image(PORTRAIT_MARGIN, PORTRAIT_MARGIN, "__DEFAULT")
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(UI_DEPTH)
            .setVisible(false);
          this.registerHud(this.portrait);
        }

        /** Show the selected token's artwork (loaded on demand, only for this token); hide it for the default skin. */
        private async showPortrait(skin: RareWildSkin, request: number) {
          const key = await ensureSkinPortrait(this, skin);
          if (!this.alive || request !== this.skinRequest) return; // scene closed or a newer skin was picked
          const visible = key !== null;
          if (key) this.portrait.setTexture(key).setDisplaySize(PORTRAIT_SIZE * this.hudScale, PORTRAIT_SIZE * this.hudScale);
          this.portrait.setVisible(visible);
          this.portraitFrame.setVisible(visible);
        }

        update() {
          this.movedThisFrame = false;

          if (this.cursors.left.isDown || this.leftPressed) {
            this.moveLeft();
          }

          if (this.cursors.right.isDown || this.rightPressed) {
            this.moveRight();
          }

          if (!this.movedThisFrame && !this.oneShotActive) {
            this.setIdleIfNotMoving();
          }

          this.checkSeedCollect();
          this.checkHazard();
        }

        private moveLeft() {
          this.character.x = Math.max(MOVE_MIN_X, this.character.x - MOVE_STEP);
          this.onMoved(-1);
        }

        private moveRight() {
          this.character.x = Math.min(MOVE_MAX_X, this.character.x + MOVE_STEP);
          this.onMoved(1);
        }

        private onMoved(direction: 1 | -1) {
          this.movedThisFrame = true;
          this.facing = direction;
          this.character.setFacing(direction);
          if (!this.oneShotActive) {
            this.character.setAnimationState("run");
          }
        }

        private setIdleIfNotMoving() {
          if (this.character.getAnimationState() === "run") {
            this.character.setAnimationState("idle");
          }
        }

        private jump() {
          if (this.oneShotActive) return;
          this.oneShotActive = true;
          this.character.setAnimationState("jump");

          const hop = this.add
            .text(this.character.x, this.character.y - 90, "JUMP", {
              fontSize: "18px",
              color: "#9ee493",
            })
            .setOrigin(0.5);

          this.tweens.add({
            targets: hop,
            alpha: 0,
            y: hop.y - 40,
            duration: 700,
            onComplete: () => hop.destroy(),
          });

          this.tweens.add({
            targets: this.character,
            y: GROUND_Y - JUMP_HEIGHT,
            duration: JUMP_DURATION,
            yoyo: true,
            ease: "Quad.easeOut",
            onComplete: () => {
              this.character.setAnimationState("land");
            },
          });
        }

        private swing() {
          if (this.oneShotActive) return;
          this.oneShotActive = true;
          this.character.setAnimationState("swing");
        }

        /**
         * Unlock movement-driven state once a one-shot animation (land/collect/hit/swing)
         * finishes. Reads the sprite's own tracked state rather than parsing the Phaser
         * animation key, since that key's format differs between the default
         * ("rara-<state>") and a skin ("rara-skin-<skinKey>-<state>").
         */
        private onAnimationComplete() {
          const state = this.character.getAnimationState();
          if (state === "land" || state === "collect" || state === "hit" || state === "swing") {
            this.oneShotActive = false;
            this.setIdleIfNotMoving();
          }
        }

        private checkSeedCollect() {
          if (this.oneShotActive || !this.seed.visible) return;
          const dist = Phaser.Math.Distance.Between(
            this.character.x,
            this.character.y,
            this.seed.x,
            this.seed.y,
          );
          if (dist < COLLECT_RADIUS) {
            this.oneShotActive = true;
            this.character.setAnimationState("collect");
            this.seed.setVisible(false);
            this.time.delayedCall(2000, () => {
              this.seed.setPosition(Phaser.Math.Between(MOVE_MIN_X, MOVE_MAX_X), GROUND_Y);
              this.seed.setVisible(true);
            });
          }
        }

        private checkHazard() {
          if (this.oneShotActive || this.time.now < this.hazardCooldownUntil) return;
          const dist = Phaser.Math.Distance.Between(
            this.character.x,
            this.character.y,
            this.hazard.x,
            this.hazard.y,
          );
          if (dist < HIT_RADIUS) {
            this.oneShotActive = true;
            this.hazardCooldownUntil = this.time.now + HAZARD_COOLDOWN_MS;
            this.character.setAnimationState("hit");
          }
        }

        private createControls() {
          const leftButton = this.add
            .text(250, 510, "←", {
              fontSize: "42px",
              color: "#ffffff",
              backgroundColor: "#214c3b",
              padding: {
                left: 25,
                right: 25,
                top: 10,
                bottom: 10,
              },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);

          const rightButton = this.add
            .text(360, 510, "→", {
              fontSize: "42px",
              color: "#ffffff",
              backgroundColor: "#214c3b",
              padding: {
                left: 25,
                right: 25,
                top: 10,
                bottom: 10,
              },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);

          const jumpButton = this.add
            .text(650, 510, "JUMP", {
              fontSize: "24px",
              color: "#ffffff",
              backgroundColor: "#6b8f71",
              padding: {
                left: 25,
                right: 25,
                top: 18,
                bottom: 18,
              },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);

          const swingButton = this.add
            .text(500, 510, "SWING", {
              fontSize: "20px",
              color: "#ffffff",
              backgroundColor: "#4c6b8f",
              padding: {
                left: 20,
                right: 20,
                top: 20,
                bottom: 20,
              },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);

          // Press-and-hold: pointerdown sets the flag, update() polls it every
          // frame (same mechanism as the keyboard), pointerup/pointerout clear
          // it. Not "click" — a single tap without holding produces no movement
          // beyond whatever polls happen while the pointer is actually down.
          leftButton.on("pointerdown", () => {
            this.leftPressed = true;
          });
          leftButton.on("pointerup", () => {
            this.leftPressed = false;
          });
          leftButton.on("pointerout", () => {
            this.leftPressed = false;
          });

          rightButton.on("pointerdown", () => {
            this.rightPressed = true;
          });
          rightButton.on("pointerup", () => {
            this.rightPressed = false;
          });
          rightButton.on("pointerout", () => {
            this.rightPressed = false;
          });

          jumpButton.on("pointerdown", () => {
            this.jump();
          });

          swingButton.on("pointerdown", () => {
            this.swing();
          });

          for (const button of [leftButton, rightButton, jumpButton, swingButton]) {
            this.registerHud(button);
            button.on("pointerover", () => {
              button.setAlpha(0.7);
            });

            button.on("pointerout", () => {
              button.setAlpha(1);
            });
          }
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        // The canvas always matches its container (which fills the window).
        scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
        parent: gameRef.current,
        scene: MainScene,
      });
    };

    startGame();

    return () => {
      cancelled = true;
      if (game) {
        game.destroy(true);
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={gameRef} className="absolute inset-0 overflow-hidden [&>canvas]:block" />
      <OverlayDrawer label="Wallet & Skins">
        <SkinSelector activeSkin={activeSkin} notice={notice} onSelect={selectSkin} />
        <WalletPanel activeSkin={activeSkin} onSelectToken={(tokenId) => void selectSkin(tokenId)} />
      </OverlayDrawer>
      <MusicControl />
    </div>
  );
}
