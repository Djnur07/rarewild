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
import {
  attachCharacterBody,
  CharacterMotor,
  createKeyboardMovementInput,
  createSolids,
  DEFAULT_MOVEMENT_CONFIG,
  isTypingInField,
  type KeyboardMovementInput,
  type Locomotion,
} from "@/lib/movement";
import {
  configForPlacement,
  createCaughtOverlay,
  DEFAULT_HUNTER_CONFIG,
  FIRST_LEVEL_HUNTERS,
  Hunter,
  resolveHunterSpawnX,
  type CaughtOverlay,
  type HunterEvent,
  type HunterTarget,
} from "@/lib/hunter";
import {
  CHARACTER_SCALE,
  GROUND_SURFACE_Y,
  GROUND_Y,
  HAZARD_X,
  MOVE_MAX_X,
  MOVE_MIN_X,
  PLAYER_START_X,
  SEED_X,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@/lib/level/constants";
import { ENVIRONMENT_ZONES, WATER_SEGMENTS, ZONE_START } from "@/lib/level/zones";
import { createObstacles, FIRST_LEVEL_OBSTACLES, isClearOfObstacles } from "@/lib/obstacles";
import { Collectibles } from "@/lib/collectibles";
import {
  createCompleteOverlay,
  createReadyOverlay,
  ExitGate,
  formatTime,
  ObjectiveState,
  type CompleteOverlay,
  type ReadyOverlay,
} from "@/lib/objective";
import { createRainEffect, type RainEffect } from "@/lib/weather/rain";
import {
  createFeedbackEffects,
  dangerEdgeAlpha,
  dangerLevel,
  LandingDetector,
  watchReducedMotion,
  type FeedbackEffects,
  type MotionPreference,
} from "@/lib/feedback";
import { getSfxStats, playSfx } from "@/lib/audio/sfx";
import SkinSelector from "@/components/SkinSelector";
import WalletPanel from "@/components/WalletPanel";
import OverlayDrawer from "@/components/OverlayDrawer";
import MusicControl from "@/components/MusicControl";

/** After a catch: how long the world freezes (hit-stop) before the CAUGHT screen appears, ms. */
const CAUGHT_HITSTOP_MS = 180;
/** After reaching the open exit: a short beat before the LEVEL COMPLETE screen, ms. */
const COMPLETE_SCREEN_DELAY_MS = 450;
const COLLECT_RADIUS = 40;
/** A respawning seed keeps this far from the edges of obstacles. */
const SEED_OBSTACLE_MARGIN = 30;
const HIT_RADIUS = 30;
const HAZARD_COOLDOWN_MS = 1500;
const UI_DEPTH = 1000;
/** While the level is complete the Hunters are shown a target that is nowhere near, so they can never touch Rara. */
const NO_TARGET: HunterTarget = { x: -1e6, y: -1e6, rect: { left: -1e6 - 30, top: -1e6 - 50, right: -1e6 + 30, bottom: -1e6 + 50 } };
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

/** Development-only test handle (see MainScene.createTestHook). */
type TestHook = {
  snapshot(): {
    phase: string;
    elapsedMs: number;
    startedAtMs: number | null;
    timerText: string;
    counterText: string;
    exitStatusText: string;
    collected: number;
    total: number;
    exitOpen: boolean;
    rara: { x: number; y: number; vx: number; vy: number; onFloor: boolean };
    hunters: { x: number; y: number; state: string; caught: boolean }[];
    readyVisible: boolean;
    caughtVisible: boolean;
    completeVisible: boolean;
    viewport: { width: number; height: number; zoom: number };
    /** The feedback effects: how much is alive, the screen-edge tints, the motion preference and the sound effects requested so far. */
    feedback: {
      active: number;
      edgeAlpha: number;
      glowAlpha: number;
      reducedMotion: boolean;
      sfx: Record<string, number>;
      /** The camera's shake / flash (the capture moment), and how many objects the scene holds (to spot anything piling up). */
      shaking: boolean;
      flashing: boolean;
      sceneObjects: number;
    };
  };
  buttonRect(label: string): { x: number; y: number; width: number; height: number } | null;
  placeRara(x: number, y: number): void;
};
type TestWindow = Window & { __RAREWILD_TEST__?: TestHook };

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
        /** Pickup / jump / landing / danger / capture / completion feedback (lib/feedback). Draws only; never touches gameplay. */
        private fx!: FeedbackEffects;
        private motion!: MotionPreference;
        private landing = new LandingDetector();
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
        private motor!: CharacterMotor;
        private hunters: Hunter[] = [];
        private caughtOverlay!: CaughtOverlay;
        private completeOverlay!: CompleteOverlay;
        private readyOverlay!: ReadyOverlay;
        /** The one source of truth for READY / PLAYING / CAUGHT / COMPLETE and the run timer. */
        private objective!: ObjectiveState;
        private exit!: ExitGate;
        private timerText!: Phaser.GameObjects.Text;
        private exitStatusText!: Phaser.GameObjects.Text;
        private collectibles!: Collectibles;
        private counterText!: Phaser.GameObjects.Text;
        private keyboardInput!: KeyboardMovementInput;
        private seed!: Phaser.GameObjects.Arc;
        private hazard!: Phaser.GameObjects.Rectangle;
        private leftPressed = false;
        private rightPressed = false;
        private jumpButtonHeld = false;
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
            zones: ENVIRONMENT_ZONES,
            waterSegments: WATER_SEGMENTS,
          });

          // Purely visual weather. Created here, before the character, so its
          // background layer is drawn behind the character (see lib/weather/rain.ts).
          this.rain = createRainEffect(Phaser, this);
          this.motion = watchReducedMotion();
          this.fx = createFeedbackEffects(this, () => this.motion.reduced);

          // Solid level geometry and pickups. Created before the character so they draw behind
          // it. The obstacles are static solids: Rara and the Hunter collide with them through
          // the colliders below, and the Hunter's line of sight is blocked by them. Collectibles
          // are overlap-only (see lib/obstacles and lib/collectibles).
          const solids = createSolids(this, WORLD_WIDTH, GROUND_SURFACE_Y, WORLD_HEIGHT);
          createObstacles(this, solids, GROUND_SURFACE_Y);
          this.collectibles = new Collectibles(this, {
            groundSurfaceY: GROUND_SURFACE_Y,
            onCollect: ({ x, y }) => this.fx.pickup(x, y),
          });
          // The goal: collect everything (the collectible counter is the only counter), then reach the exit.
          this.objective = new ObjectiveState(this.collectibles.total);
          this.exit = new ExitGate(this, { groundSurfaceY: GROUND_SURFACE_Y, solids });

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

          this.counterText = this.add
            .text(400, 152, "", { fontSize: "22px", fontStyle: "bold", color: "#ffd23f", stroke: "#000000", strokeThickness: 4 })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);
          this.registerHud(this.counterText);
          this.updateCounter(false);

          // Second HUD row: the run timer (left of centre) and the exit's state (right of centre).
          const rowStyle = { fontSize: "18px", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 };
          this.timerText = this.add
            .text(388, 182, "", { ...rowStyle, color: "#cfe8d5" })
            .setOrigin(1, 0.5)
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);
          this.exitStatusText = this.add
            .text(412, 182, "", { ...rowStyle, color: "#ff8a75" })
            .setOrigin(0, 0.5)
            .setScrollFactor(0)
            .setDepth(UI_DEPTH);
          this.registerHud(this.timerText);
          this.registerHud(this.exitStatusText);
          this.updateTimerText();
          this.updateExitStatus(false);

          registerRaraAnimations(this);

          this.character = new RaraCharacter(this, PLAYER_START_X, GROUND_Y);
          this.character.setScale(CHARACTER_SCALE);
          this.character.on("animationcomplete", () => {
            this.onAnimationComplete();
          });

          // Movement: Arcade physics moves and collides the character; the motor
          // (lib/movement) sets its velocity from input each frame. The ground is a
          // static solid whose top sits at the character's feet, so the character
          // rests at exactly the same height as before. Add future platforms and
          // obstacles to `solids` and they are collided with automatically.
          attachCharacterBody(this, this.character, DEFAULT_MOVEMENT_CONFIG, {
            minX: MOVE_MIN_X,
            maxX: MOVE_MAX_X,
            height: WORLD_HEIGHT,
          });
          this.physics.add.collider(this.character, solids);
          this.motor = new CharacterMotor(
            this.character.body as Phaser.Physics.Arcade.Body,
            DEFAULT_MOVEMENT_CONFIG,
            this.time.now,
          );
          this.motor.modifiers.controlsLocked = true; // READY: nothing moves until PLAY (see startRun)

          // The Hunters (lib/hunter): the same enemy at each placement in lib/hunter/placement.ts (zones 3-5).
          // They walk on the same solids and share the same world bounds; gameplay only, no wallet/NFT data.
          const hunterBounds = { minX: MOVE_MIN_X, maxX: MOVE_MAX_X };
          this.hunters = FIRST_LEVEL_HUNTERS.map(
            (placement) =>
              new Hunter(this, {
                config: configForPlacement(DEFAULT_HUNTER_CONFIG, placement),
                spawnX: resolveHunterSpawnX({ x: placement.x, minDistanceFromPlayer: 0 }, PLAYER_START_X, hunterBounds),
                groundSurfaceY: GROUND_SURFACE_Y,
                bounds: hunterBounds,
                solids,
                onEvent: (event) => this.onHunterEvent(event),
              }),
          );

          // Foreground mist is the nearest depth layer, so it's added last —
          // after the character it should render in front of.
          this.environment.addForegroundMist();

          this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
          // lerpY 0 disables vertical tracking: horizontal-follow only, so jumping doesn't bob the camera.
          this.cameras.main.startFollow(this.character, false, 1, 0);

          this.seed = this.add.circle(SEED_X, GROUND_Y, 10, 0x9ee493);
          this.hazard = this.add.rectangle(HAZARD_X, GROUND_Y, 20, 20, 0xff4444);

          this.keyboardInput = createKeyboardMovementInput(this, () => {
            if (this.objective.phase !== "READY") this.motor.queueJump(this.time.now);
          });
          this.input.keyboard!.on("keydown-X", () => this.swing());

          // Safety net for press-and-hold on-screen buttons: a pointer released
          // anywhere (including outside the button it was pressed on, e.g. a
          // drag-off) always clears both flags, so movement can never get stuck on.
          this.input.on("pointerup", () => {
            this.leftPressed = false;
            this.rightPressed = false;
            this.jumpButtonHeld = false;
          });

          this.createControls();
          this.createSkinPortrait();
          this.caughtOverlay = createCaughtOverlay(this, UI_DEPTH + 10, () => this.restartRun());
          this.completeOverlay = createCompleteOverlay(this, UI_DEPTH + 10, () => this.restartRun());
          // The game opens on the start screen: the run (and its timer) begins when PLAY is pressed.
          this.readyOverlay = createReadyOverlay(this, UI_DEPTH + 10, () => this.startRun());
          this.readyOverlay.show();
          // R / Enter restart from either end screen (caught, or level complete = play again), which lands on the start screen.
          for (const key of ["keydown-R", "keydown-ENTER"]) {
            this.input.keyboard!.on(key, () => {
              const { phase } = this.objective;
              if ((phase === "CAUGHT" || phase === "COMPLETE") && !isTypingInField()) this.restartRun();
            });
          }

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
            this.fx.destroy();
            this.motion.destroy();
            this.keyboardInput.destroy();
            skinApiRef.current = null;
            if (process.env.NODE_ENV !== "production") delete (window as TestWindow).__RAREWILD_TEST__;
          });
          this.applySkin(requestedSkinRef.current);
          if (process.env.NODE_ENV !== "production") (window as TestWindow).__RAREWILD_TEST__ = this.createTestHook();
        }

        /**
         * Development-only handle for the browser tests (scripts/browser): a read-only snapshot of the
         * scene, on-screen button positions, and a way to place Rara. Never present in a production build
         * (`process.env.NODE_ENV` is inlined by Next, so the branch that installs it is stripped).
         */
        private createTestHook(): TestHook {
          const screenCenter = (object: Phaser.GameObjects.Text) => {
            const camera = this.cameras.main;
            const { width, height } = this.scale;
            const b = object.getBounds();
            return {
              x: width / 2 + (b.centerX - width / 2) * camera.zoom,
              y: height / 2 + (b.centerY - height / 2) * camera.zoom,
              width: b.width * camera.zoom,
              height: b.height * camera.zoom,
            };
          };
          return {
            snapshot: () => {
              const body = this.character.body as Phaser.Physics.Arcade.Body;
              return {
                phase: this.objective.phase,
                elapsedMs: this.objective.elapsedMs,
                startedAtMs: this.objective.startedAtMs,
                timerText: this.timerText.text,
                counterText: this.counterText.text,
                exitStatusText: this.exitStatusText.text,
                collected: this.collectibles.count,
                total: this.collectibles.total,
                exitOpen: this.exit.isOpen,
                rara: { x: body.center.x, y: body.center.y, vx: body.velocity.x, vy: body.velocity.y, onFloor: body.onFloor() },
                hunters: this.hunters.map((h) => ({ x: h.x, y: h.y, state: h.state, caught: h.caught })),
                readyVisible: this.readyOverlay.visible,
                caughtVisible: this.caughtOverlay.visible,
                completeVisible: this.completeOverlay.visible,
                viewport: { width: this.scale.width, height: this.scale.height, zoom: this.cameras.main.zoom },
                feedback: {
                  active: this.fx.activeCount,
                  edgeAlpha: this.fx.edgeAlpha,
                  glowAlpha: this.fx.glowAlpha,
                  reducedMotion: this.motion.reduced,
                  sfx: { ...getSfxStats() },
                  shaking: this.cameras.main.shakeEffect.isRunning,
                  flashing: this.cameras.main.flashEffect.isRunning,
                  sceneObjects: this.children.length,
                },
              };
            },
            // On-screen centre (page px) and size of the first visible text button starting with `label`.
            buttonRect: (label) => {
              const found = this.children.list.find(
                (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text && o.visible && o.text.startsWith(label),
              );
              return found ? screenCenter(found) : null;
            },
            // Put the centre of Rara's collision box at (x, y).
            placeRara: (x, y) => {
              const body = this.character.body as Phaser.Physics.Arcade.Body;
              body.reset(this.character.x + (x - body.center.x), this.character.y + (y - body.center.y));
            },
          };
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
          const view = { width, height, hudScale, textResolution, zoom };
          this.caughtOverlay?.layout(view);
          this.completeOverlay?.layout(view);
          this.readyOverlay?.layout(view);
          this.fx?.layout({ width, height, zoom });
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

        update(time: number, delta: number) {
          // On the start screen no input reaches her: the motor is locked too, this also keeps her from turning to face a held key.
          const ready = this.objective.phase === "READY";
          const keyboardX = ready ? 0 : this.keyboardInput.readDirection();
          const left = keyboardX < 0 || this.leftPressed;
          const right = keyboardX > 0 || this.rightPressed;
          const moveX = left === right ? 0 : left ? -1 : 1;
          const jumpHeld = !ready && (this.keyboardInput.isJumpHeld() || this.jumpButtonHeld);

          const frame = this.motor.update({ moveX, jumpHeld }, delta, time);
          if (moveX !== 0) this.character.setFacing(moveX);
          if (frame.jumped) {
            this.showJumpLabel();
            const body = this.character.body as Phaser.Physics.Arcade.Body;
            this.fx.jump(body.center.x, body.bottom);
            playSfx("jump");
          }
          // Landing feedback only watches her body (it never changes it), and only while a run is live.
          const landBody = this.character.body as Phaser.Physics.Arcade.Body;
          const impact = this.landing.update(landBody.onFloor(), landBody.velocity.y);
          if (impact > 0 && this.objective.phase === "PLAYING") {
            this.fx.land(landBody.center.x, landBody.bottom, impact);
            playSfx("land", { intensity: impact });
          }
          if (!this.oneShotActive) this.syncLocomotionAnimation(frame.locomotion);

          // The run clock counts only while PLAYING: 00:00 on the start screen, frozen on CAUGHT / COMPLETE.
          this.objective.update(delta);
          this.updateTimerText();

          const target = this.hunterTarget();
          // The Hunters stay at their posts on the start screen (they are not updated, so they cannot see or chase her),
          // and once the level is complete they no longer affect her.
          if (!ready) for (const hunter of this.hunters) hunter.update(delta, this.objective.phase === "COMPLETE" ? NO_TARGET : target);
          // Rara collects (and can reach the exit) only while PLAYING: not on the start screen, not once caught or complete.
          const playing = this.objective.phase === "PLAYING";
          if (this.collectibles.update(time, playing ? target.rect : null) > 0) this.onCollected();
          this.exit.update(time);
          if (playing && this.objective.phase === "PLAYING" && this.exit.touching(target.rect)) this.onExitTouched(time);

          if (!ready) {
            this.checkSeedCollect();
            this.checkHazard();
          }

          // Danger cue: only reads what the Hunters already report, and only while the run is live (never after CAUGHT / COMPLETE).
          this.fx.setDanger(playing ? dangerEdgeAlpha(dangerLevel(this.hunters, target.x), time, this.motion.reduced) : 0);
          this.fx.update(delta);
        }

        /** The item counter changed: update the HUD, and open the exit when the last item is collected. */
        private onCollected() {
          this.updateCounter(true);
          playSfx("pickup", { step: this.collectibles.count });
          if (this.collectibles.count >= this.collectibles.total && !this.exit.isOpen) {
            this.exit.open();
            this.updateExitStatus(true);
          }
        }

        /** Rara is at the exit: the objective decides. Locked -> say so; open -> the level is complete. */
        private onExitTouched(time: number) {
          const { count, total } = this.collectibles;
          const result = this.objective.touchExit(count);
          if (result === "LOCKED") this.exit.rejectTouch(count, total, time);
          else if (result === "COMPLETE") this.onLevelComplete();
        }

        /** Everything collected and the exit reached: lock her controls, a small celebration, then the LEVEL COMPLETE screen. */
        private onLevelComplete() {
          this.motor.modifiers.controlsLocked = true;
          this.leftPressed = false;
          this.rightPressed = false;
          this.jumpButtonHeld = false;
          this.oneShotActive = true;
          this.character.setAnimationState("collect");
          this.updateTimerText();
          this.fx.complete((this.exit.box.left + this.exit.box.right) / 2, (this.exit.box.top + this.exit.box.bottom) / 2);
          playSfx("complete");
          this.time.delayedCall(COMPLETE_SCREEN_DELAY_MS, () => {
            if (!this.alive || this.objective.phase !== "COMPLETE") return;
            this.completeOverlay.show({
              collected: this.collectibles.count,
              total: this.collectibles.total,
              timeText: formatTime(this.objective.elapsedMs),
            });
          });
        }

        /** "TIME: MM:SS" in the HUD; only touches the text when the shown second changes. */
        private updateTimerText() {
          const text = `TIME: ${formatTime(this.objective.elapsedMs)}`;
          if (this.timerText.text !== text) this.timerText.setText(text);
        }

        /** "EXIT LOCKED" / "EXIT OPEN" in the HUD (a quick pulse when it opens). */
        private updateExitStatus(pulse: boolean) {
          const open = this.collectibles.count >= this.collectibles.total;
          this.exitStatusText.setText(open ? "EXIT OPEN" : "EXIT LOCKED").setColor(open ? "#9ee493" : "#ff8a75");
          if (!pulse) return;
          this.tweens.addCounter({
            from: 1,
            to: 1.3,
            duration: 110,
            yoyo: true,
            onUpdate: (tween) => this.exitStatusText.setScale(this.hudScale * tween.getValue()!),
            onComplete: () => this.exitStatusText.setScale(this.hudScale),
          });
        }

        /** "COLLECTED: n / total" in the HUD. A collect gives the text a quick pulse; a restart just resets it. */
        private updateCounter(pulse: boolean) {
          const { count, total } = this.collectibles;
          this.counterText.setText(`COLLECTED: ${count} / ${total}`).setColor(count >= total ? "#9ee493" : "#ffd23f");
          if (!pulse) return;
          this.tweens.addCounter({
            from: 1,
            to: 1.3,
            duration: 90,
            yoyo: true,
            onUpdate: (tween) => this.counterText.setScale(this.hudScale * tween.getValue()!),
            onComplete: () => this.counterText.setScale(this.hudScale),
          });
        }

        /** Rara as the Hunter perceives her (and as pickups see her): her body centre and box. */
        private hunterTarget(): HunterTarget {
          const body = this.character.body as Phaser.Physics.Arcade.Body;
          return {
            x: body.center.x,
            y: body.center.y,
            rect: { left: body.left, top: body.top, right: body.right, bottom: body.bottom },
          };
        }

        private onHunterEvent(event: HunterEvent) {
          if (event.type === "PLAYER_CAUGHT") this.onPlayerCaught();
          else if (event.type === "PLAYER_DETECTED" && this.objective.phase === "PLAYING") playSfx("danger");
        }

        /** The Hunter caught Rara: lock her controls, hit feedback, a brief hit-stop, then the CAUGHT screen. */
        private onPlayerCaught() {
          if (!this.objective.caught()) return; // only while PLAYING (never after completing the level)
          this.motor.modifiers.controlsLocked = true;
          this.oneShotActive = true;
          this.character.setAnimationState("hit");
          const body = this.character.body as Phaser.Physics.Arcade.Body;
          this.fx.capture(body.center.x, body.center.y);
          playSfx("capture");
          // With reduced motion the shake and the flash give way to the red screen-edge pulse above.
          if (!this.motion.reduced) {
            this.cameras.main.shake(320, 0.012);
            this.cameras.main.flash(220, 255, 70, 40);
          }
          this.physics.pause();
          this.time.delayedCall(CAUGHT_HITSTOP_MS, () => {
            if (!this.alive) return;
            this.physics.resume();
            if (this.objective.phase === "CAUGHT") this.caughtOverlay.show();
          });
        }

        /** PLAY was pressed: gameplay goes live and the timer starts at this moment (the objective records the scene time). */
        private startRun() {
          if (!this.objective.start(this.time.now)) return; // only from READY
          this.readyOverlay.hide();
          this.motor.modifiers.controlsLocked = false;
          this.leftPressed = false;
          this.rightPressed = false;
          this.jumpButtonHeld = false;
          this.updateTimerText();
        }

        /**
         * Start over in place after a catch or a completed level ("RESTART" / "PLAY AGAIN"). No scene reload,
         * so rain, music and the skin carry on untouched. Resets Rara, the Hunters, the collectibles and
         * counter, the exit, the timer and the phase, and returns to the start screen: the new run does not
         * begin until PLAY is pressed.
         */
        private restartRun() {
          if (this.objective.phase !== "CAUGHT" && this.objective.phase !== "COMPLETE") return;
          this.objective.reset();
          this.caughtOverlay.hide();
          this.completeOverlay.hide();
          this.readyOverlay.show();
          const body = this.character.body as Phaser.Physics.Arcade.Body;
          body.reset(PLAYER_START_X, GROUND_Y);
          this.motor = new CharacterMotor(body, DEFAULT_MOVEMENT_CONFIG, this.time.now); // fresh state
          this.motor.modifiers.controlsLocked = true; // READY: locked until PLAY
          this.character.setAnimationState("idle");
          this.oneShotActive = false;
          this.leftPressed = false;
          this.rightPressed = false;
          this.jumpButtonHeld = false;
          this.seed.setPosition(SEED_X, GROUND_Y).setVisible(true);
          this.hazardCooldownUntil = 0;
          this.fx.clear(); // no effect outlives the run it belonged to
          this.cameras.main.resetFX(); // ...including a capture shake / flash still playing when R is pressed
          this.landing.reset();
          for (const hunter of this.hunters) hunter.reset();
          this.collectibles.reset();
          this.exit.lock();
          this.updateCounter(false);
          this.updateExitStatus(false);
          this.updateTimerText();
        }

        /**
         * Idle / run / jump follow the motor's movement state. There is no separate
         * fall animation: the jump animation plays once and holds its last (legs
         * extended) frame until touchdown. Touching down while still moving goes
         * straight to run; touching down at rest plays the landing first.
         */
        private syncLocomotionAnimation(locomotion: Locomotion) {
          const state = this.character.getAnimationState();
          if (locomotion === "air") {
            if (state !== "jump") this.character.setAnimationState("jump");
          } else if (locomotion === "run") {
            this.character.setAnimationState("run");
          } else if (state === "jump") {
            this.character.setAnimationState("land");
          } else if (state !== "land") {
            this.character.setAnimationState("idle");
          }
        }

        /** Small "JUMP" label that floats up from the character at takeoff. */
        private showJumpLabel() {
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
        }

        private swing() {
          if (this.oneShotActive || this.objective.phase === "READY") return;
          this.oneShotActive = true;
          this.character.setAnimationState("swing");
        }

        /**
         * Unlock movement-driven animation once a one-shot (collect/hit/swing)
         * finishes, and settle out of the landing animation. Reads the sprite's own
         * tracked state rather than parsing the Phaser animation key, since that key's
         * format differs between the default ("rara-<state>") and a skin
         * ("rara-skin-<skinKey>-<state>").
         */
        private onAnimationComplete() {
          const state = this.character.getAnimationState();
          if (state === "land") {
            this.character.setAnimationState("idle");
          } else if (state === "collect" || state === "hit" || state === "swing") {
            this.oneShotActive = false; // update() picks the right idle/run/jump animation next frame
          }
        }

        /** A random spot for the respawning seed in the starting zone, never inside or hugging an obstacle. */
        private pickSeedX(): number {
          for (let attempt = 0; attempt < 20; attempt++) {
            const x = Phaser.Math.Between(MOVE_MIN_X, ZONE_START.end);
            if (isClearOfObstacles(x, SEED_OBSTACLE_MARGIN, FIRST_LEVEL_OBSTACLES)) return x;
          }
          return SEED_X;
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
              this.seed.setPosition(this.pickSeedX(), GROUND_Y);
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
            this.leftPressed = this.objective.phase !== "READY";
          });
          leftButton.on("pointerup", () => {
            this.leftPressed = false;
          });
          leftButton.on("pointerout", () => {
            this.leftPressed = false;
          });

          rightButton.on("pointerdown", () => {
            this.rightPressed = this.objective.phase !== "READY";
          });
          rightButton.on("pointerup", () => {
            this.rightPressed = false;
          });
          rightButton.on("pointerout", () => {
            this.rightPressed = false;
          });

          // Same press-and-hold contract as the keyboard: the press queues a jump
          // once, holding it keeps the jump high, releasing it early cuts the jump short.
          jumpButton.on("pointerdown", () => {
            if (this.objective.phase === "READY") return; // the start screen: PLAY first
            this.jumpButtonHeld = true;
            this.motor.queueJump(this.time.now);
          });
          jumpButton.on("pointerup", () => {
            this.jumpButtonHeld = false;
          });
          jumpButton.on("pointerout", () => {
            this.jumpButtonHeld = false;
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
        physics: { default: "arcade", arcade: { gravity: { x: 0, y: DEFAULT_MOVEMENT_CONFIG.gravity } } },
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
