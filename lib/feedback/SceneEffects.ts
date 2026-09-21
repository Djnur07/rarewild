/**
 * The scene's feedback effects: small, short-lived things drawn over the existing game. They only
 * ever DRAW. Nothing here reads input, moves a body, changes a Hunter or touches the objective;
 * the scene tells it what just happened and it plays the matching effect.
 *
 *   pickup    a small gold sparkle burst where an item was collected
 *   jump      a tiny dust puff at Rara's feet
 *   land      a dust puff (bigger with the impact) at her feet after a meaningful fall
 *   capture   a red screen-edge pulse and an expanding ring where she was caught
 *   complete  a gold sparkle burst and ring at the exit, and a soft gold glow at the screen edge
 *   danger    a red screen-edge tint that the scene keeps set while a Hunter is alerted or chasing
 *
 * Cost: two particle emitters that sit idle (no live particles = nothing to do), two screen-edge
 * images that are hidden whenever their alpha is zero, and a few self-destroying rings. `update()`
 * returns immediately when nothing is showing, so an idle game runs no effect work.
 * `clear()` removes every effect at once (restart), and `destroy()` releases everything.
 *
 * With reduced motion the bursts, dust and rings are skipped and the screen-edge tints stay (they
 * fade in place, they do not move); the scene skips the camera shake the same way.
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";

/** Above the mid rain layer (500) and the exit / Hunter markers (550), below the foreground rain (600) and the HUD (1000). */
const FX_DEPTH = 555;
/** Over everything in the world, under the HUD. */
const EDGE_DEPTH = 800;

const GOLD = 0xffd23f;
const RED = 0xff4a2a;

/** Screen-edge alpha follows its target this fast (per second): quickly up, slowly down. */
const EDGE_RISE_PER_S = 6;
const EDGE_FALL_PER_S = 2.4;
/** A one-shot pulse (capture / complete) lasts this long, ms. */
const CAPTURE_PULSE_MS = 650;
const COMPLETE_GLOW_MS = 1000;
/** Below this an edge tint counts as gone. */
const EDGE_HIDDEN_BELOW = 0.01;

export interface FeedbackView {
  width: number;
  height: number;
  /** The camera zoom (window height / design height). */
  zoom: number;
}

export interface FeedbackEffects {
  /** An item was collected at (x, y). */
  pickup(x: number, y: number): void;
  /** Rara took off with her feet at (x, feetY). */
  jump(x: number, feetY: number): void;
  /** Rara landed with her feet at (x, feetY); `strength` is 0..1 (see lib/feedback/landing.ts). */
  land(x: number, feetY: number, strength: number): void;
  /** Rara was caught at (x, y). */
  capture(x: number, y: number): void;
  /** The level was completed at the exit at (x, y). */
  complete(x: number, y: number): void;
  /** The red edge tint the danger cue should show, 0 (none) .. 1 (full). Set it every frame; it eases toward it. */
  setDanger(alpha: number): void;
  layout(view: FeedbackView): void;
  /** Once per frame. Free when nothing is showing. */
  update(deltaMs: number): void;
  /** Remove every effect right now (a restart). */
  clear(): void;
  destroy(): void;
  /** How many effect pieces are alive: particles, rings and visible edge tints. 0 = the game is visually at rest. */
  readonly activeCount: number;
  /** The red screen-edge tint currently drawn (danger or capture), 0..1. */
  readonly edgeAlpha: number;
  /** The gold screen-edge glow currently drawn (level complete), 0..1. */
  readonly glowAlpha: number;
}

/** A soft round dot in one colour, drawn once onto a small canvas texture (no image files). */
function createDotTexture(scene: Phaser.Scene, key: string, size: number, rgb: string) {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, size, size);
  if (!texture) return;
  const c = texture.getContext();
  const gradient = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${rgb}, 1)`);
  gradient.addColorStop(0.45, `rgba(${rgb}, 0.7)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  c.fillStyle = gradient;
  c.fillRect(0, 0, size, size);
  texture.refresh();
}

/** A screen-edge vignette: clear in the middle, tinted toward the borders. */
function createEdgeTexture(scene: Phaser.Scene, key: string, rgb: string) {
  if (scene.textures.exists(key)) return;
  const size = 256;
  const texture = scene.textures.createCanvas(key, size, size);
  if (!texture) return;
  const c = texture.getContext();
  const gradient = c.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.72);
  gradient.addColorStop(0, `rgba(${rgb}, 0)`);
  gradient.addColorStop(0.55, `rgba(${rgb}, 0.28)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0.95)`);
  c.fillStyle = gradient;
  c.fillRect(0, 0, size, size);
  texture.refresh();
}

