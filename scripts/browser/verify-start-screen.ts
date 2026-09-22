/* eslint-disable @typescript-eslint/no-explicit-any -- the page-side code reads the untyped test handle on `window` */
/**
 * Browser test for the start screen (READY -> PLAY) and the run flow around it, in real
 * Chromium with real mouse, touch and keyboard input. It reads the scene through the
 * development-only `window.__RAREWILD_TEST__` handle (see Game.tsx: MainScene.createTestHook),
 * which also lets it place Rara so a whole level does not have to be played by hand.
 *
 *   npm run dev -- -p 3111                # in another terminal (the handle does not exist in a production build)
 *   BASE_URL=http://localhost:3111 node scripts/browser/verify-start-screen.ts
 *
 * Needs `playwright-core` and a Chromium it can launch. It is not a dependency of this project:
 * install it wherever you like and point PLAYWRIGHT_CORE at its folder if it is not resolvable
 * from here (e.g. PLAYWRIGHT_CORE=~/.npm/_npx/<hash>/node_modules/playwright-core). Set
 * CHROME_PATH to an installed Chrome/Chromium binary to use it instead of Playwright's own download,
 * and SCREENSHOT_DIR to keep screenshots of the start screen.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { collectibleCenter, FIRST_LEVEL_COLLECTIBLES } from "../../lib/collectibles/placement.ts";
import { dangerEdgeAlpha, dangerLevel } from "../../lib/feedback/danger.ts";
import { sfxLevel } from "../../lib/audio/sfx.ts";
import { singleRowLayout, controlSideMargin, MOBILE_CAMERA_ZOOM_FACTOR, type DesignButton } from "../../lib/mobile/layout.ts";
import { FIRST_LEVEL_HUNTERS } from "../../lib/hunter/placement.ts";
import { GROUND_SURFACE_Y, PLAYER_START_X } from "../../lib/level/constants.ts";
import { ZONES, zoneAt } from "../../lib/level/zones.ts";
import { EXIT_SPEC } from "../../lib/objective/placement.ts";
import { FIRST_LEVEL_OBSTACLES } from "../../lib/obstacles/placement.ts";
import { obstacleRects } from "../../lib/obstacles/shapes.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;

/** The small part of the Playwright API this script uses (playwright-core is not a project dependency, so it has no types here). */
interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<R = unknown, A = undefined>(fn: (arg: A) => R, arg?: A): Promise<R>;
  waitForFunction(fn: (arg: any) => unknown, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path?: string }): Promise<Uint8Array>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  on(event: string, handler: (arg: any) => void): void;
  context(): { close(): Promise<void> };
  keyboard: { down(key: string): Promise<void>; up(key: string): Promise<void>; press(key: string): Promise<void> };
  mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void>; click(x: number, y: number): Promise<void> };
  touchscreen: { tap(x: number, y: number): Promise<void> };
}
interface Browser {
  newContext(options: Record<string, unknown>): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
}

async function loadPlaywright(): Promise<{ chromium: { launch(options?: Record<string, unknown>): Promise<Browser> } }> {
  const attempts = [() => import(/* webpackIgnore: true */ "playwright-core" as string), () => import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE ?? "", "index.mjs")).href)];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch {
      /* try the next one */
    }
  }
  throw new Error("playwright-core not found: install it or set PLAYWRIGHT_CORE to its folder.");
}
const { chromium } = await loadPlaywright();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Snapshot = {
  phase: string; elapsedMs: number; startedAtMs: number | null; timerText: string; counterText: string; exitStatusText: string;
  collected: number; total: number; exitOpen: boolean;
  rara: { x: number; y: number; vx: number; vy: number; onFloor: boolean };
  hunters: { x: number; y: number; state: string; caught: boolean }[];
  readyVisible: boolean; caughtVisible: boolean; completeVisible: boolean;
  viewport: { width: number; height: number; zoom: number; worldView: { x: number; y: number; width: number; height: number } };
  touch: { phone: boolean; held: { left: boolean; right: boolean; jump: boolean }; pointers: number };
  audio: { routed: boolean; gain: number | null; elementVolume: number | null; elementMuted: boolean | null; contextState: string | null; playing: boolean; sfxLevel: number };
  feedback: { active: number; edgeAlpha: number; glowAlpha: number; reducedMotion: boolean; sfx: Record<string, number>; shaking: boolean; flashing: boolean; sceneObjects: number };
};
type Rect = { x: number; y: number; width: number; height: number };

const snap = (page: Page) => page.evaluate(() => (window as any).__RAREWILD_TEST__.snapshot()) as Promise<Snapshot>;
const rectOf = (page: Page, label: string) => page.evaluate((l) => (window as any).__RAREWILD_TEST__.buttonRect(l), label) as Promise<Rect | null>;
const place = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => (window as any).__RAREWILD_TEST__.placeRara(px, py), [x, y]);
/** Wait until `test(snapshot, arg)` is true. The test runs inside the page, so it cannot capture variables: pass them as `arg`. */
const until = <T = undefined>(page: Page, test: (s: Snapshot, arg: T) => boolean, timeout = 4000, arg?: T) =>
  page
    .waitForFunction(([src, a]) => new Function("s", "a", `return (${src})(s, a)`)((window as any).__RAREWILD_TEST__.snapshot(), a), [test.toString(), arg] as const, { timeout })
    .then(() => true, () => false);
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
const errors: string[] = [];

async function openGame(browser: Browser, options: Record<string, unknown>) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!(window as any).__RAREWILD_TEST__, undefined, { timeout: 60000 });
  await until(page, (s) => s.readyVisible, 10000);
  await wait(page, 500); // let the fade-in finish
  return page;
}

/**
 * Press and hold Space until `test` holds. A single jump press can be dropped when a frame stalls in the
 * headless software renderer (the jump buffer is short), so the press is retried; the key ends up released.
 */
async function jumpUntil<T>(page: Page, test: (s: Snapshot, arg: T) => boolean, arg: T, timeout = 1200) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.down("Space");
    const ok = await until(page, test, timeout, arg);
    await page.keyboard.up("Space");
    if (ok) return true;
    await until(page, (x) => x.rara.onFloor, 2000);
  }
  return false;
}

/** Click the centre of a visible on-screen button. */
async function clickButton(page: Page, label: string, how: "mouse" | "touch" = "mouse") {
  const r = await rectOf(page, label);
  if (!r) throw new Error(`no visible "${label}" button`);
  if (how === "touch") await page.touchscreen.tap(r.x, r.y);
  else await page.mouse.click(r.x, r.y);
}


// --- helpers for the collectible-pattern tests: a small "player" that drives the real game with real key presses ---------------------
const BODY_HALF_WIDTH = 22.5;
const BODY_HEIGHT = 105;
const SOLIDS = FIRST_LEVEL_OBSTACLES.flatMap((o) => obstacleRects(o, GROUND_SURFACE_Y));

/**
 * Steer toward `targetX` with the arrow keys until `done(snapshot)`, jumping (Space held to the top of the jump) whenever a wall
 * that needs clearing is close ahead, exactly like the simulated player in scripts/collectibles/raidSim.ts. If she flies past the
 * target she turns back for it, like a player would. Returns whether `done` was reached before the timeout or before the run ended.
 */
async function drive(page: Page, targetX: number, done: (s: Snapshot) => boolean, timeoutMs = 6000) {
  let pressed: "ArrowRight" | "ArrowLeft" | null = null;
  let spaceDownAt: number | null = null;
  let launched = false;
  let reached = false;
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < timeoutMs) {
      const s = await snap(page);
      if (done(s)) {
        reached = true;
        break;
      }
      if (s.phase !== "PLAYING") break;
      const dx = targetX - s.rara.x;
      const dir = Math.abs(dx) <= 6 ? 0 : Math.sign(dx);
      const want = dir === 0 ? null : dir > 0 ? "ArrowRight" : "ArrowLeft";
      if (want !== pressed) {
        if (pressed) await page.keyboard.up(pressed);
        if (want) await page.keyboard.down(want);
        pressed = want;
      }
      if (spaceDownAt !== null) {
        if (!s.rara.onFloor) launched = true;
        // Let go at the top of the jump (or if the press never launched one), so a held Space cannot chain a second jump.
        if ((launched && s.rara.vy >= 0) || Date.now() - spaceDownAt > 500) {
          await page.keyboard.up("Space");
          spaceDownAt = null;
          launched = false;
        }
      } else if (s.rara.onFloor && dir !== 0) {
        const feet = s.rara.y + 52.5;
        const wallAhead = SOLIDS.some((w) => {
          const gap = dir > 0 ? w.left - (s.rara.x + BODY_HALF_WIDTH) : s.rara.x - BODY_HALF_WIDTH - w.right;
          return gap >= -2 && gap <= 70 && w.top < feet - 2 && w.bottom > feet - BODY_HEIGHT;
        });
        if (wallAhead) {
          await page.keyboard.down("Space");
          spaceDownAt = Date.now();
        }
      }
    }
  } finally {
    if (pressed) await page.keyboard.up(pressed);
    if (spaceDownAt !== null) await page.keyboard.up("Space");
  }
  return reached;
}

/** Wait until a Hunter is walking (patrolling) in `heading` with its x inside `window`: the moment to test a raid at its worst. */
async function waitForHunter(page: Page, index: number, heading: 1 | -1, window: [number, number], timeoutMs = 25000) {
  const t0 = Date.now();
  let previous = (await snap(page)).hunters[index].x;
  while (Date.now() - t0 < timeoutMs) {
    await wait(page, 50);
    const s = await snap(page);
    if (s.phase !== "PLAYING") return false;
    const h = s.hunters[index];
    if (h.state === "PATROL" && Math.sign(h.x - previous) === heading && h.x >= window[0] && h.x <= window[1]) return true;
    previous = h.x;
  }
  return false;
}

/** A restart if she was caught, then PLAY: leaves the game in a fresh PLAYING run. */
async function freshRun(page: Page) {
  let s = await snap(page);
  if (s.phase === "CAUGHT" || s.phase === "COMPLETE") {
    await wait(page, 1200); // the end screen fades in before its button works
    await clickButton(page, s.phase === "CAUGHT" ? "RESTART" : "PLAY AGAIN");
    await until(page, (x) => x.phase === "READY" && x.readyVisible && Math.abs(x.rara.x - 400) < 2, 3000);
    await wait(page, 600);
  }
  s = await snap(page);
  if (s.phase === "READY") {
    await clickButton(page, "PLAY");
    await until(page, (x) => x.phase === "PLAYING", 2000);
  }
}

interface BrowserRaid {
  id: string;
  hunter: number;
  /** Start the raid when the Hunter is walking this way (1 = right, -1 = left) inside this x window: the worst timing for the item. */
  heading: 1 | -1;
  window: [number, number];
  start: number;
  /** Where she leaves to after the grab: a spot the Hunter cannot see. */
  leaveTo: number;
}

/** Approach from cover, grab the item, leave the way the level intends, then stand still and watch for a capture. */
async function raid(page: Page, r: BrowserRaid, startY: number) {
  await freshRun(page);
  const itemX = items[FIRST_LEVEL_COLLECTIBLES.findIndex((i) => i.id === r.id)].x;
  // Take any OTHER item on the route (or within reach of the start) first, so the counter can only rise for the item under test.
  const lo = Math.min(r.start, itemX) - 45;
  const hi = Math.max(r.start, itemX) + 45;
  for (const [j, other] of items.entries()) {
    if (FIRST_LEVEL_COLLECTIBLES[j].id === r.id || other.x < lo || other.x > hi) continue;
    const had = (await snap(page)).collected;
    await place(page, other.x, other.y);
    await until(page, (x, n) => x.collected > n, 1000, had);
  }
  const timing = await waitForHunter(page, r.hunter, r.heading, r.window);
  await place(page, r.start, startY);
  await until(page, (x) => x.rara.onFloor, 1500);
  const before = (await snap(page)).collected;
  let noticed = false;
  const watch = (x: Snapshot) => {
    const h = x.hunters[r.hunter];
    if (h.state === "ALERT" || h.state === "CHASE") noticed = true;
    return x;
  };
  const got = await drive(page, itemX, (x) => watch(x).collected === before + 1, 5000);
  const left = await drive(page, r.leaveTo, (x) => watch(x) && Math.abs(x.rara.x - r.leaveTo) <= 25 && x.rara.onFloor, 5000);
  let caught = false;
  for (let i = 0; i < 30; i++) {
    await wait(page, 100);
    const x = watch(await snap(page));
    if (x.phase === "CAUGHT" || x.hunters[r.hunter].caught) caught = true;
  }
  return { timing, got, left, caught, noticed, x: (await snap(page)).rara.x };
}

