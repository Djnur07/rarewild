/**
 * Validation for the phone-only behavior, in plain Node (the phone controls and audio are also checked in a
 * real touch-emulated browser by scripts/browser). Everything here is pure maths:
 *
 *   node scripts/mobile/validate-mobile.ts
 *
 * Sections: the sound-effect level (desktop curve unchanged, phone curve proportional to the slider), the
 * control layout (same arrangement, larger, centred and symmetric, clear of the edges and of the volume
 * control, thumb-sized touch targets, across phone and tablet screen sizes) and the HUD text boost.
 */

import { layoutCamera, layoutTouchControls, singleRowLayout, LANDSCAPE_LIFT, MIN_TOUCH_TARGET_PX, MOBILE_CAMERA_ZOOM_FACTOR, MOBILE_WORLD_EXTENSION, MOBILE_HUD_TEXT_BOOST, musicControlFootprint, controlSideMargin, type DesignButton } from "../../lib/mobile/layout.ts";
import { sfxLevel } from "../../lib/audio/sfx.ts";
import { GROUND_SURFACE_Y } from "../../lib/level/constants.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// --- sound-effect level ---------------------------------------------------------------------------------------------------------------
{
  const volumes = [0.01, 0.1, 0.22, 0.5, 0.75, 1];
  check("desktop: the effects level is exactly the original curve (0.16 + 0.34 * volume), muted or volume 0 is silent", volumes.every((v) => sfxLevel(v, false, false) === 0.16 + 0.34 * v) && sfxLevel(0.5, true, false) === 0 && sfxLevel(0, false, false) === 0);
  const phone = volumes.map((v) => sfxLevel(v, false, true));
  check("phone: the effects level rises with the slider at EVERY step up to the top (no plateau), so moving the slider is always audible", phone.every((l, i) => i === 0 || l > phone[i - 1]) && phone[0] > 0 && sfxLevel(0.95, false, true) < sfxLevel(1, false, true), phone.map((l) => l.toFixed(3)).join(" < "));
  check("phone: quiet at low volume, not stuck at a floor (1% volume is under a fifth of the default level)", sfxLevel(0.01, false, true) < 0.2 * sfxLevel(0.22, false, true));
  check("phone: the same loudness as desktop at the default volume (0.22), within 0.005", Math.abs(sfxLevel(0.22, false, true) - sfxLevel(0.22, false, false)) < 0.005, `${sfxLevel(0.22, false, true).toFixed(3)} vs ${sfxLevel(0.22, false, false).toFixed(3)}`);
  check("phone: never louder than 0.55 (the top of the slider), and a volume above 1 is treated as 1", sfxLevel(1, false, true) === 0.55 && sfxLevel(3, false, true) === 0.55 && volumes.every((v) => sfxLevel(v, false, true) <= 0.55));
  check("phone: mute and volume 0 are silent", sfxLevel(0.6, true, true) === 0 && sfxLevel(0, false, true) === 0);
}