export function createFeedbackEffects(scene: Phaser.Scene, isReducedMotion: () => boolean): FeedbackEffects {
  createDotTexture(scene, "fx-dust", 24, "232, 224, 200");
  createDotTexture(scene, "fx-spark", 16, "255, 210, 63");
  createEdgeTexture(scene, "fx-edge-red", "255, 58, 32");
  createEdgeTexture(scene, "fx-edge-gold", "255, 214, 90");

  const dust = scene.add
    .particles(0, 0, "fx-dust", {
      emitting: false,
      lifespan: { min: 280, max: 480 },
      speedX: { min: -130, max: 130 },
      speedY: { min: -80, max: -15 },
      gravityY: 150,
      scale: { start: 0.75, end: 0.1 },
      alpha: { start: 0.75, end: 0 },
      maxAliveParticles: 40,
    })
    .setDepth(FX_DEPTH);
  const sparks = scene.add
    .particles(0, 0, "fx-spark", {
      emitting: false,
      lifespan: { min: 320, max: 560 },
      speed: { min: 60, max: 170 },
      angle: { min: 0, max: 360 },
      gravityY: 70,
      scale: { start: 0.6, end: 0 },
      alpha: { start: 1, end: 0 },
      maxAliveParticles: 48,
    })
    .setDepth(FX_DEPTH);

  const edgeRed = scene.add.image(0, 0, "fx-edge-red").setScrollFactor(0).setDepth(EDGE_DEPTH).setVisible(false).setAlpha(0);
  const edgeGold = scene.add.image(0, 0, "fx-edge-gold").setScrollFactor(0).setDepth(EDGE_DEPTH).setVisible(false).setAlpha(0);

  const rings = new Set<Phaser.GameObjects.Graphics>();
  let dangerTarget = 0;
  let dangerAlpha = 0;
  /** Remaining strength of the one-shot capture pulse / completion glow, 1 -> 0. */
  let capturePulse = 0;
  let glowPulse = 0;
  let redShown = 0;
  let goldShown = 0;
  let destroyed = false;

  const ring = (x: number, y: number, color: number, fromRadius: number, toScale: number, durationMs: number) => {
    const g = scene.add.graphics().setPosition(x, y).setDepth(FX_DEPTH);
    g.lineStyle(3, color, 0.9).strokeCircle(0, 0, fromRadius);
    rings.add(g);
    scene.tweens.add({
      targets: g,
      scale: toScale,
      alpha: 0,
      duration: durationMs,
      ease: "Quad.easeOut",
      onComplete: () => {
        rings.delete(g);
        g.destroy();
      },
    });
  };

  const applyEdge = (image: Phaser.GameObjects.Image, alpha: number) => {
    const shown = alpha >= EDGE_HIDDEN_BELOW;
    image.setAlpha(shown ? Math.min(1, alpha) : 0).setVisible(shown);
  };

  return {
    pickup(x, y) {
      if (destroyed || isReducedMotion()) return;
      sparks.explode(8, x, y);
    },
    jump(x, feetY) {
      if (destroyed || isReducedMotion()) return;
      dust.explode(5, x, feetY - 4);
    },
    land(x, feetY, strength) {
      if (destroyed || isReducedMotion() || strength <= 0) return;
      dust.explode(Math.round(5 + 9 * strength), x, feetY - 4);
    },
    capture(x, y) {
      if (destroyed) return;
      capturePulse = 1;
      if (!isReducedMotion()) ring(x, y, RED, 18, 4.5, 420);
    },
    complete(x, y) {
      if (destroyed) return;
      glowPulse = 1;
      if (isReducedMotion()) return;
      sparks.explode(22, x, y);
      ring(x, y, GOLD, 14, 6, 600);
    },
    setDanger(alpha) {
      dangerTarget = Math.max(0, Math.min(1, alpha));
    },
    layout({ width, height, zoom }) {
      // A scroll-factor-0 object is centred on the window and drawn at `zoom`, so it covers the window when it is 1/zoom of its size.
      for (const image of [edgeRed, edgeGold]) image.setPosition(width / 2, height / 2).setDisplaySize((width / zoom) * 1.04, (height / zoom) * 1.04);
    },
    update(deltaMs) {
      if (destroyed) return;
      const idle = dangerTarget === 0 && dangerAlpha === 0 && capturePulse === 0 && glowPulse === 0;
      if (idle) return;
      const dt = Math.min(deltaMs, 100) / 1000;
      dangerAlpha = dangerAlpha < dangerTarget ? Math.min(dangerTarget, dangerAlpha + EDGE_RISE_PER_S * dt) : Math.max(dangerTarget, dangerAlpha - EDGE_FALL_PER_S * dt);
      if (dangerAlpha < EDGE_HIDDEN_BELOW && dangerTarget === 0) dangerAlpha = 0;
      capturePulse = Math.max(0, capturePulse - (dt * 1000) / CAPTURE_PULSE_MS);
      glowPulse = Math.max(0, glowPulse - (dt * 1000) / COMPLETE_GLOW_MS);
      redShown = Math.max(dangerAlpha, capturePulse * 0.85);
      goldShown = glowPulse * 0.6;
      applyEdge(edgeRed, redShown);
      applyEdge(edgeGold, goldShown);
    },
    clear() {
      dust.killAll();
      sparks.killAll();
      for (const g of rings) {
        scene.tweens.killTweensOf(g);
        g.destroy();
      }
      rings.clear();
      dangerTarget = 0;
      dangerAlpha = 0;
      capturePulse = 0;
      glowPulse = 0;
      redShown = 0;
      goldShown = 0;
      applyEdge(edgeRed, 0);
      applyEdge(edgeGold, 0);
    },
    destroy() {
      if (destroyed) return;
      for (const g of rings) {
        scene.tweens.killTweensOf(g);
        g.destroy();
      }
      rings.clear();
      destroyed = true;
      dust.destroy();
      sparks.destroy();
      edgeRed.destroy();
      edgeGold.destroy();
    },
    get activeCount() {
      if (destroyed) return 0;
      return dust.getAliveParticleCount() + sparks.getAliveParticleCount() + rings.size + (redShown >= EDGE_HIDDEN_BELOW ? 1 : 0) + (goldShown >= EDGE_HIDDEN_BELOW ? 1 : 0);
    },
    get edgeAlpha() {
      return destroyed ? 0 : redShown;
    },
    get glowAlpha() {
      return destroyed ? 0 : goldShown;
    },
  };
}