const items = FIRST_LEVEL_COLLECTIBLES.map((i) => collectibleCenter(i, GROUND_SURFACE_Y));
const HUNTER_1 = FIRST_LEVEL_HUNTERS[0];
const HUNTER_1_CLEAR_X = HUNTER_1.x - 200; // open ground 200px in front of the first Hunter, inside its sight

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined);
try {
  // ============================================================================================================
  // Desktop: the whole flow
  // ============================================================================================================
  const page = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  if (SCREENSHOT_DIR) await page.screenshot({ path: join(SCREENSHOT_DIR, "ready-desktop.png") });

  // 1-2. The game opens on the start screen with the timer at 00:00.
  let s = await snap(page);
  const start = { x: s.rara.x, y: s.rara.y };
  check("1. initial state is READY", s.phase === "READY" && s.readyVisible);
  check("2. timer shows 00:00 before PLAY", s.timerText === "TIME: 00:00" && s.elapsedMs === 0 && s.startedAtMs === null, s.timerText);
  check("   exit is locked, 0 collected, Rara stands at the start", s.exitStatusText === "EXIT LOCKED" && s.collected === 0 && Math.abs(s.rara.x - PLAYER_START_X) < 2 && s.rara.onFloor, `${s.exitStatusText}, x=${s.rara.x.toFixed(0)}`);
  const button = (await rectOf(page, "PLAY"))!;
  check("   a big PLAY button is centred on screen", !!button && Math.abs(button.x - 640) < 2 && button.height >= 44 && button.width >= 120, JSON.stringify(button, (_, v) => (typeof v === "number" ? Math.round(v) : v)));
  await wait(page, 1500);
  s = await snap(page);
  check("   the timer still reads 00:00 after 1.5s on the start screen (it does not run on load)", s.timerText === "TIME: 00:00" && s.elapsedMs === 0 && s.phase === "READY");

  // 3. Movement is disabled: keyboard, on-screen buttons, jump.
  await page.keyboard.down("ArrowRight");
  await wait(page, 600);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("d");
  await page.keyboard.down("Space");
  await wait(page, 500);
  await page.keyboard.up("Space");
  await page.keyboard.down("ArrowUp");
  await wait(page, 500);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("d");
  let after = await snap(page);
  check("3. keyboard movement and jump do nothing before PLAY", Math.abs(after.rara.x - start.x) < 1 && Math.abs(after.rara.y - start.y) < 1 && after.phase === "READY", `dx=${(after.rara.x - start.x).toFixed(1)} dy=${(after.rara.y - start.y).toFixed(1)}`);
  const rightButton = (await rectOf(page, "→"))!;
  await page.mouse.move(rightButton.x, rightButton.y);
  await page.mouse.down();
  await wait(page, 600);
  await page.mouse.up();
  const jumpButton = (await rectOf(page, "JUMP"))!;
  await page.mouse.click(jumpButton.x, jumpButton.y);
  await wait(page, 400);
  after = await snap(page);
  check("   the on-screen → and JUMP buttons do nothing before PLAY", Math.abs(after.rara.x - start.x) < 1 && Math.abs(after.rara.y - start.y) < 1 && after.phase === "READY");

  // 4. The Hunter does not target Rara; collectibles cannot be collected.
  const before = (await snap(page)).hunters;
  await place(page, HUNTER_1_CLEAR_X, start.y);
  await wait(page, 1500);
  s = await snap(page);
  check("4. a Hunter in plain sight does not react before PLAY (same state, same place, no catch)", s.hunters[0].state === before[0].state && Math.abs(s.hunters[0].x - before[0].x) < 0.5 && s.phase === "READY" && !s.hunters[0].caught, `${before[0].state} -> ${s.hunters[0].state}`);
  await place(page, HUNTER_1.x, start.y);
  await wait(page, 800);
  s = await snap(page);
  check("   even standing on the Hunter she is not caught before PLAY", s.phase === "READY" && !s.hunters[0].caught && !s.caughtVisible);
  await place(page, items[0].x, items[0].y);
  await wait(page, 600);
  s = await snap(page);
  check("   collectibles cannot be collected before PLAY", s.collected === 0 && s.counterText === "COLLECTED: 0 / 12", s.counterText);
  await place(page, start.x, start.y);
  await wait(page, 300);

  // 5-6. Clicking PLAY: READY -> PLAYING, the timer starts at that moment.
  await page.evaluate(() => window.addEventListener("pointerup", () => ((window as any).__clickAt = Date.now()), { once: true, capture: true }));
  await clickButton(page, "PLAY");
  check("5. clicking PLAY changes READY -> PLAYING and hides the start screen", await until(page, (x) => x.phase === "PLAYING" && !x.readyVisible, 1500));
  s = await snap(page);
  check("6. the timer starts at PLAY: a start time is recorded now, not at page load", s.startedAtMs !== null && s.startedAtMs > 1000, `startedAt=${s.startedAtMs?.toFixed(0)}ms of scene time`);
  await wait(page, 1300);
  const t = await page.evaluate(() => ({ s: (window as any).__RAREWILD_TEST__.snapshot(), sinceClick: Date.now() - (window as any).__clickAt }));
  // The timer never counts time from before the click (it cannot lead the wall clock), and it only trails it by what the scene's
  // per-frame clamp drops when the headless software renderer stalls a frame.
  check("   after 1.3s of play the timer reads 00:01 and started at the click (never ahead of the wall clock since it, at most a stalled frame or two behind)", t.s.timerText === "TIME: 00:01" && t.s.elapsedMs <= t.sinceClick + 30 && t.s.elapsedMs >= t.sinceClick - 500, `timer ${t.s.elapsedMs.toFixed(0)}ms vs ${t.sinceClick}ms since click`);
  check("   the start screen is gone: PLAY is not a visible button any more", (await rectOf(page, "PLAY")) === null);

  // 7. Movement works after PLAY.
  s = await snap(page);
  const x0 = s.rara.x;
  await page.keyboard.down("ArrowRight");
  await wait(page, 500);
  await page.keyboard.up("ArrowRight");
  after = await snap(page);
  check("7. keyboard movement works after PLAY", after.rara.x > x0 + 60, `x ${x0.toFixed(0)} -> ${after.rara.x.toFixed(0)}`);
  check("   jumping works after PLAY (held Space rises well above the ground)", await jumpUntil(page, (x, y0) => x.rara.y < y0 - 50, start.y));
  await until(page, (x) => x.rara.onFloor, 2000);
  await wait(page, 300);
  const leftButton = (await rectOf(page, "←"))!;
  const xb = (await snap(page)).rara.x;
  await page.mouse.move(leftButton.x, leftButton.y);
  await page.mouse.down();
  await wait(page, 500);
  await page.mouse.up();
  after = await snap(page);
  check("   the on-screen ← button works after PLAY", after.rara.x < xb - 40, `x ${xb.toFixed(0)} -> ${after.rara.x.toFixed(0)}`);

  // 18. Obstacles are unchanged: a low rock still blocks her, and a jump still clears it.
  const rock = FIRST_LEVEL_OBSTACLES[0];
  await place(page, rock.x - 250, start.y);
  await wait(page, 300);
  await page.keyboard.down("ArrowRight");
  await wait(page, 1600);
  s = await snap(page);
  const halfBody = 22.5;
  check("18. a rock still blocks her (she stops against it)", Math.abs(s.rara.x - (rock.x - rock.width / 2 - halfBody)) < 6, `x=${s.rara.x.toFixed(1)}, rock edge ${(rock.x - rock.width / 2 - halfBody).toFixed(1)}`);
  check("   ...and jumping clears it", await jumpUntil(page, (x, edge) => x.rara.x > edge, rock.x + rock.width / 2 + halfBody, 2000));
  await page.keyboard.up("ArrowRight");
  await until(page, (x) => x.rara.onFloor, 2000);

  // 8. Collectibles work after PLAY. Back to the start first so the Hunters stay out of it.
  const already = (await snap(page)).collected; // she picked up the ones on her path (c01, c02) while walking above
  await place(page, items[2].x, items[2].y); // c03: nowhere near her path so far
  check("8. a collectible is collected after PLAY (the counter goes up by one)", await until(page, (x, n) => x.collected === n + 1 && x.counterText === `COLLECTED: ${n + 1} / 12`, 1500, already), `${already} -> ${(await snap(page)).collected}`);

  // 9-10. The Hunter reacts after PLAY, catches her; the timer stops.
  // The Hunter faces one way, so try each side of it: it must notice her from one of them.
  const noticed = (x: Snapshot) => x.hunters[0].state === "ALERT" || x.hunters[0].state === "CHASE";
  const hunterX = (await snap(page)).hunters[0].x;
  await place(page, hunterX - 220, start.y);
  let reacted = await until(page, noticed, 1200);
  if (!reacted) {
    await place(page, (await snap(page)).hunters[0].x + 220, start.y);
    reacted = await until(page, noticed, 1200);
  }
  check("9. a Hunter in sight reacts after PLAY (alert / chase)", reacted, (await snap(page)).hunters[0].state);
  await place(page, (await snap(page)).hunters[0].x, start.y);
  check("   and catching her works: CAUGHT", await until(page, (x) => x.phase === "CAUGHT" && x.caughtVisible, 3000));
  s = await snap(page);
  await wait(page, 1200);
  after = await snap(page);
  check("10. the timer stops when CAUGHT", after.elapsedMs === s.elapsedMs && after.timerText === s.timerText, `${s.timerText} stays ${after.timerText}`);
  check("   the CAUGHT screen still offers RESTART", (await rectOf(page, "RESTART")) !== null);

  // 11-12. RESTART goes back to READY (not into a run), the timer is 00:00.
  await clickButton(page, "RESTART");
  // Arcade's body.reset() leaves the body centre 52px off for exactly one frame (it settles at the start on the next
  // physics step), so let that frame pass before reading the scene. The assertions below are unchanged.
  await until(page, (x, startX) => x.phase === "READY" && Math.abs(x.rara.x - startX) < 2, 1500, PLAYER_START_X);
  s = await snap(page);
  check("11. RESTART from CAUGHT returns to READY with the start screen", s.phase === "READY" && s.readyVisible && !s.caughtVisible);
  check("12. the timer resets to 00:00", s.timerText === "TIME: 00:00" && s.elapsedMs === 0 && s.startedAtMs === null, s.timerText);
  check("    the run is reset too: 0 / 12 collected, exit locked, Rara at the start, Hunter back at its post", s.collected === 0 && s.exitStatusText === "EXIT LOCKED" && Math.abs(s.rara.x - PLAYER_START_X) < 2 && Math.abs(s.hunters[0].x - before[0].x) < 1 && !s.hunters[0].caught, `x=${s.rara.x.toFixed(0)}`);
  await wait(page, 1500);
  s = await snap(page);
  check("    it does not start by itself: still READY at 00:00 after 1.5s", s.phase === "READY" && s.timerText === "TIME: 00:00");
  await page.keyboard.down("ArrowRight");
  await wait(page, 400);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("r");
  await page.keyboard.press("Enter");
  after = await snap(page);
  check("    movement keys, R and Enter do nothing on the start screen", Math.abs(after.rara.x - s.rara.x) < 1 && after.phase === "READY" && after.readyVisible);

  // 19 + 13: the exit stays locked until everything is collected; completing the level still works.
  const playedAt = (await snap(page)).startedAtMs;
  await clickButton(page, "PLAY");
  check("    PLAY again starts a fresh run", await until(page, (x) => x.phase === "PLAYING" && x.elapsedMs < 300, 1500));
  s = await snap(page);
  check("    ...with its own new start time", s.startedAtMs !== null && s.startedAtMs > 0 && s.startedAtMs !== playedAt, `startedAt=${s.startedAtMs?.toFixed(0)}`);
  await place(page, EXIT_SPEC.x - 60, start.y);
  await wait(page, 700);
  s = await snap(page);
  check("19. the exit is still locked at 0 / 12: reaching it does not complete the level", s.phase === "PLAYING" && !s.exitOpen && s.exitStatusText === "EXIT LOCKED", `${s.phase} ${s.exitStatusText}`);
  for (let i = 0; i < items.length; i++) {
    await place(page, items[i].x, items[i].y);
    await page.waitForFunction((n) => (window as any).__RAREWILD_TEST__.snapshot().collected >= n, i + 1, { timeout: 1500 }).catch(() => undefined);
  }
  s = await snap(page);
  check("13. collecting all 12 works and opens the exit", s.collected === 12 && s.exitOpen && s.exitStatusText === "EXIT OPEN" && s.phase === "PLAYING", `${s.counterText}, ${s.exitStatusText}, ${s.phase}`);
  await place(page, EXIT_SPEC.x, start.y);
  check("    reaching the open exit completes the level", await until(page, (x) => x.phase === "COMPLETE", 2000));
  check("    the LEVEL COMPLETE screen appears", await until(page, (x) => x.completeVisible, 2000));
  s = await snap(page);
  await wait(page, 1200);
  after = await snap(page);
  check("14. the timer stops at LEVEL COMPLETE", after.elapsedMs === s.elapsedMs && after.elapsedMs > 0, `${s.timerText}`);

  // 15-16: PLAY AGAIN returns to READY; PLAY starts a fresh timer.
  await clickButton(page, "PLAY AGAIN");
  s = await snap(page);
  check("15. PLAY AGAIN returns to READY (start screen, 00:00, 0 / 12, exit locked)", s.phase === "READY" && s.readyVisible && !s.completeVisible && s.timerText === "TIME: 00:00" && s.collected === 0 && s.exitStatusText === "EXIT LOCKED", `${s.phase} ${s.timerText}`);
  await wait(page, 1200);
  check("    ...and stays there until PLAY is pressed", (await snap(page)).phase === "READY" && (await snap(page)).elapsedMs === 0);
  await clickButton(page, "PLAY");
  await until(page, (x) => x.phase === "PLAYING");
  check("16. PLAY starts a fresh timer again (reaches 00:01, and is nowhere near the previous run's 00:03)", await until(page, (x) => x.timerText === "TIME: 00:01", 4000));
  s = await snap(page);
  check("    ...counting from 0 (under 2.5s)", s.elapsedMs < 2500, `${s.elapsedMs.toFixed(0)}ms`);
  await page.context().close();

  // ============================================================================================================
  // Mobile: a touch-only phone-sized window
  // ============================================================================================================
  const mobile = await openGame(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  if (SCREENSHOT_DIR) await mobile.screenshot({ path: join(SCREENSHOT_DIR, "ready-mobile.png") });
  s = await snap(mobile);
  const mstart = { x: s.rara.x, y: s.rara.y };
  const play = (await rectOf(mobile, "PLAY"))!;
  check("17. mobile: the start screen shows, the timer reads 00:00", s.phase === "READY" && s.readyVisible && s.timerText === "TIME: 00:00");
  check("    the PLAY button is a good touch target (at least 44px tall) and fully on screen", play.height >= 44 && play.width >= 100 && play.x - play.width / 2 >= 0 && play.x + play.width / 2 <= 390 && play.y + play.height / 2 <= 844, `${play.width.toFixed(0)}x${play.height.toFixed(0)}px at ${play.x.toFixed(0)},${play.y.toFixed(0)}`);
  const mRight = (await rectOf(mobile, "→"))!;
  await mobile.touchscreen.tap(mRight.x, mRight.y);
  await mobile.mouse.move(mRight.x, mRight.y);
  await mobile.mouse.down();
  await wait(mobile, 500);
  await mobile.mouse.up();
  const mJump = (await rectOf(mobile, "JUMP"))!;
  await mobile.touchscreen.tap(mJump.x, mJump.y);
  await wait(mobile, 500);
  after = await snap(mobile);
  check("    tapping or holding the on-screen buttons does not move Rara while the start screen is up", Math.abs(after.rara.x - mstart.x) < 1 && Math.abs(after.rara.y - mstart.y) < 1 && after.phase === "READY", `dx=${(after.rara.x - mstart.x).toFixed(1)}`);
  await mobile.touchscreen.tap(play.x, play.y);
  check("    tapping PLAY starts the run", await until(mobile, (x) => x.phase === "PLAYING" && !x.readyVisible, 1500));
  // (The headless phone-sized window renders in software at a low, uneven frame rate, so wait for the clock rather than assume the wall time.)
  check("    the timer runs from the tap (reaches 00:01)", await until(mobile, (x) => x.timerText === "TIME: 00:01", 4000));
  s = await snap(mobile);
  const mx = s.rara.x;
  const mRight2 = (await rectOf(mobile, "→"))!;
  await mobile.mouse.move(mRight2.x, mRight2.y);
  await mobile.mouse.down();
  await wait(mobile, 600);
  await mobile.mouse.up();
  after = await snap(mobile);
  check("    and the on-screen → button moves her after PLAY", after.rara.x > mx + 40, `x ${mx.toFixed(0)} -> ${after.rara.x.toFixed(0)}`);
  await mobile.context().close();


  // ============================================================================================================
  // Collectible patterns: the 12 collectibles across the six zones, the real routes to them, and the Hunter-side ones
  // ============================================================================================================
  const lay = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  const layY = (await snap(lay)).rara.y;
  await clickButton(lay, "PLAY");
  await until(lay, (x) => x.phase === "PLAYING", 2000);

  // P1-P2. All 12 exist, and they are spread 2 / 2 / 2 / 2 / 3 / 1 across the zones: put Rara on each one in turn.
  s = await snap(lay);
  check("P1. all 12 collectibles exist: the counter starts at 0 / 12 and the scene reports 12", s.total === 12 && s.counterText === "COLLECTED: 0 / 12" && FIRST_LEVEL_COLLECTIBLES.length === 12, s.counterText);
  const collectEveryItem = async () => {
    const perZone = ZONES.map(() => 0);
    let everyOneCounted = true;
    for (let i = 0; i < items.length; i++) {
      await place(lay, items[i].x, items[i].y);
      const counted = await until(lay, (x, n) => x.collected === n + 1, 1500, i);
      everyOneCounted &&= counted;
      if (counted) perZone[ZONES.findIndex((z) => z.id === zoneAt(FIRST_LEVEL_COLLECTIBLES[i].x).id)]++;
    }
    return { perZone, everyOneCounted };
  };
  let all = await collectEveryItem();
  check("P2. putting Rara on each collectible counts it exactly once (12 in a row), and by zone that is 2 / 2 / 2 / 2 / 3 / 1", all.everyOneCounted && all.perZone.join("/") === "2/2/2/2/3/1", all.perZone.join("/"));
  s = await snap(lay);
  check("P3. collecting all 12 still unlocks the exit", s.collected === 12 && s.exitOpen && s.exitStatusText === "EXIT OPEN" && s.counterText === "COLLECTED: 12 / 12", `${s.counterText}, ${s.exitStatusText}`);
  await place(lay, EXIT_SPEC.x, layY);
  check("P4. LEVEL COMPLETE still works after collecting all 12 (the exit completes the level)", await until(lay, (x) => x.phase === "COMPLETE" && x.completeVisible, 2500));
  await wait(lay, 1200);
  await clickButton(lay, "PLAY AGAIN");
  s = await snap(lay);
  check("P5. restart resets all 12: back to READY with 0 / 12 and the exit locked", s.phase === "READY" && s.collected === 0 && s.counterText === "COLLECTED: 0 / 12" && s.exitStatusText === "EXIT LOCKED", `${s.counterText}`);
  await wait(lay, 600);
  await clickButton(lay, "PLAY");
  await until(lay, (x) => x.phase === "PLAYING", 2000);
  all = await collectEveryItem();
  s = await snap(lay);
  check("    ...and every one of the 12 is back and collectible again in the new run (12 in a row, 2 / 2 / 2 / 2 / 3 / 1)", all.everyOneCounted && all.perZone.join("/") === "2/2/2/2/3/1" && s.collected === 12, all.perZone.join("/"));
  await place(lay, EXIT_SPEC.x, layY);
  await until(lay, (x) => x.phase === "COMPLETE" && x.completeVisible, 2500);
  await wait(lay, 1200);
  await freshRun(lay);

  // P6. Collecting works by real movement: run at the first collectible from the start.
  s = await snap(lay);
  check("P6. a collectible can be collected by really running at it: c01 from Rara's start (counter 1 / 12)", (await drive(lay, items[0].x, (x) => x.collected >= 1, 4000)) && (await snap(lay)).counterText === "COLLECTED: 1 / 12", `x=${(await snap(lay)).rara.x.toFixed(0)}`);

  // P7-P8. The obstacle items and the high items are reachable with real key presses and the real jump (no Hunter nearby).
  const reach = async (id: string, startX: number) => {
    const spec = FIRST_LEVEL_COLLECTIBLES.findIndex((i) => i.id === id);
    await place(lay, startX, layY);
    await until(lay, (x) => x.rara.onFloor, 1500);
    const before = (await snap(lay)).collected;
    const ok = await drive(lay, items[spec].x, (x) => x.collected === before + 1, 5000);
    await until(lay, (x) => x.rara.onFloor, 2000);
    return { ok, spec };
  };
  const arc2 = await reach("c02", 900);
  const arc3 = await reach("c03", 1560);
  check("P7. obstacle items are reachable: c02 over the stump and c03 over the log are collected by jumping the obstacle (ARC)", arc2.ok && arc3.ok, `c02 ${arc2.ok}, c03 ${arc3.ok}`);
  const vert4 = await reach("c04", 2440);
  check("P8. a high item is reachable: c04, high above the tall pillar, is collected by a real jump over it (VERTICAL)", vert4.ok);
  await freshRun(lay);

  // P9-P13. The Hunter-side collectibles, each at the Hunter's worst timing (it is walking toward her side of the beat and faces her):
  // she approaches from cover, grabs the item, leaves the way the level intends, and stands still for 3 seconds. Never caught.
  const RAIDS: BrowserRaid[] = [
    { id: "c05", hunter: 0, heading: -1, window: [3150, 3330], start: 2760, leaveTo: 2760 },
    { id: "c07", hunter: 1, heading: -1, window: [4450, 4620], start: 3850, leaveTo: 3850 },
    { id: "c08", hunter: 1, heading: 1, window: [4560, 4690], start: 4800, leaveTo: 5150 },
    { id: "c10", hunter: 2, heading: -1, window: [5780, 5900], start: 5250, leaveTo: 5250 },
    { id: "c11", hunter: 2, heading: 1, window: [5880, 6040], start: 6120, leaveTo: 6620 },
  ];
  const labels: Record<string, string> = {
    c05: "P9. Zone 3 risk item c05 (front of the first Hunter's beat): collected, and she gets away over the stump without being caught",
    c07: "P10. Zone 4 deck item c07 (climbing the log deck in the second Hunter's sight): collected, and she drops back behind the deck uncaught",
    c08: "P11. Zone 4 stack item c08 (high above the stack, just past the second Hunter): collected, and she gets clear behind the stack uncaught",
    c10: "P12. Zone 5 risk item c10 (in front of the third Hunter's beat, the higher risk): collected, and she gets away over the stack uncaught",
    c11: "P13. Zone 5 obstacle item c11 (hopping the two pillars past the third Hunter): collected, and she gets clear behind the pillars uncaught",
  };
  for (const r of RAIDS) {
    const res = await raid(lay, r, layY);
    check(labels[r.id], res.timing && res.got && res.left && !res.caught, `Hunter ${res.noticed ? "noticed her" : "never noticed her"}; collected ${res.got}, got away ${res.left}, caught ${res.caught}, ended at x=${res.x.toFixed(0)}`);
    if (r.id === "c05" || r.id === "c10") check(`     ...and the pressure is real: at that timing the Hunter DID notice her (alert / chase), she just did not stay to be caught`, res.noticed);
  }
  await lay.context().close();

  // ============================================================================================================
  // Player feedback and game feel: pickup, jump and landing, Hunter danger, capture, level complete, restart, reduced motion.
  // None of it may change gameplay: the checks below read the same scene the gameplay tests read.
  // ============================================================================================================
  const fb = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  const fbStart = await snap(fb);
  const fbY = fbStart.rara.y;
  /** Stand in the first Hunter's sight (trying a few spots either side, as the level has cover between it and some of them) until it alerts. */
  const provoke = async (page: Page, y: number) => {
    for (const dx of [-220, 220, -150, 150, -300, 300]) {
      await place(page, (await snap(page)).hunters[0].x + dx, y);
      if (await until(page, (x) => x.hunters[0].state === "ALERT" || x.hunters[0].state === "CHASE", 900)) return true;
    }
    return false;
  };
  /**
   * The danger tint frame by frame for `ms`, read inside the page (a round trip per reading is too coarse to see a 0.9s pulse).
   * A chasing Hunter stays in CHASE for 2s after she is out of sight, and the tint only depends on its state and how far away it is,
   * so once she is teleported far from it (well past the 420px where the cue stops growing) the level is constant: any change
   * in the tint over that stretch is the pulse, not the Hunter moving.
   */
  type TintSample = { t: number; alpha: number; state: string };
  const sampleTint = (page: Page, ms: number) =>
    page.evaluate(
      (duration) =>
        new Promise<TintSample[]>((resolve) => {
          const out: TintSample[] = [];
          const t0 = performance.now();
          const step = () => {
            const snapshot = (window as any).__RAREWILD_TEST__.snapshot();
            const t = performance.now() - t0;
            out.push({ t, alpha: snapshot.feedback.edgeAlpha, state: snapshot.hunters[0].state });
            if (t < duration) requestAnimationFrame(step);
            else resolve(out);
          };
          requestAnimationFrame(step);
        }),
      ms,
    );
  /** The tint from `fromMs` on (after its ease-in): how many frames, whether every one of them had the Hunter chasing, and its lowest and highest value. */
  const settledTint = (samples: TintSample[], fromMs: number) => {
    const later = samples.filter((p) => p.t >= fromMs);
    const alphas = later.map((p) => p.alpha);
    return { frames: later.length, allChasing: later.every((p) => p.state === "CHASE"), min: Math.min(...alphas), max: Math.max(...alphas) };
  };
  /** Chase her, then get her far away while the Hunter is still chasing: the reading window above. */
  const farChaseTint = async (page: Page, y: number, farX: number) => {
    await until(page, (x) => x.hunters[0].state === "CHASE", 1500);
    await place(page, farX, y);
    return settledTint(await sampleTint(page, 1200), 400);
  };
  await clickButton(fb, "PLAY");
  await until(fb, (x) => x.phase === "PLAYING", 2000);
  await wait(fb, 1500);
  s = await snap(fb);
  const objectsAtRest = s.feedback.sceneObjects;
  check("F1. at rest nothing is showing: no effect alive, no screen-edge tint, no camera shake, and no Hunter is aware of her", s.feedback.active === 0 && s.feedback.edgeAlpha === 0 && s.feedback.glowAlpha === 0 && !s.feedback.shaking && !s.feedback.flashing && s.hunters.every((h) => h.state !== "ALERT" && h.state !== "CHASE"), JSON.stringify(s.feedback));

  // F2-F3. Pickup: still counts exactly once; a sparkle burst and the pickup sound; then it cleans itself up.
  const pickups0 = s.feedback.sfx.pickup;
  await place(fb, items[0].x, items[0].y);
  const counted = await until(fb, (x) => x.collected === 1, 1500);
  const burst = await until(fb, (x) => x.feedback.active > 0, 400);
  s = await snap(fb);
  check("F2. picking up an item counts it once (1 / 12) and plays the sparkle burst and the pickup sound", counted && burst && s.collected === 1 && s.counterText === "COLLECTED: 1 / 12" && s.feedback.sfx.pickup === pickups0 + 1, `${s.counterText}, ${s.feedback.active} particles, pickup sounds ${s.feedback.sfx.pickup - pickups0}`);
  await wait(fb, 1500);
  s = await snap(fb);
  check("F3. the pickup effect cleans itself up (nothing alive, no extra scene objects) and standing on the spot does not collect it again", s.feedback.active === 0 && s.feedback.sceneObjects === objectsAtRest && s.collected === 1 && s.feedback.sfx.pickup === pickups0 + 1, `objects ${s.feedback.sceneObjects} vs ${objectsAtRest} at rest`);

  // F4-F6. Jump and landing: the same jump as before, with a dust puff and a sound at each end, and no effect on movement.
  await place(fb, fbStart.rara.x, fbY);
  await until(fb, (x) => x.rara.onFloor, 1500);
  await wait(fb, 600);
  const j0 = await snap(fb);
  await fb.keyboard.down("Space");
  const tookOff = await until(fb, (x) => !x.rara.onFloor && x.rara.vy < -100, 800);
  const puff = await until(fb, (x) => x.feedback.active > 0, 300);
  const atTop = await until(fb, (x) => !x.rara.onFloor && x.rara.vy >= 0, 1500);
  const apex = await snap(fb);
  await fb.keyboard.up("Space");
  const rise = fbY - apex.rara.y;
  check("F4. jumping plays a dust puff and the jump sound, and the jump is unchanged: it still rises about 134px (125..142) holding Space", tookOff && puff && atTop && rise > 125 && rise < 142 && apex.feedback.sfx.jump === j0.feedback.sfx.jump + 1, `rose ${rise.toFixed(0)}px, jump sounds ${apex.feedback.sfx.jump - j0.feedback.sfx.jump}`);
  const landedOk = await until(fb, (x) => x.rara.onFloor, 2500);
  const dustDown = await until(fb, (x) => x.feedback.active > 0, 250);
  s = await snap(fb);
  check("F5. landing after a full jump plays a dust puff and the landing sound, and puts her back exactly where she took off", landedOk && dustDown && s.feedback.sfx.land === j0.feedback.sfx.land + 1 && Math.abs(s.rara.y - fbY) < 1.5 && Math.abs(s.rara.x - fbStart.rara.x) < 1, `land sounds ${s.feedback.sfx.land - j0.feedback.sfx.land}, y ${s.rara.y.toFixed(1)} vs ${fbY.toFixed(1)}`);
  await wait(fb, 1200);
  const run0 = (await snap(fb)).rara.x;
  await fb.keyboard.down("ArrowRight");
  await wait(fb, 400);
  await fb.keyboard.up("ArrowRight");
  s = await snap(fb);
  check("F6. after the landing she moves as normal (running right covers 60px+ in 0.4s), and the jump and landing effects are gone without leaving scene objects behind", s.rara.x > run0 + 60 && s.feedback.active === 0 && s.feedback.sceneObjects === objectsAtRest, `moved ${(s.rara.x - run0).toFixed(0)}px, objects ${s.feedback.sceneObjects} vs ${objectsAtRest}`);

  // F7-F9. Danger: only once a Hunter has noticed her, subtle, and it never changes what the Hunter does.
  await place(fb, HUNTER_1_CLEAR_X - 400, fbY);
  await wait(fb, 1200);
  s = await snap(fb);
  check("F7. no danger cue while no Hunter is aware of her (a Hunter 600px away: no tint, no alert)", s.feedback.edgeAlpha === 0 && s.hunters[0].state !== "ALERT" && s.hunters[0].state !== "CHASE", `${s.hunters[0].state}, tint ${s.feedback.edgeAlpha.toFixed(2)}`);
  const danger0 = s.feedback.sfx.danger;
  const fbReacted = await provoke(fb, fbY);
  const tinted = await until(fb, (x) => x.feedback.edgeAlpha > 0.1, 1500);
  s = await snap(fb);
  check("F8. when the Hunter alerts / chases, the screen edge tints red (subtle: at most half) and the warning sound plays once", fbReacted && tinted && s.feedback.edgeAlpha <= 0.5 && s.feedback.sfx.danger === danger0 + 1, `${s.hunters[0].state}, tint ${s.feedback.edgeAlpha.toFixed(2)}, danger sounds ${s.feedback.sfx.danger - danger0}`);
  // F8b. The control for F19: with normal motion the same far-chase tint breathes with the heartbeat, so a flat reading really does mean "steady".
  const breathing = await farChaseTint(fb, fbY, fbStart.rara.x);
  check("F8b. with normal motion the danger tint breathes: over 0.8s of a constant-level chase it varies by more than 0.02 (so the steadiness check in F19 can tell the difference)", breathing.frames >= 8 && breathing.allChasing && breathing.max - breathing.min > 0.02, `${breathing.min.toFixed(3)} .. ${breathing.max.toFixed(3)} over ${breathing.frames} frames`);
  // Getting away ends it: far from the Hunter it gives up (LOST / PATROL) and the tint fades out by itself.
  await place(fb, fbStart.rara.x, fbY);
  const gaveUp = await until(fb, (x) => x.hunters[0].state !== "ALERT" && x.hunters[0].state !== "CHASE", 8000);
  const faded = await until(fb, (x) => x.feedback.edgeAlpha === 0 && x.feedback.active === 0, 2500);
  s = await snap(fb);
  check("F9. once she has got away and the Hunter stands down, the tint fades out completely (nothing keeps pulsing)", gaveUp && faded && s.phase === "PLAYING", `${s.hunters[0].state}, tint ${s.feedback.edgeAlpha.toFixed(2)}`);

  // F10-F12. Capture: the CAUGHT state and its screen are unchanged; a red pulse, a shake, and a sound mark the moment; then everything stops.
  const capture0 = s.feedback.sfx.capture;
  await provoke(fb, fbY);
  await place(fb, (await snap(fb)).hunters[0].x, fbY);
  const caughtNow = await until(fb, (x) => x.phase === "CAUGHT", 3000);
  const c0 = await snap(fb);
  check("F10. being caught still triggers CAUGHT, and the capture is marked: a red edge pulse, a camera shake and flash, the capture sound", caughtNow && c0.feedback.edgeAlpha > 0.3 && c0.feedback.shaking && c0.feedback.flashing && c0.feedback.sfx.capture === capture0 + 1, `pulse ${c0.feedback.edgeAlpha.toFixed(2)}, shake ${c0.feedback.shaking}, capture sounds ${c0.feedback.sfx.capture - capture0}`);
  check("    ...and the CAUGHT screen itself still appears and offers RESTART", (await until(fb, (x) => x.caughtVisible, 1000)) && (await rectOf(fb, "RESTART")) !== null);
  await wait(fb, 1200);
  s = await snap(fb);
  check("F11. the effects do not continue after CAUGHT: the pulse, the shake and the danger tint are all gone, and the timer is still stopped", s.phase === "CAUGHT" && s.feedback.active === 0 && s.feedback.edgeAlpha === 0 && !s.feedback.shaking && !s.feedback.flashing, JSON.stringify(s.feedback));

  // F12. Restart while an effect is still playing clears it: a pickup, then a capture, then R at once.
  await freshRun(fb);
  await place(fb, items[1].x, items[1].y);
  await until(fb, (x) => x.collected === 1, 1500);
  await place(fb, (await snap(fb)).hunters[0].x, fbY);
  await until(fb, (x) => x.phase === "CAUGHT", 3000);
  const pre = await snap(fb);
  await fb.keyboard.press("r");
  const backToReady = await until(fb, (x) => x.phase === "READY", 1500);
  s = await snap(fb);
  check("F12. restarting while an effect is still playing clears it at once: no tint, no particles, no shake, no leftovers (back on the start screen, 0 / 12)", pre.feedback.edgeAlpha > 0.2 && backToReady && s.feedback.active === 0 && s.feedback.edgeAlpha === 0 && !s.feedback.shaking && !s.feedback.flashing && s.collected === 0 && s.readyVisible, `before: tint ${pre.feedback.edgeAlpha.toFixed(2)}; after: ${JSON.stringify({ a: s.feedback.active, t: s.feedback.edgeAlpha, shake: s.feedback.shaking })}`);
  await wait(fb, 800);
  s = await snap(fb);
  check("    ...and they stay gone (nothing restarts by itself)", s.feedback.active === 0 && s.feedback.edgeAlpha === 0 && s.phase === "READY");

  // F13-F15. Level complete: a gold glow and sparkles and a chime; LEVEL COMPLETE unchanged; everything stops; restart clears it.
  const collectAll = async () => {
    for (let i = 0; i < items.length; i++) {
      await place(fb, items[i].x, items[i].y);
      await fb.waitForFunction((n) => (window as any).__RAREWILD_TEST__.snapshot().collected >= n, i + 1, { timeout: 1500 }).catch(() => undefined);
    }
  };
  await freshRun(fb);
  await collectAll();
  const complete0 = (await snap(fb)).feedback.sfx.complete;
  await place(fb, EXIT_SPEC.x, fbY);
  const finished = await until(fb, (x) => x.phase === "COMPLETE", 2500);
  const g0 = await snap(fb);
  check("F13. reaching the open exit still completes the level, with a gold glow, a sparkle burst and the completion sound", finished && g0.collected === 12 && g0.feedback.glowAlpha > 0.3 && g0.feedback.active > 0 && g0.feedback.sfx.complete === complete0 + 1, `glow ${g0.feedback.glowAlpha.toFixed(2)}, ${g0.feedback.active} alive, complete sounds ${g0.feedback.sfx.complete - complete0}`);
  check("    ...and the LEVEL COMPLETE screen still appears with PLAY AGAIN", (await until(fb, (x) => x.completeVisible, 2000)) && (await rectOf(fb, "PLAY AGAIN")) !== null);
  await wait(fb, 1600);
  s = await snap(fb);
  check("F14. the effects do not continue after LEVEL COMPLETE: the glow and sparkles are gone, no danger tint, the screen and the stopped timer are as before", s.phase === "COMPLETE" && s.completeVisible && s.feedback.active === 0 && s.feedback.glowAlpha === 0 && s.feedback.edgeAlpha === 0 && s.feedback.sceneObjects === objectsAtRest, `${JSON.stringify(s.feedback)} vs ${objectsAtRest} objects at rest`);
  await fb.keyboard.press("r");
  await until(fb, (x) => x.phase === "READY", 1500);
  await wait(fb, 700); // the start screen fades in before its PLAY button works
  await freshRun(fb);
  await collectAll();
  await place(fb, EXIT_SPEC.x, fbY);
  const glowing = await until(fb, (x) => x.phase === "COMPLETE" && x.feedback.glowAlpha > 0.3, 2500);
  const g1 = await snap(fb);
  await fb.keyboard.press("r");
  await until(fb, (x) => x.phase === "READY", 1500);
  s = await snap(fb);
  check("F15. restarting during the completion effect clears it at once (no glow, no sparkles), back on the start screen with the exit locked", g1.feedback.glowAlpha > 0.2 && s.phase === "READY" && s.feedback.glowAlpha === 0 && s.feedback.active === 0 && s.exitStatusText === "EXIT LOCKED" && s.readyVisible, `before: glow ${g1.feedback.glowAlpha.toFixed(2)} (${glowing ? "seen" : "not seen"}), ${g1.phase}, ${g1.collected}/12`);
  await fb.context().close();

  // F16-F19. Reduced motion (the browser's prefers-reduced-motion): no shake, no flash, no bursts or dust; state is still communicated.
  const calm = await openGame(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const calmStart = await snap(calm);
  const calmY = calmStart.rara.y;
  await clickButton(calm, "PLAY");
  await until(calm, (x) => x.phase === "PLAYING", 2000);
  s = await snap(calm);
  check("F16. the game reads the reduced-motion preference", s.feedback.reducedMotion === true);
  await place(calm, items[0].x, items[0].y);
  await until(calm, (x) => x.collected === 1, 1500);
  s = await snap(calm);
  check("F17. with reduced motion a pickup still counts and sounds, but there are no sparkles", s.collected === 1 && s.feedback.active === 0 && s.feedback.sfx.pickup >= 1);
  await place(calm, (await snap(calm)).rara.x, calmY);
  await until(calm, (x) => x.rara.onFloor, 1500);
  await wait(calm, 500);
  const calmJumps = (await snap(calm)).feedback.sfx.jump;
  await calm.keyboard.down("Space");
  await until(calm, (x) => !x.rara.onFloor, 800);
  await wait(calm, 120);
  s = await snap(calm);
  await calm.keyboard.up("Space");
  check("F18. ...and jumping raises no dust (the jump itself is unchanged, and still sounds)", s.feedback.active === 0 && !s.rara.onFloor && s.feedback.sfx.jump === calmJumps + 1);
  await until(calm, (x) => x.rara.onFloor, 2500);
  const calmReacted = await provoke(calm, calmY);
  const calmTint = await until(calm, (x) => x.feedback.edgeAlpha > 0.1, 1500);
  // Steady: the same tint on every frame of a 0.8s chase window (the level cannot change there, see sampleTint), and it is the reduced-motion value.
  const steady = await farChaseTint(calm, calmY, calmStart.rara.x);
  const steadyValue = dangerEdgeAlpha(dangerLevel([{ state: "CHASE", x: 1e6, caught: false }], 0), 0, true);
  const isSteady = steady.frames >= 8 && steady.allChasing && steady.max - steady.min < 0.002 && Math.abs(steady.min - steadyValue) < 0.01;
  await provoke(calm, calmY); // back into its sight for the capture below
  await place(calm, (await snap(calm)).hunters[0].x, calmY);
  await until(calm, (x) => x.phase === "CAUGHT", 3000);
  const cc = await snap(calm);
  check("F19. with reduced motion the danger is still shown as a steady tint (the same value on every frame of a 0.8s chase, no pulsing), and being caught still works with the red edge pulse but no camera shake or flash", calmReacted && calmTint && isSteady && cc.phase === "CAUGHT" && cc.feedback.edgeAlpha > 0.3 && !cc.feedback.shaking && !cc.feedback.flashing && (await until(calm, (x) => x.caughtVisible, 1000)), `tint ${steady.min.toFixed(4)} .. ${steady.max.toFixed(4)} over ${steady.frames} frames, expected ${steadyValue.toFixed(3)}`);
  await calm.context().close();

  // ============================================================================================================
  // Phones and desktop: multi-finger touch controls, volume that works on a phone, larger HUD text and controls on a
  // phone, and proof that desktop is untouched. "Phone" = a touch-emulated context (coarse pointer, no hover).
  // ============================================================================================================
  type Geo = Record<string, [number, number, number, number]>; // label -> [centre x, centre y, width, height], page px
  const HUD_LABELS = ["RAREWILD", "SAVE THE MANGROVE", "COLLECTED", "TIME:"] as const;
  const BUTTON_LABELS = ["←", "→", "SWING", "JUMP"] as const;
  // Recorded from the game BEFORE the phone changes (the same window sizes, mouse only): desktop must still match to the pixel.
  const DESKTOP_BEFORE: Record<string, Geo> = {
    "1280x720": { "RAREWILD": [640, 72, 242.4, 51.36], "SAVE THE MANGROVE": [640, 138, 294, 29.57], "COLLECTED": [640, 182.4, 274.8, 31.7], "TIME:": [552.4, 218.4, 146.4, 25.61], "←": [460, 612, 91.2, 75.75], "→": [592, 612, 91.2, 75.75], "SWING": [760, 612, 121.2, 72.64], "JUMP": [940, 612, 129.6, 72.77] },
    "1920x1080": { "RAREWILD": [960, 108, 363.6, 77.04], "SAVE THE MANGROVE": [960, 207, 441, 44.36], "COLLECTED": [960, 273.6, 412.2, 47.55], "TIME:": [828.6, 327.6, 219.6, 38.42], "←": [690, 918, 136.8, 113.63], "→": [888, 918, 136.8, 113.63], "SWING": [1140, 918, 181.8, 108.97], "JUMP": [1410, 918, 194.4, 109.16] },
    "1024x768": { "RAREWILD": [512, 76.8, 258.56, 54.78], "SAVE THE MANGROVE": [512, 147.2, 313.6, 31.55], "COLLECTED": [512, 194.56, 293.12, 33.82], "TIME:": [418.56, 232.96, 156.16, 27.32], "←": [320, 652.8, 97.28, 80.8], "→": [460.8, 652.8, 97.28, 80.8], "SWING": [640, 652.8, 129.28, 77.49], "JUMP": [832, 652.8, 138.24, 77.62] },
    // A narrow window driven by a mouse is still a desktop: it must keep the shrunken layout it always had.
    "390x844": { "RAREWILD": [195, 84.4, 98.48, 20.86], "SAVE THE MANGROVE": [195, 161.77, 119.44, 12.01], "COLLECTED": [195, 213.81, 111.64, 12.88], "TIME:": [159.41, 256.01, 59.47, 10.4], "←": [121.87, 717.4, 37.05, 30.77], "→": [175.5, 717.4, 37.05, 30.77], "SWING": [243.75, 717.4, 49.24, 29.51], "JUMP": [316.88, 717.4, 52.65, 29.56] },
  };
  // The same measurements on the phone-sized windows before the change, to compare the phone against.
  const PHONE_BEFORE: Record<string, Geo> = {
    "390x844": DESKTOP_BEFORE["390x844"],
    "320x568": { "RAREWILD": [160, 56.8, 80.8, 17.12], "SAVE THE MANGROVE": [160, 108.87, 98.0, 9.86], "COLLECTED": [160, 143.89, 91.6, 10.57], "TIME:": [130.8, 172.29, 48.8, 8.54], "←": [100.0, 482.8, 30.4, 25.25], "→": [144, 482.8, 30.4, 25.25], "SWING": [200, 482.8, 40.4, 24.21], "JUMP": [260, 482.8, 43.2, 24.26] },
    "360x740": { "RAREWILD": [180, 74, 90.9, 19.26], "SAVE THE MANGROVE": [180, 141.83, 110.25, 11.09], "COLLECTED": [180, 187.47, 103.05, 11.89], "TIME:": [147.15, 224.47, 54.9, 9.6], "←": [112.5, 629, 34.2, 28.41], "→": [162, 629, 34.2, 28.41], "SWING": [225, 629, 45.45, 27.24], "JUMP": [292.5, 629, 48.6, 27.29] },
    "430x932": { "RAREWILD": [215, 93.2, 108.58, 23.0], "SAVE THE MANGROVE": [215, 178.63, 131.69, 13.25], "COLLECTED": [215, 236.11, 123.09, 14.2], "TIME:": [175.76, 282.71, 65.58, 11.47], "←": [134.38, 792.2, 40.85, 33.93], "→": [193.5, 792.2, 40.85, 33.93], "SWING": [268.75, 792.2, 54.29, 32.54], "JUMP": [349.38, 792.2, 58.05, 32.6] },
    "844x390": { "RAREWILD": [422, 39, 131.3, 27.82], "SAVE THE MANGROVE": [422, 74.75, 159.25, 16.02], "COLLECTED": [422, 98.8, 148.85, 17.17], "TIME:": [374.55, 118.3, 79.3, 13.87], "←": [324.5, 331.5, 49.4, 41.03], "→": [396, 331.5, 49.4, 41.03], "SWING": [487, 331.5, 65.65, 39.35], "JUMP": [584.5, 331.5, 70.2, 39.42] },
    "667x375": { "RAREWILD": [333.5, 37.5, 126.25, 26.75], "SAVE THE MANGROVE": [333.5, 71.88, 153.12, 15.4], "COLLECTED": [333.5, 95, 143.12, 16.51], "TIME:": [287.88, 113.75, 76.25, 13.34], "←": [239.75, 318.75, 47.5, 39.45], "→": [308.5, 318.75, 47.5, 39.45], "SWING": [396, 318.75, 63.12, 37.84], "JUMP": [489.75, 318.75, 67.5, 37.9] },
  };
  const edges = (r: Rect) => ({ left: r.x - r.width / 2, right: r.x + r.width / 2, top: r.y - r.height / 2, bottom: r.y + r.height / 2 });
  const domRect = (page: Page, selector: string) =>
    page.evaluate((sel) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, selector);
  /** The [r, g, b] on screen at these CSS-px positions, read from a real screenshot (decoded inside the page with a canvas). */
  const pixelsAt = async (page: Page, points: [number, number][]) => {
    const base64 = Buffer.from(await page.screenshot({})).toString("base64");
    const rows = await page.evaluate(async ([data, pts]: [string, [number, number][]]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const k = img.width / window.innerWidth;
      return pts.map(([x, y]) => Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)));
    }, [base64, points] as [string, [number, number][]]);
    return rows as unknown as number[][]; // (evaluate's typing wraps the async result in one more Promise, which `await` has already unwrapped)
  };
  const wrapperTouchAction = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector("canvas")!.parentElement!).touchAction);
  const phoneOptions = (width: number, height: number) => ({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  // D1-D3. Desktop is untouched: the same layout to the pixel, the same input set-up, the original audio path.
  const desktopProblems: string[] = [];
  let desktopObjects = 0;
  for (const [size, before] of Object.entries(DESKTOP_BEFORE)) {
    const [w, h] = size.split("x").map(Number);
    const dsk = await openGame(browser, { viewport: { width: w, height: h } });
    const snapped = await snap(dsk);
    for (const label of [...HUD_LABELS, ...BUTTON_LABELS]) {
      const r = await rectOf(dsk, label);
      const want = before[label];
      if (!r || Math.abs(r.x - want[0]) > 0.05 || Math.abs(r.y - want[1]) > 0.05 || Math.abs(r.width - want[2]) > 0.05 || Math.abs(r.height - want[3]) > 0.05) desktopProblems.push(`${size} ${label}`);
    }
    if (snapped.touch.phone || snapped.touch.pointers !== 2 || (await wrapperTouchAction(dsk)) !== "auto") desktopProblems.push(`${size} input set-up`);
    // The camera: zoom is exactly window height / 600 (as before), it frames exactly the world's height (no empty strip), and it frames width / zoom of the world.
    if (size === "1280x720") desktopObjects = snapped.feedback.sceneObjects;
    const cam = snapped.viewport;
    if (cam.zoom !== h / 600 || cam.worldView.y !== 0 || Math.abs(cam.worldView.height - 600) > 1e-6 || Math.abs(cam.worldView.width - w / (h / 600)) > 1e-6) desktopProblems.push(`${size} camera (zoom ${cam.zoom}, view ${JSON.stringify(cam.worldView)})`);
    await dsk.context().close();
  }
  check("D1. desktop is unchanged: at four window sizes (a narrow mouse-driven window included) every HUD line and all four control buttons are where and as large as before the phone changes (to 0.05px), the camera zoom is exactly window height / 600 and frames exactly the world's height, and it is not treated as a phone", desktopProblems.length === 0, desktopProblems.join(", ") || "4 sizes x 8 items");

  const dsk = await openGame(browser, { viewport: { width: 1280, height: 720 } });
  await clickButton(dsk, "PLAY");
  await until(dsk, (x) => x.phase === "PLAYING", 2000);
  await until(dsk, (x) => x.audio.playing, 4000);
  let da = (await snap(dsk)).audio;
  check("D2. desktop audio is unchanged: the music element's own volume is the control (no gain node, no phone routing), and the effects use the original curve", !da.routed && da.gain === null && da.elementVolume !== null && Math.abs(da.elementVolume - 0.22) < 0.001 && Math.abs(da.sfxLevel - (0.16 + 0.34 * 0.22)) < 1e-9, JSON.stringify(da));
  const dSlider = await domRect(dsk, "input[type=range]");
  await dsk.mouse.click(dSlider.left + dSlider.width * 0.75, dSlider.top + dSlider.height / 2);
  da = (await snap(dsk)).audio;
  check("    ...and moving the slider with the mouse still sets that element volume directly (and the effects level with the original formula)", !da.routed && da.elementVolume !== null && da.elementVolume > 0.6 && da.elementVolume < 0.9 && Math.abs(da.sfxLevel - (0.16 + 0.34 * da.elementVolume)) < 1e-9, `element volume ${da.elementVolume}`);
  const dMute = await domRect(dsk, "[data-testid=music-control] button");
  await dsk.mouse.click(dMute.left + dMute.width / 2, dMute.top + dMute.height / 2);
  da = (await snap(dsk)).audio;
  check("    ...and mute still mutes the element and silences the effects", da.elementMuted === true && da.sfxLevel === 0 && !da.routed);
  await dsk.context().close();

  // P1-P9. Phone layout, at six phone-sized windows (portrait and landscape).
  const layoutProblems: Record<string, string[]> = {};
  const note = (key: string, size: string) => (layoutProblems[key] ??= []).push(size);
  const measured: Record<string, string> = {};
  let phoneObjects = 0;
  // The four buttons on the 800x600 design frame (matches scripts/mobile/validate-mobile.ts): used below, via the same shared
  // sizing `layoutTouchControls` itself starts from, to compute what a single centred row would sit at TODAY, at this exact
  // width and height (button sizes and the ground-line / volume-control clamps all included) — the reference for "lifted".
  const ROW_DESIGN: DesignButton[] = [
    { id: "left", x: 250, y: 510, width: 76, height: 63.1 },
    { id: "right", x: 360, y: 510, width: 76, height: 63.1 },
    { id: "swing", x: 500, y: 510, width: 101, height: 60.5 },
    { id: "jump", x: 650, y: 510, width: 108, height: 60.6 },
  ];
  const singleRowY = (width: number, height: number) => singleRowLayout({ width, height, zoom: height / 600, designHeight: 600, groundDesignY: GROUND_SURFACE_Y }, ROW_DESIGN).rowCentre;
  for (const [w, h] of [[390, 844], [360, 740], [430, 932], [320, 568], [844, 390], [667, 375]] as const) {
    const size = `${w}x${h}`;
    const ph = await openGame(browser, phoneOptions(w, h));
    await wait(ph, 300);
    const cam = (await snap(ph)).viewport;
    const zoom = cam.zoom;
    const rect: Record<string, Rect> = {};
    for (const label of [...HUD_LABELS, ...BUTTON_LABELS, "EXIT", "Collect all"]) rect[label] = (await rectOf(ph, label))!;
    const music = await domRect(ph, "[data-testid=music-control]");
    const before = PHONE_BEFORE[size];
    const b = BUTTON_LABELS.map((l) => edges(rect[l]));
    const left = Math.min(...b.map((e) => e.left));
    const right = Math.max(...b.map((e) => e.right));
    const gap = rect["→"].x - rect["←"].x;
    // The arrangement: same order and everything at the same height, always. Portrait keeps the single centred row exactly as
    // it was; landscape splits into two groups (<-/-> toward the left edge, SWING/JUMP toward the right), each keeping its own
    // exact design-frame spacing, with a clearly larger gap between the groups than either group's own internal gap.
    if (!(rect["←"].x < rect["→"].x && rect["→"].x < rect["SWING"].x && rect["SWING"].x < rect["JUMP"].x) || BUTTON_LABELS.some((l) => Math.abs(rect[l].y - rect["←"].y) > 0.5)) note("order", size);
    if (Math.abs((rect["JUMP"].x - rect["SWING"].x) / gap - 150 / 110) > 0.02) note("spacing", size);
    const rightMarginPx = w - right;
    if (w > h) {
      const innerLeft = b[1].left - b[0].right;
      const innerRight = b[3].left - b[2].right;
      const midGap = b[2].left - b[1].right;
      if (midGap < 3 * Math.max(innerLeft, innerRight, 8)) note("group gap", size);
      // Both groups sit at or above where a single centred row would rest today at this height (its own ground-line safety
      // clamp included): lifted when there is room to, and never lower than that reference even where there is not.
      const singleRow = singleRowY(w, h);
      if (rect["←"].y > singleRow + 0.5) note("lifted", `${size} (${rect["←"].y.toFixed(1)} vs single-row ${singleRow.toFixed(1)})`);
      if (left < 14 - 0.5 || left < 0.06 * w - 1) note("margins", size);
      // SWING/JUMP's own right margin is now the same standard comfortable margin LEFT+RIGHT's left margin uses: the volume
      // control moves to the top-left corner in landscape (see MusicControl.tsx), so there is no bottom-right obstacle here
      // to keep clear of any more.
      if (Math.abs(rightMarginPx - controlSideMargin(w)) > 1) note("margins", size);
    } else {
      if (Math.abs((rect["SWING"].x - rect["→"].x) / gap - 140 / 110) > 0.02) note("spacing", size);
      if (Math.abs(left - rightMarginPx) > 1) note("centred", size);
      if (left < 14 || left < 0.06 * w - 1) note("margins", size);
    }
    if (b.some((e) => e.left < 0 || e.right > w || e.bottom > h - 10)) note("on screen", size);
    if (b.some((e, i) => i > 0 && e.left - b[i - 1].right < 8)) note("spacing between", size);
    // Not covering the play area: below the ground line (Rara's feet), and clear of the volume control (wherever that
    // corner is: bottom-right in portrait, top-left in landscape — a real rectangle-overlap test, not a corner-specific one).
    const groundLine = (GROUND_SURFACE_Y - cam.worldView.y) * zoom; // where Rara's feet are on screen, from the camera's own view of the world
    if (b.some((e) => e.top < groundLine + 1)) note("below the ground line", size);
    if (b.some((e) => !(e.right <= music.left || e.left >= music.right || e.bottom <= music.top || e.top >= music.bottom))) note("clear of the volume control", size);
    // The volume control itself: top-left corner in landscape (clear of the timer, which shares the subtitle's row there),
    // bottom-right corner everywhere else (unchanged).
    if (w > h) {
      if (music.left > 20 || music.top > 20) note("volume top-left", size);
      if (!(music.bottom <= edges(rect["TIME:"]).top || music.top >= edges(rect["TIME:"]).bottom || music.right <= edges(rect["TIME:"]).left || music.left >= edges(rect["TIME:"]).right)) note("volume clear of timer", size);
    } else if (music.right < w - 20 || music.bottom < h - 20) {
      note("volume bottom-right", size);
    }
    if (size === "390x844") phoneObjects = (await snap(ph)).feedback.sceneObjects;
    // No empty band: the screen's bottom edge (away from the volume control and the dev badge) is soil, not the dark-green void colour.
    // Only checked in landscape: a portrait phone now shows the rotate overlay on top of the game (see the ROT checks below), which
    // paints over this same pixel on purpose, so a screenshot there is not testing the ground extension any more.
    if (w > h) {
      const bottom = await pixelsAt(ph, [[0.12 * w, h - 2], [0.3 * w, h - 2], [0.5 * w, h - 2]]);
      const soil = bottom.filter(([r, g, b]) => r >= g && !(Math.abs(r - 16) <= 8 && Math.abs(g - 37) <= 8 && Math.abs(b - 29) <= 8)).length;
      if (soil < 2) note("no empty band", `${size} (${bottom.map((p) => `rgb(${p})`).join(" ")})`);
    }
    // The camera: exactly 1 (matches the window-height zoom precisely, the same framing desktop uses), so no extra width or height is shown.
    const oldZoom = h / 600;
    if (Math.abs(zoom - MOBILE_CAMERA_ZOOM_FACTOR * oldZoom) > 1e-9) note("camera zoom", `${size} (${zoom.toFixed(4)})`);
    if (Math.abs(cam.worldView.width / (w / oldZoom) - 1 / MOBILE_CAMERA_ZOOM_FACTOR) > 1e-6) note("more world visible", size);
    if (Math.abs(600 * zoom - h) > 1e-6 || Math.abs(cam.worldView.y) > 1e-6 || Math.abs(cam.worldView.height - 600) > 1e-6) note("world framing", size);
    // Larger than before.
    const grew = rect["←"].height / before["←"][3];
    if (h > w ? grew < 1.35 : w >= 700 ? grew < 1.3 : grew < 1.1) note("larger buttons", size);
    // HUD lines: larger by a moderate amount, same anchor points, no overlaps, hierarchy kept.
    for (const label of ["SAVE THE MANGROVE", "COLLECTED", "TIME:"] as const) {
      const ratio = rect[label].height / before[label][3];
      if (ratio < 1.18 || ratio > 1.32) note(`text size ${label}`, `${size} (${ratio.toFixed(2)}x)`);
    }
    if (Math.abs(rect["RAREWILD"].x - before["RAREWILD"][0]) > 0.5 || Math.abs(rect["RAREWILD"].height - before["RAREWILD"][3]) > 0.1) note("title unchanged", size);
    if (["SAVE THE MANGROVE", "COLLECTED"].some((l) => Math.abs(rect[l].x - before[l][0]) > 0.5 || Math.abs(rect[l].y - before[l][1]) > 0.5)) note("HUD positions kept", size);
    if (w > h) {
      // Landscape: the timer sits near the subtitle's row (LANDSCAPE_TIMER_DROP_PX = 8 CSS px below it, see Game.tsx) and near
      // the left edge (the standard comfortable margin), to the left of "SAVE THE MANGROVE" (which itself has not moved,
      // checked above), instead of pairing with the exit status.
      const LANDSCAPE_TIMER_DROP_PX = 8;
      const timerLeft = edges(rect["TIME:"]).left;
      if (Math.abs(rect["TIME:"].y - (rect["SAVE THE MANGROVE"].y + LANDSCAPE_TIMER_DROP_PX)) > 0.5) note("timer row", size);
      if (Math.abs(timerLeft - controlSideMargin(w)) > 1) note("timer left edge", size);
      if (edges(rect["TIME:"]).right >= rect["SAVE THE MANGROVE"].x - rect["SAVE THE MANGROVE"].width / 2) note("timer left of subtitle", size);
    } else if (Math.abs(edges(rect["TIME:"]).right - (before["TIME:"][0] + before["TIME:"][2] / 2)) > 0.7) note("timer anchor kept", size);
    // SAVE THE MANGROVE / COLLECTED / (in portrait) TIME stack vertically with no overlap; in landscape TIME has moved off that
    // stack entirely (checked separately above), so it is compared against the start panel instead, the same as the others.
    const hud = w > h ? [rect["SAVE THE MANGROVE"], rect["COLLECTED"]].map(edges) : [rect["SAVE THE MANGROVE"], rect["COLLECTED"], rect["TIME:"]].map(edges);
    const stacked = w > h ? hud[0].bottom > hud[1].top : hud[0].bottom > hud[1].top || hud[1].bottom > hud[2].top || edges(rect["TIME:"]).right >= edges(rect["EXIT"]).left;
    if (stacked || hud.at(-1)!.bottom > edges(rect["Collect all"]).top || edges(rect["TIME:"]).bottom > edges(rect["Collect all"]).top) note("HUD overlaps", size);
    if (hud.some((e) => e.left < 0 || e.right > w) || edges(rect["EXIT"]).right > w) note("HUD on screen", size);
    if (rect["RAREWILD"].height <= rect["SAVE THE MANGROVE"].height) note("hierarchy", size);
    // The volume control keeps a usable size: 28px+ button, 24px+ slider row.
    const mute = await domRect(ph, "[data-testid=music-control] button");
    const slider = await domRect(ph, "input[type=range]");
    if (mute.width < 28 || mute.height < 28 || slider.height < 24) note("volume control size", size);
    measured[size] = `buttons ${rect["←"].height.toFixed(0)}px (${grew.toFixed(2)}x), margins ${left.toFixed(0)}/${(w - right).toFixed(0)}`;
    await ph.context().close();
  }
  const layoutCheck = (label: string, keys: string[]) => {
    const failed = keys.flatMap((k) => (layoutProblems[k] ?? []).map((s) => `${k}@${s}`));
    check(label, failed.length === 0, failed.join(", ") || "6 phone sizes");
  };
  layoutCheck("P1. phone controls keep the existing arrangement: same order (left, right, swing, jump), everything at one height, same spacing proportions within each pair", ["order", "spacing"]);
  layoutCheck("P2. ...and it keeps clear of the edges (14px+, 6%+ of the width, on each side), fully on screen, with 8px+ between buttons", ["margins", "on screen", "spacing between"]);
  layoutCheck("P2b. in portrait, the four buttons stay one centred row, with equal margins to the left and the right (within 1px)", ["centred"]);
  layoutCheck("P3. ...and the buttons are LARGER than before (1.35x+ on portrait phones, 1.3x+ on landscape phones 700px+ wide, 1.1x+ on the smallest)", ["larger buttons"]);
  layoutCheck("P8. in landscape, LEFT+RIGHT and SWING+JUMP form two clearly separated groups: the gap between them is at least 3x either group's own internal spacing", ["group gap"]);
  layoutCheck("P9. in landscape, both groups sit at or above where a single centred row would rest today at that height (lifted when there is room; never pushed lower than that safety-clamped reference where there is not)", ["lifted"]);
  layoutCheck("P10. in landscape, the timer sits just below SAVE THE MANGROVE's row and to its left, near the left edge, instead of pairing with the exit status", ["timer row", "timer left edge", "timer left of subtitle"]);
  layoutCheck("P11. the volume control moves to the top-left corner in landscape only (clear of the timer there); portrait keeps it bottom-right", ["volume top-left", "volume clear of timer", "volume bottom-right"]);
  layoutCheck("C1. phone camera: the zoom is exactly 1x the window-height zoom (matches desktop's framing) at all six phone sizes, and desktop's own zoom is untouched (D1)", ["camera zoom"]);
  layoutCheck("C4. no empty band: at the two landscape phone sizes in this set (the ones a player actually plays on, now that portrait shows the rotate overlay) the bottom edge of the screen is brown soil, never the dark-green void or black", ["no empty band"]);
  check("C5. a phone adds exactly one thing to the scene for that (the ground extension); desktop adds nothing", phoneObjects === desktopObjects + 1, `${phoneObjects} objects on a phone vs ${desktopObjects} on desktop`);
  layoutCheck("C2. ...so the phone frames exactly as much of the world as desktop does at that height (no extra width, no shrinking below 100% of the window height), anchored to the top of the screen", ["more world visible", "world framing"]);
  layoutCheck("P4. ...without covering the game: every button is below the ground line where Rara stands, and clear of the volume control", ["below the ground line", "clear of the volume control"]);
  layoutCheck("P5. phone HUD: SAVE THE MANGROVE, COLLECTED and TIME are each 1.18x-1.32x larger than before (moderate), and the title, positions and anchors are exactly as before", ["text size SAVE THE MANGROVE", "text size COLLECTED", "text size TIME:", "title unchanged", "HUD positions kept", "timer anchor kept"]);
  layoutCheck("P6. ...and it stays readable: no line overlaps another or the exit status or the start panel, everything is on screen, and the title is still the largest", ["HUD overlaps", "HUD on screen", "hierarchy"]);
  layoutCheck("P7. the volume control has phone-sized touch targets (28px+ mute button, 24px+ slider row)", ["volume control size"]);
  check("    measured: " + Object.entries(measured).map(([k, v]) => `${k}: ${v}`).join(" | "), true);

  // T. Touch controls: real multi-finger input, sent to Chrome as separate touch points.
  const ph = await openGame(browser, phoneOptions(390, 844));
  const cdp = (await (ph.context() as any).newCDPSession(ph)) as { send(method: string, params?: object): Promise<unknown> };
  type Finger = { id: number; x: number; y: number };
  // Chrome's touch protocol: touchStart / touchMove list EVERY finger that is down; touchEnd lists the fingers being RELEASED
  // (an empty list releases all of them); and it refuses a touchEnd when no finger is down.
  const down = new Set<number>();
  const touch = async (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: Finger[]) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    if (type === "touchStart" || type === "touchMove") {
      down.clear();
      for (const p of points) down.add(p.id);
    } else if (type === "touchCancel" || points.length === 0) down.clear();
    else for (const p of points) down.delete(p.id);
  };
  const lift = (...fingers: Finger[]) => touch("touchEnd", fingers);
  const liftAll = async () => {
    if (down.size > 0) await touch("touchEnd", []);
  };
  const phY = (await snap(ph)).rara.y;
  s = await snap(ph);
  check("T1. on a phone the game asks for four touch pointers (Phaser starts with one) and knows it is on a phone", s.touch.phone && s.touch.pointers >= 5 && (await wrapperTouchAction(ph)) === "none", `phone ${s.touch.phone}, ${s.touch.pointers} pointers (mouse + touches), touch-action ${await wrapperTouchAction(ph)}`);
  await touch("touchStart", [{ id: 9, x: 195, y: 10 }]); // any first touch counts as the user gesture that starts the audio; nothing is under it
  await liftAll();
  const playBtn = (await rectOf(ph, "PLAY"))!;
  await ph.touchscreen.tap(playBtn.x, playBtn.y);
  await until(ph, (x) => x.phase === "PLAYING", 2000);
  const [bL, bR, bS, bJ] = [(await rectOf(ph, "←"))!, (await rectOf(ph, "→"))!, (await rectOf(ph, "SWING"))!, (await rectOf(ph, "JUMP"))!];
  const F = { L: { id: 1, x: bL.x, y: bL.y }, R: { id: 2, x: bR.x, y: bR.y }, S: { id: 3, x: bS.x, y: bS.y }, J: { id: 4, x: bJ.x, y: bJ.y } };
  const settle = async (x: number) => {
    await liftAll();
    await place(ph, x, phY);
    await until(ph, (v) => v.rara.onFloor && Math.abs(v.rara.vx) < 5 && !v.touch.held.left && !v.touch.held.right && !v.touch.held.jump, 3000);
  };

  // C3. Rara is centred in the frame and fully visible, and there is more room ahead of her than before.
  const cv = (await snap(ph)).viewport;
  const rs = (await snap(ph)).rara;
  const screenX = (rs.x - cv.worldView.x) * cv.zoom;
  const roomAhead = cv.worldView.x + cv.worldView.width - rs.x;
  const roomBefore = (cv.width / (cv.height / 600)) / 2; // half the width the camera framed before this change
  check("C3. on a phone Rara stays centred (within 2px of the middle of the screen), her whole body is in view, and she sees exactly as far ahead as before any phone-specific camera zoom was applied (matching desktop's framing at 1x)", Math.abs(screenX - cv.width / 2) < 2 && rs.y - 52.5 >= cv.worldView.y && rs.y + 52.5 <= cv.worldView.y + cv.worldView.height && Math.abs(roomAhead / roomBefore - 1 / MOBILE_CAMERA_ZOOM_FACTOR) < 0.005, `centre ${screenX.toFixed(1)} of ${cv.width}, room ahead ${roomAhead.toFixed(0)}px vs ${roomBefore.toFixed(0)}px before`);

  // T2. RIGHT + JUMP: run while jumping, release JUMP and keep running, release RIGHT and stop.
  await settle(1200);
  await touch("touchStart", [F.R]);
  const running = await until(ph, (x) => x.rara.vx > 300, 1500);
  await touch("touchStart", [F.R, F.J]);
  const jumped = await until(ph, (x) => !x.rara.onFloor && x.rara.vy < -100, 800);
  const midAir = await snap(ph);
  await wait(ph, 150);
  const midAir2 = await snap(ph);
  check("T2. RIGHT + JUMP held together: she jumps and keeps running right while she is in the air (both buttons held, moving 40px+ in 150ms)", running && jumped && midAir.touch.held.right && midAir.touch.held.jump && !midAir2.rara.onFloor && midAir2.rara.x > midAir.rara.x + 40 && midAir2.rara.vx > 300, `held ${JSON.stringify(midAir.touch.held)}, moved ${(midAir2.rara.x - midAir.rara.x).toFixed(0)}px in the air`);
  await lift(F.J); // JUMP lifts, RIGHT stays down
  const afterJumpUp = await snap(ph);
  await wait(ph, 200);
  const afterJumpUp2 = await snap(ph);
  check("T3. releasing JUMP does not release RIGHT: RIGHT stays held and she keeps running right", afterJumpUp.touch.held.right && !afterJumpUp.touch.held.jump && afterJumpUp2.touch.held.right && afterJumpUp2.rara.x > afterJumpUp.rara.x + 40 && afterJumpUp2.rara.vx > 300, `held ${JSON.stringify(afterJumpUp2.touch.held)}, moved ${(afterJumpUp2.rara.x - afterJumpUp.rara.x).toFixed(0)}px`);
  await liftAll();
  const stopped = await until(ph, (x) => !x.touch.held.right && Math.abs(x.rara.vx) < 20, 1500);
  check("    ...and releasing RIGHT then stops her", stopped);

  // T4-T5. LEFT + JUMP, and releasing LEFT while JUMP stays down.
  await settle(1700);
  await touch("touchStart", [F.L]);
  const runningLeft = await until(ph, (x) => x.rara.vx < -300, 1500);
  await touch("touchStart", [F.L, F.J]);
  const jumpedLeft = await until(ph, (x) => !x.rara.onFloor && x.rara.vy < -100, 800);
  const l1 = await snap(ph);
  await wait(ph, 150);
  const l2 = await snap(ph);
  check("T4. LEFT + JUMP held together: she jumps and keeps running left while she is in the air", runningLeft && jumpedLeft && l1.touch.held.left && l1.touch.held.jump && !l2.rara.onFloor && l2.rara.x < l1.rara.x - 40 && l2.rara.vx < -300, `held ${JSON.stringify(l1.touch.held)}, moved ${(l2.rara.x - l1.rara.x).toFixed(0)}px in the air`);
  await lift(F.L); // LEFT lifts, JUMP stays down
  const leftUp = await snap(ph);
  const leftStopped = await until(ph, (x) => Math.abs(x.rara.vx) < 20 || x.rara.onFloor && Math.abs(x.rara.vx) < 60, 1500);
  const leftUp2 = await snap(ph);
  check("T5. releasing LEFT does not release JUMP: JUMP stays held, LEFT is released and her run slows to a stop", !leftUp.touch.held.left && leftUp.touch.held.jump && leftUp2.touch.held.jump && !leftUp2.touch.held.left && leftStopped, `held ${JSON.stringify(leftUp2.touch.held)}, vx ${leftUp2.rara.vx.toFixed(0)}`);
  await liftAll();
  check("    ...and releasing the last finger releases everything", await until(ph, (x) => !x.touch.held.left && !x.touch.held.right && !x.touch.held.jump, 1000));

  // T6. Several buttons at once: three fingers, then all four; one finger lifting never drops the others.
  await settle(1200);
  await touch("touchStart", [F.R]);
  await touch("touchStart", [F.R, F.J]);
  await touch("touchStart", [F.R, F.J, F.S]);
  const three = await snap(ph);
  await lift(F.S); // SWING lifts
  const twoLeft = await snap(ph);
  await touch("touchStart", [F.R, F.J, F.L]);
  await touch("touchStart", [F.R, F.J, F.L, F.S]);
  const four = await snap(ph);
  check("T6. several fingers at once: RIGHT + JUMP + SWING are all accepted, lifting SWING leaves RIGHT and JUMP held, and with four fingers down LEFT, RIGHT and JUMP are all held", three.touch.held.right && three.touch.held.jump && twoLeft.touch.held.right && twoLeft.touch.held.jump && four.touch.held.left && four.touch.held.right && four.touch.held.jump, `three ${JSON.stringify(three.touch.held)}, after SWING lifts ${JSON.stringify(twoLeft.touch.held)}, four ${JSON.stringify(four.touch.held)}`);
  await lift(F.L); // LEFT lifts
  const leftOnly = await snap(ph);
  check("    ...and lifting one of four leaves the other three held", !leftOnly.touch.held.left && leftOnly.touch.held.right && leftOnly.touch.held.jump);
  await liftAll();

  // T7. A finger sliding off its button lets go of it, and only of it.
  await settle(1200);
  await touch("touchStart", [F.R]);
  await touch("touchStart", [F.R, F.J]);
  await touch("touchMove", [{ id: F.R.id, x: 30, y: 300 }, F.J]); // RIGHT's finger drags well away from the buttons
  const slid = await until(ph, (x) => !x.touch.held.right && x.touch.held.jump, 1000);
  check("T7. a finger that slides off RIGHT releases RIGHT; the finger on JUMP is unaffected", slid);
  await liftAll();

  // T8. A cancelled touch (a system gesture) cannot leave a button stuck on.
  await settle(1200);
  await touch("touchStart", [F.R, F.J]);
  const heldBefore = await until(ph, (x) => x.touch.held.right && x.touch.held.jump, 1000);
  await touch("touchCancel", []);
  const cleared = await until(ph, (x) => !x.touch.held.right && !x.touch.held.jump, 1500);
  check("T8. if the browser cancels the touches (a system gesture) nothing is left stuck: both buttons are released", heldBefore && cleared);
  await liftAll();

  // T9. The invisible touch area around a button: a touch just above JUMP's drawn top edge still holds it (48px-tall targets).
  await settle(1200);
  const jumpEdge = edges((await rectOf(ph, "JUMP"))!);
  await touch("touchStart", [{ id: 5, x: bJ.x, y: jumpEdge.top - 1.5 }]);
  const padHeld = await until(ph, (x) => x.touch.held.jump, 800);
  await liftAll();
  check("T9. a touch 1.5px above JUMP's drawn edge still presses it (the touch area is taller than the drawn button)", padHeld);

  // T10. Keyboard and mouse still work on the phone-sized page, and a mouse press is not mixed up with the fingers.
  await settle(1200);
  const kx = (await snap(ph)).rara.x;
  await ph.keyboard.down("ArrowRight");
  await wait(ph, 400);
  await ph.keyboard.up("ArrowRight");
  check("T10. the keyboard still moves her on this page (keyboard controls are untouched)", (await snap(ph)).rara.x > kx + 60);

  // V. Volume on a phone: the music and the effects follow the slider and mute.
  await settle(1200);
  await until(ph, (x) => x.audio.playing, 4000);
  let a = (await snap(ph)).audio;
  check("V1. on a phone the music plays through a gain node on the shared audio context (so the slider works on iOS, which ignores element volume), and the context is running", a.routed && a.contextState === "running" && a.gain !== null && Math.abs(a.gain - 0.22) < 0.001 && a.elementVolume === 1, JSON.stringify(a));
  check("    ...and it is actually playing, with the effects level following the slider", a.playing && Math.abs(a.sfxLevel - sfxLevel(0.22, false, true)) < 1e-9, `${a.playing ? "playing" : "NOT playing"}, effects level ${a.sfxLevel.toFixed(3)}`);
  const slider = await domRect(ph, "input[type=range]");
  const levels: { at: number; gain: number; sfx: number }[] = [];
  for (const at of [0.2, 0.5, 0.9]) {
    await ph.touchscreen.tap(slider.left + slider.width * at, slider.top + slider.height / 2);
    await wait(ph, 100);
    const now = (await snap(ph)).audio;
    levels.push({ at, gain: now.gain ?? -1, sfx: now.sfxLevel });
  }
  check("V2. dragging the slider changes the music volume: tapping at 20%, 50% and 90% of it gives a rising gain close to the position (the element itself stays at full volume)", levels.every((l, i) => l.gain > 0 && Math.abs(l.gain - l.at) < 0.13 && (i === 0 || l.gain > levels[i - 1].gain)), levels.map((l) => `${l.at * 100}% -> ${l.gain.toFixed(2)}`).join(", "));
  check("V3. ...and the sound effects follow the slider too: their level rises at every step and is exactly the phone curve for that volume", levels.every((l, i) => Math.abs(l.sfx - sfxLevel(l.gain, false, true)) < 1e-4 && (i === 0 || l.sfx > levels[i - 1].sfx)), levels.map((l) => l.sfx.toFixed(3)).join(" < "));
  const volumeBefore = levels[2].gain;
  const muteBtn = await domRect(ph, "[data-testid=music-control] button");
  await ph.touchscreen.tap(muteBtn.left + muteBtn.width / 2, muteBtn.top + muteBtn.height / 2);
  await wait(ph, 100);
  a = (await snap(ph)).audio;
  check("V4. mute silences the music (gain 0, element muted) and the effects", a.gain === 0 && a.elementMuted === true && a.sfxLevel === 0, `gain ${a.gain}, muted ${a.elementMuted}, effects ${a.sfxLevel}`);
  await ph.touchscreen.tap(muteBtn.left + muteBtn.width / 2, muteBtn.top + muteBtn.height / 2);
  await wait(ph, 100);
  a = (await snap(ph)).audio;
  check("V5. unmute brings both back at the volume they had", a.gain !== null && Math.abs(a.gain - volumeBefore) < 0.001 && a.elementMuted === false && a.sfxLevel > 0 && a.playing, `gain ${a.gain} (was ${volumeBefore.toFixed(2)}), playing ${a.playing}`);
  const jumps0 = (await snap(ph)).feedback.sfx.jump;
  await touch("touchStart", [F.J]);
  await wait(ph, 200);
  await liftAll();
  check("    ...and gameplay sounds still fire on a phone (a JUMP touch triggers the jump effect)", (await snap(ph)).feedback.sfx.jump === jumps0 + 1);
  await ph.context().close();

  // ============================================================================================================
  // Rendering quality on phones: a canvas with one pixel per device pixel, art and text drawn with enough pixels for the camera's
  // magnification, and no seams that only show at full resolution. Measured on real screenshots and on every object in the scene.
  // ============================================================================================================
  type RenderAuditData = { renderScale: number; canvas: { width: number; height: number; cssWidth: number; cssHeight: number }; cameraZoom: number; textureScale: number; counts: Record<string, number>; entries: { kind: string; name: string; magnification: number }[]; textureMB: number };
  const audit = (page: Page) => page.evaluate(() => (window as any).__RAREWILD_TEST__.renderAudit()) as Promise<RenderAuditData>;
  const deviceOptions = (width: number, height: number, dpr: number) => ({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });

  /**
   * Sharpness of what is really on screen, in DEVICE pixels, from a screenshot: how many pixels a button / panel edge takes to go from
   * 10% to 90% of its step (about 1 when crisp, about the stretch factor when a small canvas is blown up), and how steep the steepest
   * text edges are relative to the text's contrast (higher is crisper). `points` are CSS-px positions of edges to sample.
   */
  type EdgeQuery = { name: string; x: number; y: number; horizontal: boolean };
  type TextQuery = { name: string; x: number; y: number; width: number; height: number };
  const measureSharpness = async (page: Page, dpr: number, edgeQueries: EdgeQuery[], textQueries: TextQuery[]) => {
    const base64 = Buffer.from(await page.screenshot({})).toString("base64");
    return (await page.evaluate(async ([data, dpr, edges, texts]: [string, number, EdgeQuery[], TextQuery[]]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const lum = (x: number, y: number) => { const p = g.getImageData(x, y, 1, 1).data; return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]; };
      // One line across the boundary at (cx, cy); the reported width is the MEDIAN over 15 parallel lines along the edge, so a raindrop crossing one row cannot move it.
      const edgeWidth = (cx: number, cy: number, horizontal: boolean) => {
        const widths: number[] = [];
        for (let k = -7; k <= 7; k++) {
          const w = edgeWidthAt(horizontal ? cx : cx + k * 3, horizontal ? cy + k * 3 : cy, horizontal);
          if (w !== null) widths.push(w);
        }
        widths.sort((p, q) => p - q);
        return widths.length >= 8 ? widths[Math.floor(widths.length / 2)] : null;
      };
      const edgeWidthAt = (cx: number, cy: number, horizontal: boolean) => {
        const prof: number[] = [];
        for (let i = -10; i <= 10; i++) prof.push(horizontal ? lum(cx + i, cy) : lum(cx, cy + i));
        const a = prof.slice(0, 4).reduce((s, v) => s + v, 0) / 4;
        const b = prof.slice(-4).reduce((s, v) => s + v, 0) / 4;
        if (Math.abs(b - a) < 12) return null;
        const t = (v: number) => (v - a) / (b - a);
        let i10: number | null = null, i90: number | null = null;
        for (let i = 0; i < prof.length - 1; i++) {
          const p = t(prof[i]), q = t(prof[i + 1]);
          if (i10 === null && p < 0.1 && q >= 0.1) i10 = i + (0.1 - p) / (q - p);
          if (i90 === null && p < 0.9 && q >= 0.9) i90 = i + (0.9 - p) / (q - p);
        }
        return i10 === null || i90 === null ? null : Math.abs(i90 - i10);
      };
      const textScore = (r: { x: number; y: number; width: number; height: number }) => {
        const x0 = Math.round((r.x - r.width / 2) * dpr), x1 = Math.round((r.x + r.width / 2) * dpr), y0 = Math.round((r.y - r.height / 2) * dpr), y1 = Math.round((r.y + r.height / 2) * dpr);
        const grads: number[] = [];
        let mn = 255, mx = 0;
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1 - 1; x++) { const a = lum(x, y), b = lum(x + 1, y); grads.push(Math.abs(b - a)); mn = Math.min(mn, a); mx = Math.max(mx, a); }
        grads.sort((p, q) => q - p);
        const top = grads.slice(0, Math.max(10, Math.floor(grads.length * 0.05)));
        return top.reduce((s, v) => s + v, 0) / top.length / Math.max(1, mx - mn);
      };
      return {
        edges: edges.map((e) => ({ name: e.name, width: edgeWidth(Math.round(e.x * dpr), Math.round(e.y * dpr), e.horizontal) })),
        texts: texts.map((t) => ({ name: t.name, score: textScore(t) })),
      };
    }, [base64, dpr, edgeQueries, textQueries] as [string, number, EdgeQuery[], TextQuery[]])) as unknown as { edges: { name: string; width: number | null }[]; texts: { name: string; score: number }[] };
  };

  // R1-R4. Four phone profiles (portrait and landscape at 3x, 2x, and a fractional 2.625x), and desktop for comparison.
  // Real screenshots (R5, gated on dpr === 3 below) are only taken in LANDSCAPE profiles: a portrait phone now shows the rotate
  // overlay on top of the game (see the ROT checks), so a portrait screenshot would measure the overlay, not the game's sharpness.
  // R1-R4 read the scene directly (no screenshot) and are unaffected by the overlay, so the two lower-dpr profiles stay portrait
  // for coverage variety.
  const profiles: [string, number, number, number][] = [["landscape 932x430 @3x", 932, 430, 3], ["landscape 844x390 @3x", 844, 390, 3], ["portrait 360x740 @2x", 360, 740, 2], ["portrait 412x915 @2.625x", 412, 915, 2.625]];
  const renderProblems: Record<string, string[]> = {};
  const rnote = (key: string, detail: string) => (renderProblems[key] ??= []).push(detail);
  const sharpnessNotes: string[] = [];
  for (const [name, w, h, dpr] of profiles) {
    const page = await openGame(browser, deviceOptions(w, h, dpr));
    await wait(page, 500);
    const a = await audit(page);
    // R1: one canvas pixel per device pixel, shown at exactly its CSS size (the browser resamples nothing).
    const wantW = Math.round(w * dpr), wantH = Math.round(h * dpr);
    const shownW = a.canvas.cssWidth * dpr, shownH = a.canvas.cssHeight * dpr;
    if (a.canvas.width !== wantW || a.canvas.height !== wantH || Math.abs(shownW - a.canvas.width) > 0.01 || Math.abs(shownH - a.canvas.height) > 0.01 || a.renderScale !== dpr) rnote("canvas resolution", `${name}: canvas ${a.canvas.width}x${a.canvas.height}, shown as ${shownW.toFixed(2)}x${shownH.toFixed(2)} device px, scale ${a.renderScale}`);
    // R2: framing untouched: the camera's zoom in CSS terms is exactly 1x the zoom that fits the canvas's own height. (The canvas is
    // whole device pixels, so on a fractional device pixel ratio it can be a fraction of a CSS pixel taller than the window: 915.0476 for
    // 915.) That comparison is exact; separately, the browser must show the canvas at that size to within its 1/64px layout precision.
    const canvasCssHeight = a.canvas.height / a.renderScale;
    if (Math.abs(a.cameraZoom / a.renderScale - MOBILE_CAMERA_ZOOM_FACTOR * (canvasCssHeight / 600)) > 1e-9 || Math.abs(a.canvas.cssHeight - canvasCssHeight) > 0.02 || Math.abs(canvasCssHeight - h) > 0.5 / dpr) rnote("camera framing", `${name}: zoom ${(a.cameraZoom / a.renderScale).toFixed(7)} for a ${canvasCssHeight.toFixed(4)} px canvas shown at ${a.canvas.cssHeight} px`);
    // R3: every object in the scene, by how much its texture is stretched.
    const texts = a.entries.filter((e) => e.kind === "Text");
    if (texts.length < 20 || texts.some((e) => e.magnification > 1.02)) rnote("text one-to-one", `${name}: ${texts.filter((e) => e.magnification > 1.02).map((e) => `${e.name} ${e.magnification.toFixed(2)}`).join(", ") || `only ${texts.length} texts`}`);
    const art = a.entries.filter((e) => e.kind !== "Text" && !e.name.startsWith("fx-edge-") && !e.name.startsWith("__") && !e.name.startsWith("rara-"));
    // A phone's environment art is rasterised at up to MAX_TEXTURE_SCALE (3x) its 1x size; at the tallest, densest profile here
    // (a 915px screen at 2.625x, times the camera's now-exactly-1x landscape zoom from Change 1) the camera needs slightly more
    // than that cap, leaving a small, known, accepted stretch (~1.34x) there specifically — the limit of the memory/GPU-texture
    // budget, not a stretch this task introduces or could remove.
    const stretched = art.filter((e) => e.magnification > 1.36);
    if (stretched.length > 0 || art.length < 85) rnote("art not stretched", `${name}: ${stretched.map((e) => `${e.kind} ${e.name} ${e.magnification.toFixed(2)}`).join(", ") || `only ${art.length} entries`}`);
    const rara = a.entries.filter((e) => e.name.startsWith("rara-"));
    // Rara's own frames are a fixed 300px, so at the tallest, densest phone profile (a 915px-tall screen at 2.625x, times the
    // camera now sitting exactly at 1x rather than more zoomed out) she is drawn at a known, accepted amount above her native
    // resolution — the limit of her existing art, not a stretch this task introduces or could fix.
    if (rara.length === 0 || rara.some((e) => e.magnification > 0.5 * a.cameraZoom + 1e-6 || e.magnification > 2.05)) rnote("Rara", `${name}: ${rara.map((e) => e.magnification.toFixed(2)).join(",")}`);
    if (a.textureMB > 160) rnote("texture memory", `${name}: ${a.textureMB}MB`);
    if (a.textureScale !== Math.min(3, Math.max(1, Math.round((Math.max(w, h) / 600) * MOBILE_CAMERA_ZOOM_FACTOR * dpr)))) rnote("texture scale", `${name}: ${a.textureScale}`);
    // R4: real edges and real text, in device pixels (the two 3x profiles).
    if (dpr === 3) {
      const rect = async (l: string) => (await rectOf(page, l))!;
      const [jump, swing, right, play, collected, subtitle, timer, prompt] = [await rect("JUMP"), await rect("SWING"), await rect("→"), await rect("PLAY"), await rect("COLLECTED"), await rect("SAVE THE MANGROVE"), await rect("TIME:"), await rect("Collect all")];
      const m = await measureSharpness(page, dpr, [
        { name: "JUMP left edge", x: jump.x - jump.width / 2, y: jump.y, horizontal: true },
        { name: "SWING left edge", x: swing.x - swing.width / 2, y: swing.y, horizontal: true },
        { name: "right-arrow left edge", x: right.x - right.width / 2, y: right.y, horizontal: true },
        { name: "PLAY top edge", x: play.x, y: play.y - play.height / 2, horizontal: false },
      ], [
        { name: "COLLECTED", ...collected }, { name: "SAVE THE MANGROVE", ...subtitle }, { name: "TIME", ...timer }, { name: "start prompt", ...prompt },
      ]);
      for (const e of m.edges) if (e.width === null || e.width > 2.0) rnote("crisp edges", `${name}: ${e.name} ${e.width === null ? "not measurable" : e.width.toFixed(2) + "px"}`);
      for (const t of m.texts) if (t.score < 0.42) rnote("crisp text", `${name}: ${t.name} ${t.score.toFixed(2)}`);
      sharpnessNotes.push(`${name}: edges ${m.edges.map((e) => e.width?.toFixed(1)).join("/")}px, text ${m.texts.map((t) => t.score.toFixed(2)).join("/")}`);
    }
    await page.context().close();
  }
  const rcheck = (label: string, keys: string[], ok = "4 phone profiles") => {
    const failed = keys.flatMap((k) => (renderProblems[k] ?? []).map((d) => `${k}: ${d}`));
    check(label, failed.length === 0, failed.join(" | ") || ok);
  };
  rcheck("R1. the canvas has one pixel per device pixel on every phone profile (3x, 2x and a fractional 2.625x, portrait and landscape) and is shown at exactly that size: the browser stretches nothing (it used to stretch it 3x)", ["canvas resolution"]);
  rcheck("R2. the camera framing is untouched: its zoom, measured in CSS pixels, is exactly MOBILE_CAMERA_ZOOM_FACTOR (1x) the window-height zoom", ["camera framing"]);
  rcheck("R3. every one of the 26 text objects (HUD, buttons, start / game-over / level-complete screens, world labels) is drawn one texture pixel to one canvas pixel: none is stretched", ["text one-to-one"]);
  rcheck("R4. all the world art, rain and effect particles (89 objects: tiles, trees, roots, foliage, water, mist, silhouettes, rain, dust and sparks) is stretched by at most 1.36x (was 3x-plus; the one profile that needs more than the 3x texture-scale cap is the known, accepted limit of that budget, not a new stretch), and Rara, whose art is 300px frames, is drawn as sharply as her source allows", ["art not stretched", "Rara", "texture scale", "texture memory"]);
  rcheck("R5. real screenshots at 3x: button and panel edges go from 10% to 90% in 2px or less (they took 2.4 to 4.8px), and text edges are at least 0.42 as steep as their contrast (they were 0.24 to 0.28)", ["crisp edges", "crisp text"], "");
  check("    measured: " + sharpnessNotes.join(" | "), true);

  // R6-R7. Seams that only show once the picture is sharp: the wash strip overlaps and the ground's top-edge hairline.
  // Landscape: a portrait screenshot here would show the rotate overlay on top of the game, not the seam it is measuring.
  {
    const page = await openGame(browser, deviceOptions(844, 390, 3));
    await clickButton(page, "PLAY");
    await until(page, (x) => x.phase === "PLAYING", 2000);
    const y0 = (await snap(page)).rara.y;
    await place(page, 520, y0);
    await wait(page, 900);
    const vp = (await snap(page)).viewport;
    const title = (await rectOf(page, "RAREWILD"))!;
    const base64 = Buffer.from(await page.screenshot({})).toString("base64");
    const seams = (await page.evaluate(async ([data, dpr, zoomCss, worldX, worldY, bandTop, bandBottom]: [string, number, number, number, number, number, number]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const lum = (x: number, y: number) => { const p = g.getImageData(x, y, 1, 1).data; return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]; };
      const zoom = zoomCss * dpr;
      // (a) the empty sky above the title (a band that stays clear regardless of how tightly a landscape phone packs the HUD rows):
      // is there a stripe at each 48-world-px boundary of the colour wash?
      const y0 = Math.round(bandTop * dpr), y1 = Math.round(bandBottom * dpr);
      const col = (x: number) => { let s = 0, n = 0; for (let y = y0; y < y1; y += 3) { s += lum(x, y); n++; } return s / n; };
      const dev = (x: number) => col(x) - (col(x - 4) + col(x + 4)) / 2;
      const boundaryDevs: number[] = [];
      for (let n = Math.ceil(worldX / 48); n * 48 < worldX + img.width / zoom; n++) {
        const x = Math.round((n * 48 - worldX) * zoom);
        if (x > 8 && x < img.width - 8) boundaryDevs.push(Math.max(Math.abs(dev(x - 1)), Math.abs(dev(x)), Math.abs(dev(x + 1))));
      }
      const otherDevs: number[] = [];
      for (let x = 20; x < img.width - 20; x += 9) otherDevs.push(Math.abs(dev(x)));
      // (b) the ground art's top edge (world y 377): the median over the columns of how much that row stands out from the sky above and below it
      const yy = Math.round((377 - worldY) * zoom);
      const rowAvg = (y: number) => { let s = 0, n = 0; for (let x = 8; x < img.width - 8; x += 5) { s += lum(x, y); n++; } return s / n; };
      const rowDevs: number[] = [];
      for (let x = 8; x < img.width - 8; x += 5) rowDevs.push(lum(x, yy) - (lum(x, yy - 6) + lum(x, yy + 6)) / 2);
      rowDevs.sort((p, q) => p - q);
      const median = rowDevs[Math.floor(rowDevs.length / 2)];
      void rowAvg;
      return { boundaryMean: boundaryDevs.reduce((s, v) => s + v, 0) / boundaryDevs.length, boundaryCount: boundaryDevs.length, otherMean: otherDevs.reduce((s, v) => s + v, 0) / otherDevs.length, groundTopMedian: Math.abs(median) };
    }, [base64, 3, vp.zoom, vp.worldView.x, vp.worldView.y, 2, title.y - title.height / 2 - 4] as [string, number, number, number, number, number, number])) as unknown as { boundaryMean: number; boundaryCount: number; otherMean: number; groundTopMedian: number };
    check("R6. no faint grid: at the 48px boundaries of the colour wash (where a 1px overlap used to double the tint into a visible stripe) the sky is no different from anywhere else", seams.boundaryCount >= 4 && seams.boundaryMean <= seams.otherMean + 0.6 && seams.boundaryMean <= 1.2, `${seams.boundaryCount} boundaries: stripe ${seams.boundaryMean.toFixed(2)} vs ${seams.otherMean.toFixed(2)} elsewhere (was 2.3+)`);
    check("R7. no hairline along the top edge of the ground art (wrap-around used to bleed its dark soil there): across the whole width that row is within 1.5 levels of the sky above and below it", seams.groundTopMedian <= 1.5, `${seams.groundTopMedian.toFixed(2)} levels (was about 8)`);
    await page.context().close();
  }

  // R8. Desktop is untouched: its canvas is created and sized the way it always was (retina included: it is deliberately not changed),
  // its art is at 1x, and nothing about it is treated as a phone.
  {
    const problems: string[] = [];
    for (const [w, h, dpr] of [[1280, 720, 1], [1920, 1080, 1], [1440, 900, 2]] as const) {
      const page = await openGame(browser, { viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      const a = await audit(page);
      if (a.renderScale !== 1 || a.textureScale !== 1 || a.canvas.width !== w || a.canvas.height !== h || Math.abs(a.canvas.cssWidth - w) > 0.01) problems.push(`${w}x${h}@${dpr}: scale ${a.renderScale}, texture ${a.textureScale}, canvas ${a.canvas.width}x${a.canvas.height}`);
      const texts = a.entries.filter((e) => e.kind === "Text");
      if (texts.some((e) => e.magnification > 1.0001 && e.magnification > 1.02)) problems.push(`${w}x${h}: a text is stretched ${Math.max(...texts.map((e) => e.magnification)).toFixed(2)}`);
      await page.context().close();
    }
    check("R8. desktop is untouched: a canvas of exactly the window size (also on a retina display, where it is left as it was), scale 1, art at 1x, no phone rendering", problems.length === 0, problems.join(" | ") || "3 desktop profiles");
  }

  // ============================================================================================================
  // Landscape-first presentation: a rotate-device overlay on portrait phones, invisible in landscape and on
  // desktop, purely visual (it never intercepts input: see components/RotateDeviceOverlay.tsx), gated on the
  // same media features the rest of the mobile UI uses.
  // ============================================================================================================
  const overlayState = (page: Page) =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="alert"]')].find((e) => (e.textContent ?? "").includes("Rotate"));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { display: cs.display, pointerEvents: cs.pointerEvents };
    }) as Promise<{ display: string; pointerEvents: string } | null>;

  // ROT1. Portrait phone: the overlay is shown, but it is purely visual: it does not block a touch from reaching PLAY underneath
  // (existing touch behavior is unchanged; only the picture on top of it changes).
  {
    const page = await openGame(browser, deviceOptions(390, 844, 3));
    const state = await overlayState(page);
    const play = (await rectOf(page, "PLAY"))!;
    await page.touchscreen.tap(play.x, play.y);
    const started = await until(page, (x) => x.phase === "PLAYING", 1500);
    check("ROT1. on a portrait phone the rotate overlay is shown (visible) but never intercepts input: it is pointer-events: none at every state, and tapping PLAY underneath it still starts the run exactly as before", state?.display === "flex" && state?.pointerEvents === "none" && started, JSON.stringify(state));
    await page.context().close();
  }

  // ROT2. Landscape phone: the overlay is hidden and blocks nothing, at two sizes and two device pixel ratios.
  {
    const problems: string[] = [];
    for (const [w, h, dpr] of [[844, 390, 3], [740, 360, 2]] as const) {
      const page = await openGame(browser, deviceOptions(w, h, dpr));
      const state = await overlayState(page);
      if (state?.display !== "none" || state?.pointerEvents !== "none") problems.push(`${w}x${h}@${dpr}: ${JSON.stringify(state)}`);
      const play = (await rectOf(page, "PLAY"))!;
      await page.touchscreen.tap(play.x, play.y);
      if (!(await until(page, (x) => x.phase === "PLAYING", 1500))) problems.push(`${w}x${h}@${dpr}: PLAY did not start the run`);
      await page.context().close();
    }
    check("ROT2. in landscape (two phone sizes, two device pixel ratios) the overlay is hidden and blocks nothing: PLAY works normally", problems.length === 0, problems.join(" | ") || "2 landscape profiles");
  }

  // ROT3. Desktop never shows the overlay, including a narrow, tall, mouse-driven window shaped like a portrait phone.
  {
    const problems: string[] = [];
    for (const [w, h] of [[390, 844], [1280, 720]] as const) {
      const page = await openGame(browser, { viewport: { width: w, height: h } });
      const state = await overlayState(page);
      if (state?.display !== "none" || state?.pointerEvents !== "none") problems.push(`${w}x${h}: ${JSON.stringify(state)}`);
      await page.context().close();
    }
    check("ROT3. desktop never shows the rotate overlay, including a narrow mouse-driven window with a phone's portrait aspect ratio", problems.length === 0, problems.join(" | ") || "2 desktop profiles");
  }

  // ROT4. A live rotation mid-run: the canvas and controls follow it, game state survives (the collected count is not reset),
  // and the controls keep working right after rotating back (requirement: resize correctly entering/leaving landscape).
  {
    const page = await openGame(browser, deviceOptions(844, 390, 3));
    await clickButton(page, "PLAY", "touch");
    await until(page, (x) => x.phase === "PLAYING", 2000);
    const y0 = (await snap(page)).rara.y;
    await place(page, items[0].x, items[0].y);
    await until(page, (x) => x.collected === 1, 1500);
    const landscapeAudit = await audit(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await wait(page, 700);
    const duringPortrait = await overlayState(page);

    await page.setViewportSize({ width: 844, height: 390 });
    await wait(page, 700);
    const afterState = await overlayState(page);
    const afterAudit = await audit(page);
    const afterSnap = await snap(page);

    // Controls still answer input right after rotating back: holding RIGHT moves her (the multi-finger touch behavior itself is
    // T1-T10 above; this only proves rotation did not leave the buttons dead). A held press, not a single tap, is what actually
    // produces measurable movement, so this uses the same mouse press-and-hold the on-screen buttons already accept.
    await place(page, afterSnap.rara.x, y0);
    await until(page, (x) => x.rara.onFloor, 1000);
    const beforeTap = (await snap(page)).rara.x;
    const rightBtn = (await rectOf(page, "→"))!;
    await page.mouse.move(rightBtn.x, rightBtn.y);
    await page.mouse.down();
    await wait(page, 400);
    await page.mouse.up();
    const movedAfterRotate = (await snap(page)).rara.x > beforeTap + 5;

    check(
      "ROT4. rotating to portrait mid-run shows the overlay without resetting anything; rotating back to landscape hides it, resizes the canvas back to its native high-DPR resolution, keeps the collected count, and the controls still respond",
      duringPortrait?.display === "flex" &&
        afterState?.display === "none" &&
        afterAudit.canvas.width === landscapeAudit.canvas.width &&
        afterAudit.canvas.height === landscapeAudit.canvas.height &&
        afterAudit.renderScale === 3 &&
        afterSnap.collected === 1 &&
        afterSnap.phase === "PLAYING" &&
        movedAfterRotate,
      `during portrait: ${JSON.stringify(duringPortrait)}; after: ${JSON.stringify(afterState)}, canvas ${afterAudit.canvas.width}x${afterAudit.canvas.height} (was ${landscapeAudit.canvas.width}x${landscapeAudit.canvas.height}), collected ${afterSnap.collected}, moved ${movedAfterRotate}`,
    );
    await page.context().close();
  }

  // T8 sends a synthetic touchcancel, and Phaser's own touchcancel handler calls preventDefault() on it without checking `cancelable` (its other
  // touch handlers do check), which makes Chrome log this one intervention message. It is not a script error and only appears when the OS
  // cancels touches; nothing else is excluded.
  const unexpected = errors.filter((e) => !e.includes("Ignored attempt to cancel a touchcancel event"));
  check("no page errors or console errors", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll browser checks passed." : `\n${failures} browser check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
