/**
 * Phone-only sizes and positions for the on-screen controls and HUD text. Pure maths, no Phaser, so
 * scripts/mobile/validate-mobile.ts can check it in plain Node. The scene calls it only when
 * `isTouchPhone()` is true; desktop never runs any of this.
 *
 * The controls keep the order the game already has (left, right, swing, jump), each pair keeping its own
 * exact spacing, and are drawn LARGER, as two groups scaled uniformly so the proportions do not change.
 * In portrait they sit together as one row, centred on the screen with equal margins on both sides,
 * instead of where its 800-wide design position happens to fall (which is right of centre). In landscape
 * they split: [left, right] toward the left edge, [swing, jump] toward the right edge, with a wide gap
 * between them and a small lift upward, since there is width to spare there for two-thumb play.
 *
 * Units: "design" px are the HUD's 800x600 design frame; "screen" px are CSS pixels of the window.
 */

import { WORLD_HEIGHT } from "../level/constants.ts";

/** How much larger the HUD lines under the title (subtitle, counter, timer, exit state) are drawn on a phone. */
export const MOBILE_HUD_TEXT_BOOST = 1.25;

/**
 * The share of the usual camera zoom a phone keeps. The camera normally zooms so the 600px-tall world fills the window
 * height; at 1 a phone's camera matches that exactly (noticeably closer in than the earlier, more zoomed-out tunings this
 * value has held), framing precisely the world's own height with nothing extra. Everything drawn in screen space (the HUD,
 * the buttons, the overlays) is scaled back up by the same amount, so it keeps exactly the size and place it has. The world
 * itself, its physics and every speed are untouched: this is only how much of it the camera frames.
 */
export const MOBILE_CAMERA_ZOOM_FACTOR = 1;

/**
 * With the lower zoom the camera frames more height than the 600px-tall world has (600 / 1 = 600px), so it shows up to 0px
 * BELOW the bottom of the world (the camera keeps the top of the world at the top of the screen, so the extra is only ever at
 * the bottom). On a phone the environment carries its ground art on this far below the world's bottom edge (see `extendBelow`
 * in lib/environment), so that space is more ground, not empty. It is derived from the camera factor (plus 20px to spare) so a
 * change to the zoom can never leave the extension short. Decoration only: no physics, no world change.
 */
export const MOBILE_WORLD_EXTENSION = Math.ceil(WORLD_HEIGHT / MOBILE_CAMERA_ZOOM_FACTOR - WORLD_HEIGHT) + 20;

export interface CameraSetup {
  /** The zoom every screen-space layout was designed against: the window height over the design height. */
  uiZoom: number;
  /** The camera's actual zoom: `uiZoom` everywhere except on a phone. */
  zoom: number;
  /** Multiply the position offsets and the scale of every screen-space object by this, so it keeps its on-screen size at `zoom`. Exactly 1 off a phone. */
  compensate: number;
}

export function layoutCamera(view: { height: number }, designHeight: number, phone: boolean): CameraSetup {
  const uiZoom = view.height / designHeight;
  if (!phone) return { uiZoom, zoom: uiZoom, compensate: 1 };
  const zoom = uiZoom * MOBILE_CAMERA_ZOOM_FACTOR;
  return { uiZoom, zoom, compensate: uiZoom / zoom };
}

/** A phone-sized touch target: the on-screen buttons answer touches over at least this height (CSS px). */
export const MIN_TOUCH_TARGET_PX = 48;

/** In landscape, how much higher the two button groups sit than the single centred row would, screen px (see `layoutTouchControls`). */
export const LANDSCAPE_LIFT = 14;

/**
 * The volume control's footprint in the bottom-right corner on a phone: its size plus its 12px offset from
 * the edges, CSS px. It has two sizes (see the touch classes in components/MusicControl.tsx): the normal
 * phone size (a 36px button, a 96px slider, 8px gaps and padding) and a compact one on short landscape
 * screens (max-height 450px: a 28px button and an 80px slider) so it takes less of the little height there.
 * The controls are kept clear of it (see `layoutTouchControls`).
 */