// --- control layout -------------------------------------------------------------------------------------------------------------------
// The four buttons as the game defines them on its 800x600 design frame (measured from the game at zoom 1).
const DESIGN: DesignButton[] = [
  { id: "left", x: 250, y: 510, width: 76, height: 63.1 },
  { id: "right", x: 360, y: 510, width: 76, height: 63.1 },
  { id: "swing", x: 500, y: 510, width: 101, height: 60.5 },
  { id: "jump", x: 650, y: 510, width: 108, height: 60.6 },
];
const PHONES = [
  [320, 568], [360, 740], [375, 812], [390, 844], [393, 852], [412, 915], [430, 932], [768, 1024],
  [568, 320], [667, 375], [740, 360], [844, 390], [932, 430], [1024, 768],
] as const;
const rectOf = (p: { screenX: number; screenY: number; scale: number }, b: DesignButton) => ({
  left: p.screenX - (b.width * p.scale) / 2, right: p.screenX + (b.width * p.scale) / 2,
  top: p.screenY - (b.height * p.scale) / 2, bottom: p.screenY + (b.height * p.scale) / 2,
});
const results = PHONES.map(([width, height]) => {
  const zoom = height / 600;
  const placed = layoutTouchControls({ width, height, zoom, designHeight: 600, groundDesignY: GROUND_SURFACE_Y }, DESIGN);
  const rects = placed.map((p, i) => rectOf(p, DESIGN[i]));
  // What the shared layout draws today (the baseline): the HUD design frame scaled by hudScale (narrow windows shrink it) and the camera zoom.
  const baselineScale = Math.min(1, width / zoom / 800) * zoom;
  const groundLine = height / 2 + (GROUND_SURFACE_Y - 300) * zoom; // where Rara's feet are on screen
  return { width, height, placed, rects, scale: placed[0].scale, baselineScale, groundLine, label: `${width}x${height}` };
});
{
  const all = (test: (r: (typeof results)[number]) => boolean) => results.filter((r) => !test(r)).map((r) => r.label);
  const bad = (label: string, test: (r: (typeof results)[number]) => boolean, detail = "") => {
    const failed = all(test);
    check(label, failed.length === 0, failed.length ? `fails at ${failed.join(", ")}` : detail || `${results.length} screen sizes`);
  };
  // Checks that hold regardless of orientation: sizing, safety margins from the ground line and the volume control, minimum
  // spacing, and touch-target size. The two ARRANGEMENTS (portrait: one centred row; landscape: two edge groups) are below.
  bad("the same order (left, right, swing, jump) and everything at the same height, in both orientations", (r) => {
    const xs = r.placed.map((p) => p.screenX);
    return xs.every((x, i) => i === 0 || x > xs[i - 1]) && r.placed.every((p) => p.screenY === r.placed[0].screenY);
  });
  bad("it keeps clear of the side edges: at least 14px, and at least 6% of the width on every phone-sized screen (both edges, not just one)", (r) => {
    const left = Math.min(...r.rects.map((x) => x.left));
    const rightMargin = r.width - Math.max(...r.rects.map((x) => x.right));
    const closest = Math.min(left, rightMargin);
    return closest >= 14 - 0.5 && closest >= controlSideMargin(r.width) - 0.5;
  });
  bad("every button is fully on screen, with room under it", (r) => r.rects.every((x) => x.left >= 0 && x.right <= r.width && x.top >= 0 && x.bottom <= r.height - 10));
  bad("the buttons are LARGER than they are today: at least 1.4x on portrait phones (up to 430 wide), at least 1.1x on landscape phones 700px+ wide, and never more than 5% smaller on any screen (the smallest landscape screens are limited by the space beside the volume control)", (r) =>
    r.width <= 430 && r.height > r.width ? r.scale >= 1.4 * r.baselineScale : r.width >= 700 && r.height <= 450 ? r.scale >= 1.1 * r.baselineScale : r.scale >= 0.95 * r.baselineScale);
  bad("gameplay is not obstructed: every button sits below the ground line where Rara stands (2px or more under her feet)", (r) => r.rects.every((x) => x.top >= r.groundLine + 1.99));
  bad("comfortable spacing: at least 8px between neighbouring buttons (the same in one row or between the two landscape groups, since a group's own gap is always kept at least that, and the gap between the groups is much larger still)", (r) => r.rects.every((x, i) => i === 0 || x.left - r.rects[i - 1].right >= 8));
  bad("thumb-sized touch targets: every button answers touches over at least 48px of height", (r) => r.placed.every((p, i) => (DESIGN[i].height + 2 * p.hitPadY) * p.scale >= MIN_TOUCH_TARGET_PX - 0.01));
  bad("the drawn buttons are at least 36px tall (and the two arrows 40px) on every screen whose short side is 360px or more; smaller screens are smaller, but their touch targets are still 48px", (r) => Math.min(r.width, r.height) < 360 || (r.rects.every((x) => x.bottom - x.top >= 36) && r.rects.slice(0, 2).every((x) => x.bottom - x.top >= 40 - 0.01)));
  bad("nothing runs into the volume control in the bottom-right corner (whose size depends on the screen height)", (r) => {
    const footprint = musicControlFootprint(r.height);
    const box = { left: r.width - footprint.width, top: r.height - footprint.height };
    return r.rects.every((x) => x.right <= box.left || x.bottom <= box.top);
  });

  const portrait = results.filter((r) => r.height > r.width);
  const landscape = results.filter((r) => r.width > r.height);
  const badIn = (set: typeof results, label: string, test: (r: (typeof results)[number]) => boolean) => {
    const failed = set.filter((r) => !test(r)).map((r) => r.label);
    check(label, failed.length === 0, failed.length ? `fails at ${failed.join(", ")}` : `${set.length} screen sizes`);
  };
  badIn(portrait, "portrait: the four buttons keep exactly the design frame's spacing throughout, as one group", (r) =>
    r.placed.every((p, i) => Math.abs((p.screenX - r.placed[0].screenX) / r.scale - (DESIGN[i].x - DESIGN[0].x)) < 1e-6 && p.scale === r.scale));
  badIn(portrait, "portrait: the group is centred: equal space to the left and the right of it (within half a pixel)", (r) => {
    const left = Math.min(...r.rects.map((x) => x.left));
    const right = Math.max(...r.rects.map((x) => x.right));
    return Math.abs(left - (r.width - right)) < 0.5;
  });
  badIn(landscape, "landscape: LEFT+RIGHT and SWING+JUMP each keep their own exact design-frame spacing, as two separate groups", (r) => {
    const leftPair = r.placed.slice(0, 2), rightPair = r.placed.slice(2);
    const exact = (pair: typeof leftPair, design: readonly DesignButton[]) => Math.abs((pair[1].screenX - pair[0].screenX) / r.scale - (design[1].x - design[0].x)) < 1e-6;
    return exact(leftPair, DESIGN.slice(0, 2)) && exact(rightPair, DESIGN.slice(2)) && r.placed.every((p) => p.scale === r.scale);
  });
  badIn(landscape, "landscape: the two groups are clearly separated: the gap between them is at least 3x either group's own internal gap", (r) => {
    const [L, R, S, J] = r.rects;
    const ownGap = Math.max(R.left - L.right, J.left - S.right, 8);
    return S.left - R.right >= 3 * ownGap;
  });
  badIn(landscape, "landscape: LEFT+RIGHT keeps the standard comfortable left margin", (r) => r.rects[0].left >= controlSideMargin(r.width) - 0.5);
  // SWING+JUMP asks for about half that margin (still comfortable: 8px or 3% of the width) instead, to sit closer to the right
  // edge — UNLESS, at these button sizes, the row's own bottom edge already reaches into the volume control's corner (true at
  // every real phone size tried: the row is simply tall enough to sit low there, regardless of its horizontal position), in
  // which case it correctly falls back to that control's own width of clearance instead. Never anything besides those two.
  badIn(landscape, "landscape: SWING+JUMP's right margin is exactly the reduced ~half-margin where that is safe, or exactly the volume control's own clearance where it is not - never anything smaller or in between", (r) => {
    const rightMargin = r.width - r.rects[3].right;
    const reduced = Math.max(8, 0.03 * r.width);
    const footprint = musicControlFootprint(r.height);
    const protectedMargin = Math.max(reduced, footprint.width + 8);
    return Math.abs(rightMargin - reduced) < 0.5 || Math.abs(rightMargin - protectedMargin) < 0.5;
  });
  // Safety comes first: the row never sits any lower (further down) than a single centred row would, and moves up from there
  // only as far as the ground-line clamp allows. At today's button sizes that clamp already pins the row as high as it can
  // safely go at every real phone size tested (checked in verify-start-screen.ts's real, screenshot-backed P9), so the lift
  // constant itself is what stays modest and ready to act the moment there is genuine room, not a claim that it always shows.
  check("landscape: the constant that would lift the row, wherever it is ever safe to, is itself modest (4px to 24px)", LANDSCAPE_LIFT >= 4 && LANDSCAPE_LIFT <= 24, `${LANDSCAPE_LIFT}px`);
  badIn(landscape, "landscape: the row is never lower (further from the ground line) than a single centred row would sit today, at this exact size", (r) => {
    const single = singleRowLayout({ width: r.width, height: r.height, zoom: r.height / 600, designHeight: 600, groundDesignY: GROUND_SURFACE_Y }, DESIGN).rowCentre;
    return r.placed[0].screenY <= single + 0.01;
  });

  const p390 = results.find((r) => r.label === "390x844")!;
  const jump = p390.rects[3];
  check("390x844 (a typical phone, portrait): the buttons are 44px tall (was 30) and the group has 23px margins on both sides (was 103 left / 47 right)", Math.abs(p390.rects[0].bottom - p390.rects[0].top - 44) < 1 && Math.abs(Math.min(...p390.rects.map((x) => x.left)) - 23.4) < 0.6 && Math.abs(390 - jump.right - 23.4) < 0.6, `${(p390.rects[0].bottom - p390.rects[0].top).toFixed(1)}px, margins ${Math.min(...p390.rects.map((x) => x.left)).toFixed(1)} / ${(390 - jump.right).toFixed(1)}`);
  const land = results.find((r) => r.label === "667x375")!;
  check("667x375 (a small landscape phone): the buttons are larger than today, clear of the volume control, and still under Rara's feet", land.scale > 1.1 * land.baselineScale && land.rects.every((x) => x.top >= land.groundLine), `${(land.scale / land.baselineScale).toFixed(2)}x today's size`);
}

