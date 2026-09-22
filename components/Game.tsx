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
import { getMusicOutput } from "@/lib/audio/music";
import { currentSfxLevel, getSfxStats, playSfx } from "@/lib/audio/sfx";
import { isTouchPhone } from "@/lib/platform/touchPhone";
import {
  canvasSizeFor,
  environmentTextureScale,
  getActiveRenderScale,
  MAX_PHONE_TEXT_RESOLUTION,
  renderScaleFor,
  setActiveRenderScale,
  worldTextResolution,
} from "@/lib/render/quality";
import { controlSideMargin, layoutCamera, layoutTouchControls, MOBILE_HUD_TEXT_BOOST, MOBILE_WORLD_EXTENSION } from "@/lib/mobile/layout";
import SkinSelector from "@/components/SkinSelector";
import WalletPanel from "@/components/WalletPanel";
import OverlayDrawer from "@/components/OverlayDrawer";
import MusicControl from "@/components/MusicControl";
import RotateDeviceOverlay from "@/components/RotateDeviceOverlay";

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
/** Mobile landscape only: how far below SAVE THE MANGROVE's row the timer sits, CSS px (position only — its own row alignment is otherwise unchanged). */
const LANDSCAPE_TIMER_DROP_PX = 8;

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
    viewport: { width: number; height: number; zoom: number; worldView: { x: number; y: number; width: number; height: number } };
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
    /** Touch controls: whether this is a phone, which on-screen buttons are held right now (by finger or mouse), and how many touch pointers exist. */
    touch: { phone: boolean; held: { left: boolean; right: boolean; jump: boolean }; pointers: number };
    /** What is producing the sound: the music output (gain node on a phone) and the level the sound effects would play at. */
    audio: ReturnType<typeof getMusicOutput> & { sfxLevel: number };
  };
  buttonRect(label: string): { x: number; y: number; width: number; height: number } | null;
  placeRara(x: number, y: number): void;
  /** Every object in the scene, with how much its texture is stretched on the canvas (see MainScene.renderAudit). */
  renderAudit(): RenderAudit;
};
type AuditEntry = { kind: string; name: string; magnification: number | null };
type RenderAudit = {
  renderScale: number;
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number };
  cameraZoom: number;
  textureScale: number;
  /** How many objects of each kind the scene holds (Text, Image, TileSprite, Sprite, Emitter, or Vector for shapes drawn with no texture). */
  counts: Record<string, number>;
  /** Every textured object or emitter: canvas px per texture px. Above 1 the texture is stretched, and so is softer. */
  entries: AuditEntry[];
  textureMB: number;
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
    let resizeObserver: ResizeObserver | undefined;
    let resizeSettleTimer: ReturnType<typeof setTimeout> | undefined;

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
        /** True on a phone / tablet (lib/platform/touchPhone.ts). Every mobile-only behavior below is behind it; desktop never sees it. */
        private mobile = isTouchPhone();
        /** Which on-screen button each finger (by pointer id) is holding, so several can be held at once. Only ever filled by touch. */
        private touchHolds = new Map<number, "left" | "right" | "jump">();
        /** How much larger the HUD lines are drawn: 1 on desktop, MOBILE_HUD_TEXT_BOOST on a phone. */
        private textBoost = 1;
        private subtitleText?: Phaser.GameObjects.Text;
        /** How many times larger than its world size the SVG art was rasterised (1 unless it is a phone: lib/render/quality.ts). */
        private textureScale = 1;
        private controlButtons: { id: string; object: Phaser.GameObjects.Text }[] = [];
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
          // On a phone the canvas has one pixel per device pixel, so the camera shows the world magnified: rasterise the art to match.
          const renderScale = getActiveRenderScale();
          this.textureScale = environmentTextureScale(this.scale.width / renderScale, this.scale.height / renderScale, renderScale, this.mobile);
          preloadEnvironmentAssets(this, this.textureScale);
          preloadRaraAssets(this);
        }

        create() {
          this.textBoost = this.mobile ? MOBILE_HUD_TEXT_BOOST : 1;
          this.cameras.main.setBackgroundColor("#10251d");

          this.environment = new EnvironmentLayer(this, {
            worldWidth: WORLD_WIDTH,
            worldHeight: WORLD_HEIGHT,
            groundY: GROUND_Y,
            seed: ENVIRONMENT_SEED,
            zones: ENVIRONMENT_ZONES,
            waterSegments: WATER_SEGMENTS,
            // On a phone the camera frames a little more height than the world has: carry the ground on below it (see MOBILE_WORLD_EXTENSION).
            extendBelow: this.mobile ? MOBILE_WORLD_EXTENSION : undefined,
            textureScale: this.textureScale,
            crispSeams: this.mobile,
          });

          // Purely visual weather. Created here, before the character, so its
          // background layer is drawn behind the character (see lib/weather/rain.ts).
          this.rain = createRainEffect(Phaser, this, { textureScale: this.textureScale });

          // Phaser starts with ONE touch pointer; the four on-screen buttons need up to four fingers at once.
          if (this.mobile) this.input.addPointer(3);
          this.motion = watchReducedMotion();
          this.fx = createFeedbackEffects(this, () => this.motion.reduced, this.textureScale);

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
          this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) {
              // A finger only lets go of the button it was holding: the others stay held.
              this.releaseTouch(pointer);
              return;
            }
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
            const k = getActiveRenderScale(); // page (CSS) px: canvas px divided by the pixels per CSS px
            return {
              x: (width / 2 + (b.centerX - width / 2) * camera.zoom) / k,
              y: (height / 2 + (b.centerY - height / 2) * camera.zoom) / k,
              width: (b.width * camera.zoom) / k,
              height: (b.height * camera.zoom) / k,
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
                viewport: {
                  // (page px: the canvas is `renderScale` times larger than this on a phone; see snapshot().render)
                  width: this.scale.width / getActiveRenderScale(),
                  height: this.scale.height / getActiveRenderScale(),
                  zoom: this.cameras.main.zoom / getActiveRenderScale(),
                  worldView: { x: this.cameras.main.worldView.x, y: this.cameras.main.worldView.y, width: this.cameras.main.worldView.width, height: this.cameras.main.worldView.height },
                },
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
                touch: {
                  phone: this.mobile,
                  held: {
                    left: this.leftPressed || this.touchHeld("left"),
                    right: this.rightPressed || this.touchHeld("right"),
                    jump: this.jumpButtonHeld || this.touchHeld("jump"),
                  },
                  pointers: this.input.manager.pointers.length,
                },
                audio: { ...getMusicOutput(), sfxLevel: currentSfxLevel() },
              };
            },
            // On-screen centre (page px) and size of the first visible text button starting with `label`.
            buttonRect: (label) => {
              const found = this.children.list.find(
                (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text && o.visible && o.scrollFactorX === 0 && o.text.startsWith(label),
              );
              return found ? screenCenter(found) : null;
            },
            // Put the centre of Rara's collision box at (x, y).
            renderAudit: () => this.renderAudit(),
            placeRara: (x, y) => {
              const body = this.character.body as Phaser.Physics.Arcade.Body;
              body.reset(this.character.x + (x - body.center.x), this.character.y + (y - body.center.y));
            },
          };
        }

        /**
         * Development-only: how sharp is everything the scene draws? For each textured object this is the number of CANVAS pixels
         * one TEXTURE pixel is stretched over (1 = one to one, below 1 = detail to spare, above 1 = stretched and therefore soft).
         * Text: its render resolution against the size it is drawn at. Images and tile sprites: their scale times the camera zoom.
         * Particle emitters: the camera zoom over how much larger than its 1x design their texture was drawn. Shapes drawn with no
         * texture (obstacles, Hunters, collectibles, the buttons' outlines, panels) are vector: drawn afresh at the canvas resolution,
         * so they have nothing to stretch. It reads the same scene the player sees, so nothing can be missed by looking at a list of names.
         */
        private renderAudit(): RenderAudit {
          const zoom = this.cameras.main.zoom;
          const counts: Record<string, number> = {};
          const entries: AuditEntry[] = [];
          const count = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
          const visit = (object: Phaser.GameObjects.GameObject) => {
            if (object instanceof Phaser.GameObjects.Text) {
              count("Text");
              // Drawn at |scaleX| * zoom canvas px per CSS-px-of-text, from a canvas `resolution` px per CSS px: that ratio is the stretch.
              entries.push({ kind: "Text", name: JSON.stringify(object.text.slice(0, 24)), magnification: (Math.abs(object.scaleX) * zoom) / object.style.resolution });
            } else if (object instanceof Phaser.GameObjects.TileSprite) {
              count("TileSprite");
              entries.push({ kind: "TileSprite", name: object.texture.key, magnification: object.tileScaleX * Math.abs(object.scaleX) * zoom });
            } else if (object instanceof Phaser.GameObjects.Sprite || object instanceof Phaser.GameObjects.Image) {
              const kind = object instanceof Phaser.GameObjects.Sprite ? "Sprite" : "Image";
              count(kind);
              entries.push({ kind, name: object.texture.key, magnification: Math.abs(object.scaleX) * zoom });
            } else if (object instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
              count("Emitter");
              // Their textures are drawn `textureScale` times larger than the 1x design, and the particles scaled back by that much.
              const source = object.texture.getSourceImage() as { width: number };
              const logical: Record<string, number> = { "rain-streak-far": 4, "rain-streak-mid": 4, "rain-streak-near": 10, "fx-dust": 24, "fx-spark": 16 };
              entries.push({ kind: "Emitter", name: object.texture.key, magnification: (zoom * (logical[object.texture.key] ?? source.width)) / source.width });
            } else if (object instanceof Phaser.GameObjects.Graphics || object instanceof Phaser.GameObjects.Shape) {
              count("Vector");
            } else if (object instanceof Phaser.GameObjects.Container) {
              count("Container");
              object.list.forEach((child) => visit(child));
            }
          };
          this.children.list.forEach((object) => visit(object));
          let bytes = 0;
          for (const key of this.textures.getTextureKeys()) {
            if (key.startsWith("__")) continue;
            const image = this.textures.get(key).getSourceImage() as { width: number; height: number };
            bytes += image.width * image.height * 4;
          }
          const renderScale = getActiveRenderScale();
          const box = this.game.canvas.getBoundingClientRect();
          return {
            renderScale,
            canvas: { width: this.scale.width, height: this.scale.height, cssWidth: box.width, cssHeight: box.height },
            cameraZoom: zoom,
            textureScale: this.textureScale,
            counts,
            entries,
            textureMB: +(bytes / 1048576).toFixed(1),
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
          // On a phone the canvas has `renderScale` pixels per CSS pixel (1 everywhere else). Everything below is designed in
          // CSS pixels, so `width` / `height` and the zooms used for the design maths are CSS-based and keep their numbers;
          // only where something is finally placed and how large it is drawn (`cx`, `cy`, `zoom`) is in canvas pixels.
          const renderScale = getActiveRenderScale();
          const cx = this.scale.width / 2;
          const cy = this.scale.height / 2;
          const width = this.scale.width / renderScale;
          const height = this.scale.height / renderScale;
          // `uiZoom` is what every screen-space layout below was designed against (the window height over the design height).
          // The camera's own zoom equals it, except on a phone where it is a little lower to show more of the world; the
          // screen-space objects are then scaled by `compensate` so their on-screen size and place do not change (see layoutCamera).
          const { uiZoom, zoom: cssZoom, compensate } = layoutCamera({ height }, DESIGN_HEIGHT, this.mobile);
          const zoom = cssZoom * renderScale; // the camera's zoom in canvas pixels per world pixel
          this.cameras.main.setZoom(zoom);
          // TEMPORARY DIAGNOSTIC ONLY (see the same-tagged block in the Game() component above; remove together).
          if (this.mobile && process.env.NODE_ENV !== "production") {
            const wv = this.cameras.main.worldView;
            console.log("[RAREWILD DIAG] MainScene.layout()", {
              t: Math.round(performance.now()),
              orientation: width > height ? "landscape" : "portrait",
              scaleWH: `${this.scale.width}x${this.scale.height}`,
              cssWH: `${width}x${height}`,
              renderScale,
              uiZoom,
              cssZoom,
              compensate,
              appliedZoom: zoom,
              cameraZoomReadBack: this.cameras.main.zoom,
              worldView: { x: wv.x, y: wv.y, w: wv.width, h: wv.height },
              canvasBoundingRect: (() => {
                const r = this.game.canvas.getBoundingClientRect();
                return { w: r.width, h: r.height };
              })(),
            });
          }
          // The area a scroll-factor-0 object can see, in camera-local coordinates: the rain fills exactly this.
          this.rain?.resize({
            left: cx - this.scale.width / (2 * zoom),
            top: cy - this.scale.height / (2 * zoom),
            width: this.scale.width / zoom,
            height: this.scale.height / zoom,
          });

          const hudScale = Math.min(1, width / uiZoom / DESIGN_WIDTH);
          const localScale = hudScale * compensate; // the scale in camera-local px: on screen it is zoom * localScale = uiZoom * hudScale (x renderScale in canvas px)
          this.hudScale = localScale;
          // Render text with exactly as many texture pixels as it is drawn with canvas pixels, so nothing is stretched or shrunk into blur.
          const maxTextResolution = renderScale === 1 ? 4 : MAX_PHONE_TEXT_RESOLUTION;
          const textResolution = Math.min(maxTextResolution, Math.max(1, zoom * localScale));
          for (const { object, x, y } of this.hud) {
            object.setPosition(
              cx + (x - DESIGN_WIDTH / 2) * localScale,
              cy + (y - DESIGN_HEIGHT / 2) * compensate,
            );
            if (object === this.portrait) object.setDisplaySize(PORTRAIT_SIZE * localScale, PORTRAIT_SIZE * localScale);
            else object.setScale(localScale);
            if (object instanceof Phaser.GameObjects.Text) object.setResolution(textResolution);
          }
          if (this.mobile) this.layoutMobile(width, height, cx, cy, uiZoom, cssZoom, zoom, localScale);
          const view = { width: this.scale.width, height: this.scale.height, hudScale: localScale, textResolution, zoom };
          this.caughtOverlay?.layout(view);
          this.completeOverlay?.layout(view);
          this.readyOverlay?.layout(view);
          this.fx?.layout({ width: this.scale.width, height: this.scale.height, zoom });
        }

        /**
         * PHONES ONLY (desktop never calls this): draw the HUD lines under the title a little larger, and the four
         * control buttons larger and centred as one group, on top of the shared layout above. The buttons keep their
         * order, spacing and row; only their size and the group's position change (see lib/mobile/layout.ts).
         */
        private layoutMobile(width: number, height: number, cx: number, cy: number, uiZoom: number, cssZoom: number, zoom: number, hudScale: number) {
          this.subtitleText ??= this.hud.find(({ object }) => object instanceof Phaser.GameObjects.Text && object.text === "SAVE THE MANGROVE")?.object as Phaser.GameObjects.Text | undefined;
          const lines = [this.subtitleText, this.counterText, this.timerText, this.exitStatusText];
          for (const text of lines) text?.setScale(hudScale * this.textBoost).setResolution(Math.min(MAX_PHONE_TEXT_RESOLUTION, Math.max(1, zoom * hudScale * this.textBoost)));

          // LANDSCAPE ONLY: the timer moves up to share the subtitle's row, near the left edge, instead of pairing with the
          // exit status below the counter (RAREWILD and SAVE THE MANGROVE stay exactly where they always were). Portrait
          // restores the timer's original position and right-aligned origin, so a rotation back to portrait is never left
          // with the landscape placement (see MainScene.layout, which calls this every resize).
          const landscapeHud = width > height;
          const compensate = uiZoom / cssZoom; // the CSS-space camera zoom, not `zoom` (which is already multiplied by the device pixel ratio)
          const timerDesign = this.hud.find((h) => h.object === this.timerText)!;
          if (landscapeHud && this.subtitleText) {
            const subtitleDesign = this.hud.find((h) => h.object === this.subtitleText)!;
            // The X target is a real CSS-pixel edge margin (the same convention the controls use), converted like the controls
            // are: dividing by cssZoom, not multiplying by the design-frame scale. That "*scale" approach (used for Y, and for
            // every other HUD line, which all sit close to the design frame's own centre) shrinks a LARGE offset from centre
            // disproportionately once cssZoom is not 1, since the whole 800x600 frame is scaled around its centre as one block;
            // it only ever looked right before because nothing else was ever moved this far from that centre.
            const targetLeftCss = controlSideMargin(width);
            this.timerText
              .setOrigin(0, 0.5)
              .setPosition(cx + (targetLeftCss - width / 2) / cssZoom, cy + (subtitleDesign.y - DESIGN_HEIGHT / 2) * compensate + LANDSCAPE_TIMER_DROP_PX / cssZoom);
          } else {
            this.timerText.setOrigin(1, 0.5).setPosition(cx + (timerDesign.x - DESIGN_WIDTH / 2) * hudScale, cy + (timerDesign.y - DESIGN_HEIGHT / 2) * compensate);
          }

          const designs = this.controlButtons.map(({ id, object }) => {
            const entry = this.hud.find((h) => h.object === object)!;
            return { id, x: entry.x, y: entry.y, width: object.width, height: object.height };
          });
          const placements = layoutTouchControls({ width, height, zoom: uiZoom, designHeight: DESIGN_HEIGHT, groundDesignY: GROUND_SURFACE_Y }, designs);
          for (const placement of placements) {
            const object = this.controlButtons.find((b) => b.id === placement.id)!.object;
            // A scroll-factor-0 object is drawn `cssZoom` times larger (in CSS px) around the window centre, so CSS px map to local px by / cssZoom.
            // Its texture gets one pixel per canvas pixel it is drawn with: placement.scale CSS px per design px, times the pixels per CSS px.
            object
              .setPosition(cx + (placement.screenX - width / 2) / cssZoom, cy + (placement.screenY - height / 2) / cssZoom)
              .setScale(placement.scale / cssZoom)
              .setResolution(Math.min(MAX_PHONE_TEXT_RESOLUTION, Math.max(1, placement.scale * (zoom / cssZoom))));
            // The button answers touches over a taller area than it is drawn when it would otherwise be under a thumb-sized target.
            (object.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setTo(0, -placement.hitPadY, object.width, object.height + 2 * placement.hitPadY);
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

        /**
         * PHONES ONLY. The portrait art is 800px and the HUD shows it at about 130 device px: the GPU shrinks it without any
         * averaging, which leaves it noisy. This returns a copy the browser's high-quality resampler has already shrunk to a size
         * that is still 1.5x or more the largest the HUD draws it at, so what the GPU does is a mild, clean reduction.
         */
        private sharpPortraitKey(key: string): string {
          const hdKey = `${key}-hd`;
          if (this.textures.exists(hdKey)) return hdKey;
          const source = this.textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
          const size = Math.min(source.width, 320);
          const copy = this.textures.createCanvas(hdKey, size, size);
          if (!copy) return key;
          const context = copy.getContext();
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(source, 0, 0, source.width, source.height, 0, 0, size, size);
          copy.refresh();
          return hdKey;
        }

        /** Show the selected token's artwork (loaded on demand, only for this token); hide it for the default skin. */
        private async showPortrait(skin: RareWildSkin, request: number) {
          const key = await ensureSkinPortrait(this, skin);
          if (!this.alive || request !== this.skinRequest) return; // scene closed or a newer skin was picked
          const visible = key !== null;
          if (key) this.portrait.setTexture(this.mobile ? this.sharpPortraitKey(key) : key).setDisplaySize(PORTRAIT_SIZE * this.hudScale, PORTRAIT_SIZE * this.hudScale);
          this.portrait.setVisible(visible);
          this.portraitFrame.setVisible(visible);
        }

        update(time: number, delta: number) {
          // On the start screen no input reaches her: the motor is locked too, this also keeps her from turning to face a held key.
          const ready = this.objective.phase === "READY";
          const keyboardX = ready ? 0 : this.keyboardInput.readDirection();
          this.pruneTouchHolds();
          const left = keyboardX < 0 || this.leftPressed || this.touchHeld("left");
          const right = keyboardX > 0 || this.rightPressed || this.touchHeld("right");
          const moveX = left === right ? 0 : left ? -1 : 1;
          const jumpHeld = !ready && (this.keyboardInput.isJumpHeld() || this.jumpButtonHeld || this.touchHeld("jump"));

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

        /** Is a finger holding this on-screen button? (Touch only: a mouse press uses the flags.) */
        private touchHeld(button: "left" | "right" | "jump"): boolean {
          for (const held of this.touchHolds.values()) if (held === button) return true;
          return false;
        }

        /** A finger went down on an on-screen button. Each finger is tracked by its own pointer id, so buttons can be held together. */
        private holdTouch(pointer: Phaser.Input.Pointer, button: "left" | "right" | "jump") {
          if (this.objective.phase === "READY") return; // the start screen: PLAY first
          this.touchHolds.set(pointer.id, button);
          if (button === "jump") this.motor.queueJump(this.time.now);
        }

        /** That finger lifted or slid off its button: it lets go of what IT was holding, and nothing else. */
        private releaseTouch(pointer: Phaser.Input.Pointer) {
          this.touchHolds.delete(pointer.id);
        }

        /** Safety net: forget any finger the browser no longer reports as down (a cancelled touch, e.g. by a system gesture, never sends a release). */
        private pruneTouchHolds() {
          for (const id of this.touchHolds.keys()) if (!this.input.manager.pointers[id]?.isDown) this.touchHolds.delete(id);
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
          this.touchHolds.clear();
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
            onUpdate: (tween) => this.exitStatusText.setScale(this.hudScale * this.textBoost * tween.getValue()!),
            onComplete: () => this.exitStatusText.setScale(this.hudScale * this.textBoost),
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
            onUpdate: (tween) => this.counterText.setScale(this.hudScale * this.textBoost * tween.getValue()!),
            onComplete: () => this.counterText.setScale(this.hudScale * this.textBoost),
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
          this.touchHolds.clear();
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
          this.touchHolds.clear();
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
            .setResolution(worldTextResolution(1, this.scale.width, this.scale.height)) // 1, as always, off a phone
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
          // Each handler has two paths: a finger is tracked by its pointer id (see holdTouch); a mouse keeps the single flag it always had.
          leftButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.holdTouch(pointer, "left");
            else this.leftPressed = this.objective.phase !== "READY";
          });
          leftButton.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.releaseTouch(pointer);
            else this.leftPressed = false;
          });
          leftButton.on("pointerout", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.releaseTouch(pointer);
            else this.leftPressed = false;
          });

          rightButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.holdTouch(pointer, "right");
            else this.rightPressed = this.objective.phase !== "READY";
          });
          rightButton.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.releaseTouch(pointer);
            else this.rightPressed = false;
          });
          rightButton.on("pointerout", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.releaseTouch(pointer);
            else this.rightPressed = false;
          });

          // Same press-and-hold contract as the keyboard: the press queues a jump
          // once, holding it keeps the jump high, releasing it early cuts the jump short.
          jumpButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) {
              this.holdTouch(pointer, "jump");
              return;
            }
            if (this.objective.phase === "READY") return; // the start screen: PLAY first
            this.jumpButtonHeld = true;
            this.motor.queueJump(this.time.now);
          });
          jumpButton.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.releaseTouch(pointer);
            else this.jumpButtonHeld = false;
          });
          jumpButton.on("pointerout", (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch) this.releaseTouch(pointer);
            else this.jumpButtonHeld = false;
          });

          swingButton.on("pointerdown", () => {
            this.swing();
          });

          this.controlButtons = [
            { id: "left", object: leftButton },
            { id: "right", object: rightButton },
            { id: "swing", object: swingButton },
            { id: "jump", object: jumpButton },
          ];
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

      // PHONE: the canvas gets one pixel per DEVICE pixel (a 390x844 window on a devicePixelRatio-3 phone is a 1170x2532
      // canvas), shown at exactly its CSS size, so the browser does not stretch (and blur) it. Phaser has no such mode of its
      // own (its RESIZE mode sizes the canvas in CSS pixels), so the phone uses a fixed-size canvas that follows its container
      // (see lib/render/quality.ts). Everything else is exactly the configuration the game has always had.
      const phone = isTouchPhone();
      const container = gameRef.current;
      const cssBox = () => {
        const box = container.getBoundingClientRect();
        return { width: box.width || window.innerWidth, height: box.height || window.innerHeight };
      };
      const phoneScale = () => {
        const box = cssBox();
        const scale = renderScaleFor(box.width, box.height, window.devicePixelRatio || 1, true);
        return { box, scale, canvas: canvasSizeFor(box.width, box.height, scale) };
      };
      const start = phone ? phoneScale() : null;
      if (start) setActiveRenderScale(start.scale);
      // TEMPORARY DIAGNOSTIC ONLY — logs the values needed to find the mobile-landscape black-screen bug (see the
      // conversation this was added for). Read-only: it changes nothing about behavior, only what is printed to the
      // console. Remove this whole block (and the `diag` calls it enables below) once that bug is fixed.
      const diag =
        phone && process.env.NODE_ENV !== "production"
          ? (label: string) => {
              const canvas = game?.canvas;
              const canvasRect = canvas?.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const cs = canvas ? getComputedStyle(canvas) : null;
              console.log(`[RAREWILD DIAG] ${label}`, {
                t: Math.round(performance.now()),
                orientation: window.innerWidth > window.innerHeight ? "landscape" : "portrait",
                windowInnerWH: `${window.innerWidth}x${window.innerHeight}`,
                docClientWH: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
                devicePixelRatio: window.devicePixelRatio,
                containerRect: containerRect && { w: containerRect.width, h: containerRect.height },
                canvasBoundingRect: canvasRect && { w: canvasRect.width, h: canvasRect.height, top: canvasRect.top, left: canvasRect.left },
                canvasAttrWH: canvas && `${canvas.width}x${canvas.height}`,
                canvasStyleWH: cs && `${cs.width} x ${cs.height}`,
                canvasDisplayVisibilityOpacity: cs && `${cs.display} / ${cs.visibility} / ${cs.opacity}`,
                scaleWH: game && `${game.scale.width}x${game.scale.height}`,
                scaleZoom: game?.scale.zoom,
                activeRenderScale: getActiveRenderScale(),
              });
            }
          : null;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        scale: start
          ? { mode: Phaser.Scale.NONE, width: start.canvas.width, height: start.canvas.height, zoom: 1 / start.scale }
          : // The canvas always matches its container (which fills the window).
            { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
        // Textures are drawn at whole-pixel positions on a phone (one canvas pixel is one device pixel there, so no sub-pixel
        // sampling softness); off a phone this is Phaser's default and nothing changes.
        ...(phone ? { render: { roundPixels: true } } : {}),
        parent: gameRef.current,
        physics: { default: "arcade", arcade: { gravity: { x: 0, y: DEFAULT_MOVEMENT_CONFIG.gravity } } },
        scene: MainScene,
      });
      diag?.("boot");
      if (phone) {
        // Phaser's ScaleManager runs its OWN `window: "resize"` / `orientationchange` DOM listeners in parallel with
        // whatever the app does (see node_modules/phaser/src/scale/ScaleManager.js: startListeners/windowResize):
        // on a native `resize` event (which mobile Safari fires, repeatedly, all through a rotation) it calls
        // `refresh()` immediately and completely undebounced, before this component's own resize below ever runs.
        // That leaves the ScaleManager's backing-store size (`baseSize`, still the old orientation) and its freshly
        // re-measured CSS bounds (`canvasBounds`, already reflowed for the new one) briefly inconsistent, and
        // `Scale.Events.RESIZE` fires from it too, so `MainScene.layout()` can run against that inconsistent state.
        // Debouncing this component's own resize couldn't fix that: it only affected this path, not Phaser's own.
        // The phone canvas size is driven entirely by the ResizeObserver below instead, so Phaser's own copy of the
        // same job is turned off here; the `Scale.Events.RESIZE` event this component listens on keeps firing
        // exactly as before, just only from the (now single) explicit `resize()` call.
        game.scale.stopListeners();
        // Follow the container (rotation, the browser's toolbars): a new canvas size, and the pixels-per-CSS-pixel with it.
        // A rotation fires several of these in quick succession while the OS animates it (the browser chrome collapsing,
        // the viewport settling), and applying every one live would call `game.scale.resize()` (which resets the canvas's
        // width/height and so clears its drawing buffer, same as any HTML canvas) that many times in a row, faster than
        // Phaser can redraw between them: the screen can go black for the rest of the transition. So the resize itself is
        // debounced to once the size has stopped changing for RESIZE_SETTLE_MS, using whatever the size is by then.
        let last = `${start!.canvas.width}x${start!.canvas.height}@${start!.scale}`;
        const RESIZE_SETTLE_MS = 120;
        const follow = () => {
          if (cancelled || !game) return;
          diag?.("observer-tick (raw, pre-debounce)");
          if (resizeSettleTimer !== undefined) clearTimeout(resizeSettleTimer);
          resizeSettleTimer = setTimeout(() => {
            resizeSettleTimer = undefined;
            if (cancelled || !game) return;
            const now = phoneScale();
            const key = `${now.canvas.width}x${now.canvas.height}@${now.scale}`;
            if (key === last) return;
            last = key;
            diag?.("pre-resize (debounce settled)");
            setActiveRenderScale(now.scale);
            game.scale.setZoom(1 / now.scale);
            game.scale.resize(now.canvas.width, now.canvas.height);
            diag?.("post-resize (synchronous)");
            // Two rAF ticks out: after the browser has actually painted the post-resize frame(s), so a bug that
            // only shows up once things have "settled" (a bad state that persists rather than a one-frame flash)
            // is visible here too, not just in the synchronous log right above.
            requestAnimationFrame(() => requestAnimationFrame(() => diag?.("settled (+2 rAF)")));
          }, RESIZE_SETTLE_MS);
        };
        resizeObserver = new ResizeObserver(follow);
        resizeObserver.observe(container);
      }
    };

    startGame();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeSettleTimer !== undefined) clearTimeout(resizeSettleTimer);
      if (game) {
        game.destroy(true);
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={gameRef} className="absolute inset-0 overflow-hidden [&>canvas]:block [@media(hover:none)_and_(pointer:coarse)]:touch-none" />
      <OverlayDrawer label="Wallet & Skins">
        <SkinSelector activeSkin={activeSkin} notice={notice} onSelect={selectSkin} />
        <WalletPanel activeSkin={activeSkin} onSelectToken={(tokenId) => void selectSkin(tokenId)} />
      </OverlayDrawer>
      <MusicControl />
      <RotateDeviceOverlay />
    </div>
  );
}