export const COMPACT_SCREEN_HEIGHT = 450;
export function musicControlFootprint(screenHeight: number): { width: number; height: number } {
  return screenHeight <= COMPACT_SCREEN_HEIGHT ? { width: 148, height: 48 } : { width: 170, height: 60 };
}
/** Least space kept between the control group and that footprint, CSS px. */
const OVERLAY_GAP = 8;

export interface DesignButton {
  id: string;
  /** Centre, design px. */
  x: number;
  y: number;
  /** Unscaled size, design px. */
  width: number;
  height: number;
}

export interface ControlPlacement {
  id: string;
  /** Where the button's centre goes, screen px. */
  screenX: number;
  screenY: number;
  /** Screen px per design px: how large the button is drawn. */
  scale: number;
  /** Extra height the button answers touches over, above and below it, design px (0 when it is already tall enough). */
  hitPadY: number;
}

export interface ControlView {
  width: number;
  height: number;
  /** The camera zoom: screen px per world px, which is also how the design frame's vertical positions map. */
  zoom: number;
  /** Height of the design frame, design px. */
  designHeight: number;
  /** Design y of the ground surface, where Rara stands: the buttons stay below it, so they never cover her. */
  groundDesignY: number;
}

/** Side margin each end of the control group keeps from the screen edge, screen px. */
export function controlSideMargin(width: number): number {
  return Math.max(14, 0.06 * width);
}

/**
 * The shared sizing every arrangement starts from: how large the buttons are drawn (`scale`), the one shared height they sit
 * at as a single row (`rowCentre`, already kept clear of the ground line and, where it fits, of the volume control), the
 * margin that sizing used, and the design frame's own horizontal centre (`centre`). `layoutTouchControls` builds both the
 * portrait row and the landscape groups on top of this; it is exported so a caller can also ask "where would a plain single
 * row sit at this size" (see scripts/browser's landscape-lift check) without duplicating this maths.
 */
export function singleRowLayout(view: ControlView, buttons: readonly DesignButton[]): { scale: number; rowCentre: number; margin: number; centre: number } {
  const left = Math.min(...buttons.map((b) => b.x - b.width / 2));
  const right = Math.max(...buttons.map((b) => b.x + b.width / 2));
  const centre = (left + right) / 2;
  const tallest = Math.max(...buttons.map((b) => b.height));
  const designRowY = (b: DesignButton) => view.height / 2 + (b.y - view.designHeight / 2) * view.zoom;
  // The buttons live in the strip of ground under the play line, so they never cover Rara or what she is about to reach.
  const stripTop = view.height / 2 + (view.groundDesignY - view.designHeight / 2) * view.zoom + 2;
  const stripBottom = view.height - Math.max(14, 0.03 * view.height);
  const footprint = musicControlFootprint(view.height);
  const overlayTop = view.height - footprint.height - OVERLAY_GAP;

  // Large, but bounded three ways: the group must fit between the side margins, no button is taller than a comfortable thumb
  // target, and the buttons must fit in the strip under the play line.
  const sizeFor = (sideMargin: number) => {
    const fitWidth = (view.width - 2 * sideMargin) / (right - left);
    const maxButtonPx = Math.min(96, Math.max(44, 0.16 * view.height));
    const scale = Math.min(fitWidth, maxButtonPx / tallest, (stripBottom - stripTop) / tallest);
    // The row stays where the design puts it, moved only as far as it takes to sit inside the strip.
    const halfHeight = (tallest * scale) / 2;
    const rowCentre = Math.min(stripBottom - halfHeight, Math.max(stripTop + halfHeight, designRowY(buttons[0])));
    return { scale, rowCentre, bottom: rowCentre + halfHeight };
  };

  let margin = controlSideMargin(view.width);
  let size = sizeFor(margin);
  if (size.bottom > overlayTop) {
    // The row reaches down beside the volume control in the bottom-right corner. First try sliding the row up, inside the ground
    // strip, until it clears that control (a pixel or two on a tall phone). If the strip is too shallow for that (a short
    // landscape screen), keep the row where it is and give BOTH ends of the group the same, larger margin instead, so the group
    // stays symmetric and clear of the control, provided that does not shrink the buttons drastically.
    const half = (tallest * size.scale) / 2;
    if (overlayTop - half >= stripTop + half) {
      size = { ...size, rowCentre: overlayTop - half, bottom: overlayTop };
    } else {
      const narrowerMargin = Math.max(controlSideMargin(view.width), footprint.width + OVERLAY_GAP);
      const narrower = sizeFor(narrowerMargin);
      if (narrower.scale >= 0.6 * size.scale) {
        size = narrower;
        margin = narrowerMargin;
      }
    }
  }
  return { scale: size.scale, rowCentre: size.rowCentre, margin, centre };
}

