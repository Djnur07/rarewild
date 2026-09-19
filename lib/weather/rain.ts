/**
 * Tropical rain: three lightweight Phaser particle emitters, no image assets.
 *
 *   background  faint, small, slow      - created right after the environment so it is
 *                                         drawn behind the character (same default depth,
 *                                         creation order decides)
 *   midground   a little brighter       - depth 500, in front of the character but faint
 *   foreground  rare, larger, softer    - depth 600
 *
 * All three stay below the game's HUD (depth 1000); the React overlays (drawer,
 * music control) are DOM elements above the whole canvas.
 *
 * The rain lives in screen space (scroll factor 0), so it always covers the
 * visible viewport however the camera scrolls, zooms or the window is resized.
 * `resize()` is handed the visible rectangle in camera-local coordinates and
 * reshapes each layer's spawn strip, lifespan and rate to match; nothing is
 * created or destroyed on resize.
 *
 * Streaks are drawn once onto tiny canvas textures (soft, muted blue-green,
 * never pure white) and leaned along the wind direction with the particle
 * rotation; length, opacity, speed and spawn position vary per particle.
 * Total live particles stay around 170 on a laptop-sized window.
 *
 * Honors prefers-reduced-motion by not raining at all (and reacts if the
 * preference changes while the game is open).
 *
 * `Phaser` isn't imported at module scope (see RaraCharacter.ts): the loaded
 * namespace is passed in, so this file is SSR-safe.
 */

import type Phaser from "phaser";

/** The visible area in camera-local coordinates (what a scroll-factor-0 object sees). */
export type RainView = { left: number; top: number; width: number; height: number };

export type RainEffect = {
  resize(view: RainView): void;
  destroy(): void;
};

type RainLayerSpec = {
  textureKey: string;
  /** null = keep the default depth so creation order places it behind the character. */
  depth: number | null;
  texture: { width: number; height: number; lineWidth: number; color: string; peakAlpha: number; softEdges: number };
  /** How far the rain leans from vertical, in degrees (falls toward the lower left). */
  leanDegrees: number;
  /** Fall speed range in pixels per second (camera-local units). */
  speed: { min: number; max: number };
  /** Multiplier on the texture's length. */
  length: { min: number; max: number };
  alpha: { min: number; max: number };
  /** Droplets spawned per second for every 800 px of visible width. */
  ratePer800px: number;
  /** Gentle sideways drift/gusting, px/s^2 (0 = none). */
  sway: number;
};

const LAYERS: RainLayerSpec[] = [
  {
    textureKey: "rain-streak-far",
    depth: null,
    texture: { width: 4, height: 28, lineWidth: 1, color: "#8fa9a2", peakAlpha: 0.9, softEdges: 1 },
    leanDegrees: 14,
    speed: { min: 380, max: 520 },
    length: { min: 0.7, max: 1.4 },
    alpha: { min: 0.1, max: 0.22 },
    ratePer800px: 55,
    sway: 0,
  },
  {
    textureKey: "rain-streak-mid",
    depth: 500,
    texture: { width: 4, height: 42, lineWidth: 1.4, color: "#a8c0b9", peakAlpha: 0.95, softEdges: 1 },
    leanDegrees: 15,
    speed: { min: 560, max: 760 },
    length: { min: 0.8, max: 1.5 },
    alpha: { min: 0.14, max: 0.3 },
    ratePer800px: 28,
    sway: 0,
  },
  {
    textureKey: "rain-streak-near",
    depth: 600,
    texture: { width: 10, height: 72, lineWidth: 3, color: "#b7cec8", peakAlpha: 0.8, softEdges: 3 },
    leanDegrees: 17,
    speed: { min: 760, max: 980 },
    length: { min: 0.9, max: 1.8 },
    alpha: { min: 0.06, max: 0.15 },
    ratePer800px: 3.5,
    sway: 60,
  },
];

/** Windows narrower than this (in camera-local px) rain as if they were this wide. */
const MIN_RATE_WIDTH = 640;

/** Extra distance above/below the viewport so drops enter and leave off-screen. */
const EDGE_MARGIN = 80;

