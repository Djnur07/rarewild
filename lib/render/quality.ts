/**
 * Phone rendering quality: how many canvas pixels to render per CSS pixel, and how much extra detail the textures
 * that feed that canvas need. Pure maths and one small piece of shared state, so scripts/render can check it in Node.
 *
 * WHY: the canvas used to be created at its CSS size, so on a phone with a devicePixelRatio of 3 the browser stretched
 * a 390x844 picture over 1170x2532 physical pixels: every edge, every letter and every sprite was drawn 3x too coarse
 * and then blurred by the stretch. Rendering at the physical resolution fixes the canvas; it also means the camera is
 * showing world art at 3x the magnification, so art that is rasterised once at 1x (the SVG environment, the small
 * canvas textures, text drawn at resolution 1 or 2) has to be produced at a matching resolution or it just moves the
 * softness from the browser into the texture.
 *
 * Desktop is untouched: `renderScaleFor` returns exactly 1 unless the device is a phone, and every consumer treats 1
 * as "do what the game always did".
 */

import { MOBILE_CAMERA_ZOOM_FACTOR } from "../mobile/layout.ts";

/** Never render more than this many canvas pixels per CSS pixel: 3 is the densest phone screens (iPhones), and beyond it the gain is invisible. */
export const MAX_RENDER_SCALE = 3;
/** ...and never render a canvas of more than this many pixels in total (a 3.6M-pixel iPhone Pro Max fits; a large tablet is scaled down to fit). */
export const MAX_RENDER_PIXELS = 4_200_000;
/** The tallest world art the phone renders is rasterised at up to this many times its 1x size (the widest sky layer is 1067px, so 3x stays under the 4096px texture limit of older GPUs). */
export const MAX_TEXTURE_SCALE = 3;
/** The largest text render resolution used on a phone (desktop keeps its own, lower cap). */
export const MAX_PHONE_TEXT_RESOLUTION = 6;

/**
 * Canvas pixels per CSS pixel for a device. 1 for anything that is not a phone (desktop keeps exactly what it had);
 * for a phone the device pixel ratio, capped by MAX_RENDER_SCALE and by the pixel budget.
 */
export function renderScaleFor(cssWidth: number, cssHeight: number, devicePixelRatio: number, phone: boolean): number {
  if (!phone) return 1;
  let scale = Math.min(Math.max(devicePixelRatio, 1), MAX_RENDER_SCALE);
  const pixels = cssWidth * cssHeight * scale * scale;
  if (pixels > MAX_RENDER_PIXELS) scale = Math.max(1, Math.sqrt(MAX_RENDER_PIXELS / (cssWidth * cssHeight)));
  return scale;
}

/** The canvas size in pixels for a CSS box: whole pixels, and the CSS size is then `pixels / scale` so one canvas pixel is exactly one device pixel. */
export function canvasSizeFor(cssWidth: number, cssHeight: number, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(cssWidth * scale)), height: Math.max(1, Math.round(cssHeight * scale)) };
}

/**
 * How many times bigger than 1x the world art (the SVG environment) is rasterised on a phone. It follows the largest
 * camera zoom the device will use (its longer side, in either orientation), measured in canvas pixels per world pixel,
 * rounded, and capped at MAX_TEXTURE_SCALE. 1 off a phone.
 */
export function environmentTextureScale(cssWidth: number, cssHeight: number, renderScale: number, phone: boolean): number {
  if (!phone) return 1;
  const largestZoom = (Math.max(cssWidth, cssHeight) / 600) * MOBILE_CAMERA_ZOOM_FACTOR * renderScale;
  return Math.min(MAX_TEXTURE_SCALE, Math.max(1, Math.round(largestZoom)));
}

/**
 * The resolution to draw a piece of text that lives IN the world (a floating "+1", the exit label, the Hunter's "!") at,
 * so it is at least as detailed as the camera shows it. `base` is what the game always used (desktop keeps it).
 * On a phone it rises to the largest camera zoom in canvas pixels per world pixel, rounded up.
 */
export function worldTextResolution(base: number, canvasWidth: number, canvasHeight: number): number {
  if (activeRenderScale <= 1) return base;
  const largestZoom = (Math.max(canvasWidth, canvasHeight) / 600) * MOBILE_CAMERA_ZOOM_FACTOR;
  return Math.min(MAX_PHONE_TEXT_RESOLUTION, Math.max(base, Math.ceil(largestZoom)));
}

// --- the scale in force for this page (set once by the game when it starts; 1 unless it is a phone) --------------------------------------
let activeRenderScale = 1;
export function setActiveRenderScale(scale: number) {
  activeRenderScale = scale;
}
export function getActiveRenderScale(): number {
  return activeRenderScale;
}
