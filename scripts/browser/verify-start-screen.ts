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
  screenshot(options: { path: string }): Promise<unknown>;
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
  viewport: { width: number; height: number; zoom: number };
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

  check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll browser checks passed." : `\n${failures} browser check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