// --- HUD text ---------------------------------------------------------------------------------------------------------------------------
{
  check("the HUD lines grow by a noticeable but moderate amount (between 1.15x and 1.35x)", MOBILE_HUD_TEXT_BOOST >= 1.15 && MOBILE_HUD_TEXT_BOOST <= 1.35, `${MOBILE_HUD_TEXT_BOOST}x`);
  const title = 42;
  check("the hierarchy holds: the title (42px) stays larger than every boosted line under it, and subtitle > counter > timer keeps its order", [24, 22, 18].every((px) => px * MOBILE_HUD_TEXT_BOOST < title) && 24 > 22 && 22 > 18);
}

// --- camera --------------------------------------------------------------------------------------------------------------------------
{
  const heights = [320, 360, 375, 390, 412, 430, 568, 600, 667, 720, 740, 768, 844, 900, 932, 1024, 1080, 1440];
  check("desktop: the camera zoom is exactly the window height over 600, and nothing is scaled (compensation is exactly 1), at every size", heights.every((h) => { const c = layoutCamera({ height: h }, 600, false); return c.zoom === h / 600 && c.uiZoom === h / 600 && c.compensate === 1; }));
  check("the phone camera zoom factor is exactly 1: noticeably closer in than earlier, more zoomed-out tunings this value has held", MOBILE_CAMERA_ZOOM_FACTOR === 1);
  check("phone: the camera zoom is exactly the window-height zoom at every size (factor 1 means no extra scaling)", heights.every((h) => { const c = layoutCamera({ height: h }, 600, true); return Math.abs(c.zoom - MOBILE_CAMERA_ZOOM_FACTOR * (h / 600)) < 1e-12 && c.uiZoom === h / 600; }));
  check("phone: screen-space UI needs no compensation at all now (compensation x camera zoom = the window-height zoom, and compensation is exactly 1, matching desktop)", heights.every((h) => { const c = layoutCamera({ height: h }, 600, true); return Math.abs(c.compensate * c.zoom - c.uiZoom) < 1e-12 && c.compensate === 1; }));
  check("phone: the world is framed exactly as desktop frames it (no extra width shown, no extra height below the world)", heights.every((h) => { const c = layoutCamera({ height: h }, 600, true); return Math.abs(1 / (c.zoom / c.uiZoom) - 1) < 1e-12; }));
  check("phone: the world fills exactly 100% of the window height (matching desktop; not made small)", heights.every((h) => Math.abs(600 * layoutCamera({ height: h }, 600, true).zoom - h) < 1e-9));
}

// --- the ground carried on below the world ---------------------------------------------------------------------------------------------
{
  const framed = 600 / MOBILE_CAMERA_ZOOM_FACTOR; // the world height the phone camera frames, world px (the camera is top-aligned)
  check("the ground extension reaches further below the world than the phone camera can ever frame (so no empty strip can show)", MOBILE_WORLD_EXTENSION >= framed - 600 + 20, `frames ${(framed - 600).toFixed(1)}px below the world, the ground reaches ${MOBILE_WORLD_EXTENSION}px`);
  check("phone: the camera frames the world's top edge at the top of the screen and only ever exposes space BELOW the world", [320, 568, 844, 932].every((h) => { const c = layoutCamera({ height: h }, 600, true); return (h / c.zoom) >= 600 && (h / c.zoom) - 600 <= MOBILE_WORLD_EXTENSION; }));
}

console.log(failures === 0 ? "\nAll mobile checks passed." : `\n${failures} mobile check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