export function layoutTouchControls(view: ControlView, buttons: readonly DesignButton[]): ControlPlacement[] {
  const { scale, rowCentre, margin, centre } = singleRowLayout(view, buttons);

  // LANDSCAPE ONLY: two groups — [LEFT, RIGHT] toward the left edge, [SWING, JUMP] toward the right edge, with a big gap
  // between them, both a little higher than the single centred row above. Portrait (and anything not wider than it is tall)
  // keeps that centred row exactly as it always has — "landscape" here is simply a wider-than-tall view, the same test the
  // rest of the mobile layout already uses for orientation (the camera zoom, for instance, depends only on height).
  const landscape = view.width > view.height && buttons.length === 4;
  if (!landscape) {
    return buttons.map((b) => ({
      id: b.id,
      screenX: view.width / 2 + (b.x - centre) * scale,
      screenY: rowCentre + (b.y - buttons[0].y) * scale,
      scale,
      hitPadY: Math.max(0, (MIN_TOUCH_TARGET_PX / scale - b.height) / 2),
    }));
  }

  const tallest = Math.max(...buttons.map((b) => b.height));
  const stripTop = view.height / 2 + (view.groundDesignY - view.designHeight / 2) * view.zoom + 2;
  const footprint = musicControlFootprint(view.height);
  const overlayTop = view.height - footprint.height - OVERLAY_GAP;
  const halfHeight = (tallest * scale) / 2;
  const liftedY = Math.max(stripTop + halfHeight, rowCentre - LANDSCAPE_LIFT);
  // Each group gets its OWN margin, not the (possibly larger) `margin` the single-group sizing above may have picked: the left
  // group is never near the volume control, so it always uses the small standard margin, leaving as much of the freed-up width
  // as possible for the gap between the groups. SWING/JUMP sit closer still — half that margin (still a comfortable, floored
  // minimum) — UNLESS, at its lifted height, the group would still reach down beside the volume control, in which case it
  // gets that control's own width of clearance instead (never both margins large at once just because the single centred row
  // once needed it for a different reason).
  const smallMargin = controlSideMargin(view.width);
  const rightBaseMargin = Math.max(8, 0.03 * view.width);
  const rightMargin = liftedY + halfHeight <= overlayTop ? rightBaseMargin : Math.max(rightBaseMargin, footprint.width + OVERLAY_GAP);

  const groupBounds = (subset: readonly DesignButton[]) => ({
    left: Math.min(...subset.map((b) => b.x - b.width / 2)),
    right: Math.max(...subset.map((b) => b.x + b.width / 2)),
  });
  const leftGroup = groupBounds(buttons.slice(0, 2)); // [LEFT, RIGHT]
  const rightGroup = groupBounds(buttons.slice(2)); // [SWING, JUMP]
  // Never let the two groups run into each other: if the standard margins would (an extreme, very narrow screen), fall back
  // to the single centred row's own margin on both sides instead, which `scale` is already guaranteed to fit within.
  const leftWidth = (leftGroup.right - leftGroup.left) * scale;
  const rightWidth = (rightGroup.right - rightGroup.left) * scale;
  const fitsSplit = smallMargin + rightMargin + leftWidth + rightWidth <= view.width;
  const leftMargin = fitsSplit ? smallMargin : margin;
  const finalRightMargin = fitsSplit ? rightMargin : margin;

  return buttons.map((b, i) => ({
    id: b.id,
    screenX:
      i < 2
        ? leftMargin + (b.x - leftGroup.left) * scale // anchored to the left edge; the pair's own spacing (design px) is kept exactly
        : view.width - finalRightMargin - (rightGroup.right - b.x) * scale, // anchored to the right edge, the same way
    screenY: liftedY + (b.y - buttons[0].y) * scale,
    scale,
    hitPadY: Math.max(0, (MIN_TOUCH_TARGET_PX / scale - b.height) / 2),
  }));
}