/** Draw one soft streak: transparent tail fading up to the brightest point at the head (bottom). */
function createStreakTexture(scene: Phaser.Scene, spec: RainLayerSpec) {
  const { textureKey, texture } = spec;
  if (scene.textures.exists(textureKey)) return;
  const canvasTexture = scene.textures.createCanvas(textureKey, texture.width, texture.height);
  if (!canvasTexture) return;
  const context = canvasTexture.getContext();
  const gradient = context.createLinearGradient(0, 0, 0, texture.height);
  const rgb = texture.color;
  const withAlpha = (a: number) => {
    const value = Number.parseInt(rgb.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${a})`;
  };
  gradient.addColorStop(0, withAlpha(0));
  gradient.addColorStop(0.65, withAlpha(texture.peakAlpha * 0.5));
  gradient.addColorStop(0.95, withAlpha(texture.peakAlpha));
  gradient.addColorStop(1, withAlpha(texture.peakAlpha * 0.5));
  context.fillStyle = gradient;
  // Wider, fainter passes first, the crisp core last: a soft edge without ctx.filter (unsupported in Safari).
  for (let pass = texture.softEdges; pass >= 1; pass--) {
    const width = texture.lineWidth + (pass - 1) * 1.6;
    context.globalAlpha = pass === 1 ? 1 : 0.35 / pass;
    context.fillRect((texture.width - width) / 2, 0, width, texture.height);
  }
  canvasTexture.refresh();
}

export function createRainEffect(PhaserNS: typeof Phaser, scene: Phaser.Scene): RainEffect {
  type Layer = {
    spec: RainLayerSpec;
    emitter: Phaser.GameObjects.Particles.ParticleEmitter;
    zone: Phaser.Geom.Rectangle;
    lifespanMs: number;
    running: boolean;
  };

  const layers: Layer[] = LAYERS.map((spec) => {
    createStreakTexture(scene, spec);
    const zone = new PhaserNS.Geom.Rectangle(0, 0, 1, 1);
    const lean = spec.leanDegrees;
    const slope = Math.tan(PhaserNS.Math.DegToRad(lean));
    const emitter = scene.add
      .particles(0, 0, spec.textureKey, {
        emitting: false,
        // Positions come from the spawn strip, which resize() reshapes to the viewport.
        emitZone: {
          type: "random",
          source: {
            getRandomPoint: (point) => {
              point.x = zone.x + Math.random() * zone.width;
              point.y = zone.y + Math.random() * zone.height;
            },
          },
        },
        speedY: { min: spec.speed.min, max: spec.speed.max },
        // Falls toward the lower left, in step with how far the streak is leaned.
        speedX: { min: -slope * spec.speed.max, max: -slope * spec.speed.min },
        accelerationX: spec.sway > 0 ? { min: -spec.sway, max: spec.sway } : 0,
        rotate: { min: lean - 2, max: lean + 2 },
        scaleY: { min: spec.length.min, max: spec.length.max },
        alpha: { min: spec.alpha.min, max: spec.alpha.max },
        lifespan: 1000,
        frequency: 100,
        quantity: 1,
      })
      .setScrollFactor(0);
    if (spec.depth !== null) emitter.setDepth(spec.depth);
    return { spec, emitter, zone, lifespanMs: 1000, running: false };
  });

  let view: RainView | null = null;
  let destroyed = false;

  const motionQuery: MediaQueryList | null =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  let enabled = !(motionQuery?.matches ?? false);

  /** Start or stop each layer to match `enabled`; a fresh start is pre-warmed so rain is already falling. */
  const sync = () => {
    if (destroyed || !view) return;
    for (const layer of layers) {
      if (enabled && !layer.running) {
        layer.emitter.setVisible(true).start(layer.lifespanMs);
        layer.running = true;
      } else if (!enabled && layer.running) {
        layer.emitter.stop(true);
        layer.emitter.setVisible(false);
        layer.running = false;
      }
    }
  };

  const onMotionPreferenceChange = () => {
    enabled = !(motionQuery?.matches ?? false);
    sync();
  };
  motionQuery?.addEventListener?.("change", onMotionPreferenceChange);

  return {
    resize(next) {
      if (destroyed) return;
      view = next;
      const travel = next.height + EDGE_MARGIN * 2;
      for (const layer of layers) {
        const { spec, emitter, zone } = layer;
        // Drops drift toward the left as they fall, so spawn extra to the right to still cover the whole width.
        const drift = Math.tan(PhaserNS.Math.DegToRad(spec.leanDegrees)) * travel;
        zone.setTo(next.left, next.top - EDGE_MARGIN, next.width + drift + 40, EDGE_MARGIN);
        // Long enough for the slowest drop to cross the whole viewport.
        layer.lifespanMs = (travel / spec.speed.min) * 1000;
        // Rate follows the visible width, but never drops below a floor so phone-sized windows still get real rain.
        const rate = Math.max(1, (spec.ratePer800px * Math.max(next.width, MIN_RATE_WIDTH)) / 800);
        emitter.setParticleLifespan(layer.lifespanMs);
        emitter.setFrequency(1000 / rate, 1);
        emitter.maxAliveParticles = Math.ceil(((rate * layer.lifespanMs) / 1000) * 1.5) + 4;
      }
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      motionQuery?.removeEventListener?.("change", onMotionPreferenceChange);
      for (const layer of layers) layer.emitter.destroy();
      layers.length = 0;
    },
  };
}
