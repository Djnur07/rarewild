/**
 * Validation for the phone rendering-quality maths (lib/render/quality.ts), in plain Node. The pictures themselves are checked
 * in a real browser by scripts/browser (real screenshots, and an audit of every object in the scene).
 *
 *   node scripts/render/validate-render.ts
 *
 * Sections: the canvas resolution (one canvas pixel per device pixel on a phone, capped and budgeted; exactly what it was on
 * desktop), the texture detail that feeds it (the SVG art, world text) and its memory cost, and the guarantee that the camera
 * framing constant is untouched.
 */

import { ENVIRONMENT_ASSETS } from "../../lib/environment/assetManifest.ts";
import { MOBILE_CAMERA_ZOOM_FACTOR } from "../../lib/mobile/layout.ts";
import {
  canvasSizeFor, environmentTextureScale, MAX_PHONE_TEXT_RESOLUTION, MAX_RENDER_PIXELS, MAX_RENDER_SCALE, MAX_TEXTURE_SCALE,
  renderScaleFor, setActiveRenderScale, worldTextResolution,
} from "../../lib/render/quality.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// --- canvas resolution -------------------------------------------------------------------------------------------------------------
{
  const dprs = [1, 1.25, 1.5, 2, 2.625, 3, 3.5, 4];
  check("desktop (not a phone): exactly 1 canvas pixel per CSS pixel at every window size and every device pixel ratio, as it always was", dprs.every((d) => [[1280, 720], [1920, 1080], [390, 844], [3840, 2160]].every(([w, h]) => renderScaleFor(w, h, d, false) === 1)));
  check("phone: a device pixel ratio of 1, 2 and 3 gets exactly that many canvas pixels per CSS pixel", renderScaleFor(390, 844, 1, true) === 1 && renderScaleFor(390, 844, 2, true) === 2 && renderScaleFor(390, 844, 3, true) === 3);
  check("phone: a fractional ratio (2.625, common on Android) is followed exactly, not rounded", renderScaleFor(412, 915, 2.625, true) === 2.625);
  check("phone: never more than 3x, however dense the screen (3.5 and 4 are capped)", renderScaleFor(412, 915, 3.5, true) === MAX_RENDER_SCALE && renderScaleFor(360, 800, 4, true) === MAX_RENDER_SCALE);
  check("phone: never below 1 (a ratio under 1 is treated as 1)", renderScaleFor(390, 844, 0.75, true) === 1);
  const proMax = 430 * 932 * 9;
  check("phone: the largest current iPhone (430x932 at 3x = 3.6M pixels) is rendered at its full resolution, inside the pixel budget", proMax <= MAX_RENDER_PIXELS && renderScaleFor(430, 932, 3, true) === 3, `${(proMax / 1e6).toFixed(2)}M of ${(MAX_RENDER_PIXELS / 1e6).toFixed(1)}M`);
  const tablet = renderScaleFor(1024, 1366, 2, true);
  check("a large tablet (1024x1366 at 2x = 5.6M pixels) is scaled down to fit the pixel budget instead of a canvas that heavy", tablet < 2 && tablet >= 1 && 1024 * 1366 * tablet * tablet <= MAX_RENDER_PIXELS + 1, `${tablet.toFixed(2)}x -> ${(1024 * 1366 * tablet * tablet / 1e6).toFixed(2)}M px`);
  const every = [[390, 844, 3], [412, 915, 2.625], [360, 740, 2], [844, 390, 3], [320, 568, 2]] as const;
  check("phone: the canvas is whole pixels, and shown at canvas / scale CSS px it covers exactly one device pixel per canvas pixel (to a millionth of a pixel), so the browser has nothing to resample", every.every(([w, h, d]) => {
    const scale = renderScaleFor(w, h, d, true); // (uncapped for these cases, so the scale is the device pixel ratio)
    const c = canvasSizeFor(w, h, scale);
    const devicePixelsShown = { width: (c.width / scale) * d, height: (c.height / scale) * d };
    return scale === d && Number.isInteger(c.width) && Number.isInteger(c.height) && Math.abs(devicePixelsShown.width - c.width) < 1e-6 && Math.abs(devicePixelsShown.height - c.height) < 1e-6;
  }), every.map(([w, h, d]) => { const s = renderScaleFor(w, h, d, true); const c = canvasSizeFor(w, h, s); return `${w}x${h}@${d} -> ${c.width}x${c.height}`; }).join(", "));
}

// --- the detail that feeds that canvas ---------------------------------------------------------------------------------------------
{
  check("desktop: the environment art is rasterised at exactly its game size (scale 1), as it always was", environmentTextureScale(1280, 720, 1, false) === 1 && environmentTextureScale(1920, 1080, 1, false) === 1);
  check("phone at 3x: the art is rasterised 3x (the camera shows it at about 3.4 canvas px per world px, so 3x leaves only a 14% stretch)", environmentTextureScale(390, 844, 3, true) === 3);
  check("phone at 2x: a tall phone (390x844) needs 3x (the camera now sits exactly at 1x, no longer zoomed out), while a shorter one (360x740) still needs only 2x", environmentTextureScale(390, 844, 2, true) === 3 && environmentTextureScale(360, 740, 2, true) === 2);
  check("phone at 1x: 1x (nothing to gain, nothing spent)", environmentTextureScale(390, 844, 1, true) === 1);
  check("the texture scale is never above the cap, whatever the screen", [[390, 844, 3], [1024, 1366, 1.73], [430, 932, 3], [600, 1200, 3]].every(([w, h, r]) => environmentTextureScale(w, h, r, true) <= MAX_TEXTURE_SCALE));
  const widest = Math.max(...Object.values(ENVIRONMENT_ASSETS).map((a) => a.width));
  check("the widest art (the 1067px sky) stays under the 4096px texture limit of older GPUs at the largest scale", widest * MAX_TEXTURE_SCALE <= 4096, `${widest * MAX_TEXTURE_SCALE}px`);
  const megabytes = (k: number) => Object.values(ENVIRONMENT_ASSETS).reduce((sum, a) => sum + a.width * k * a.height * k * 4, 0) / 1048576;
  check("the art's memory at the largest scale is bounded (under 130MB), against about 20MB before", megabytes(MAX_TEXTURE_SCALE) < 130 && megabytes(1) < 30, `${megabytes(1).toFixed(0)}MB at 1x, ${megabytes(2).toFixed(0)}MB at 2x, ${megabytes(3).toFixed(0)}MB at 3x`);

  setActiveRenderScale(1);
  check("world text off a phone keeps exactly the resolution the game always gave it", worldTextResolution(2, 1280, 720) === 2 && worldTextResolution(1, 1280, 720) === 1 && worldTextResolution(2, 390, 844) === 2);
  setActiveRenderScale(3);
  const onPhone = worldTextResolution(2, 1170, 2532);
  check("world text on a 3x phone is drawn with as many pixels as the camera shows it with (5 texture px per world px, not 2)", onPhone === 5 && worldTextResolution(1, 1170, 2532) === 5, `resolution ${onPhone}`);
  check("...and never above the phone cap", worldTextResolution(2, 20000, 20000) === MAX_PHONE_TEXT_RESOLUTION);
  setActiveRenderScale(1);
}

// --- the framing is untouched -------------------------------------------------------------------------------------------------------
check("the phone camera zoom factor is exactly 1 (rendering quality never changes what the camera frames)", MOBILE_CAMERA_ZOOM_FACTOR === 1);

console.log(failures === 0 ? "\nAll render checks passed." : `\n${failures} render check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
