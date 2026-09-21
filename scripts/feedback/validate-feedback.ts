/**
 * Validation for the player-feedback layer (lib/feedback, lib/audio/sfx.ts). No browser: the rules that
 * decide WHEN feedback shows are pure, so they are checked in plain Node. The effects themselves
 * (particles, screen-edge tints, camera) are checked in a real browser by scripts/browser.
 *
 *   node scripts/feedback/validate-feedback.ts
 *
 * Sections: landing detection, danger cue, reduced motion / pulse, sound effects, and isolation
 * (the feedback layer only observes the game: it cannot reach into movement, Hunters, the objective
 * or the collectible rules).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dangerEdgeAlpha, dangerLevel, DANGER_NEAR_PX, HEARTBEAT_PERIOD_MS, heartbeat, MAX_EDGE_ALPHA, type DangerSource } from "../../lib/feedback/danger.ts";
import { FULL_IMPACT_SPEED, impactStrength, LandingDetector, MIN_IMPACT_SPEED } from "../../lib/feedback/landing.ts";
import { getSfxStats, playSfx } from "../../lib/audio/sfx.ts";
import { DEFAULT_MOVEMENT_CONFIG as MOVE } from "../../lib/movement/config.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

/** Downward speed after falling `height` px under the fall gravity the motor really applies. */
const fallSpeed = (height: number) => Math.sqrt(2 * MOVE.gravity * MOVE.fallGravityMultiplier * height);

// --- landing -----------------------------------------------------------------------------------------------------------------
{
  const peak = MOVE.jumpVelocity ** 2 / (2 * MOVE.gravity);
  check("a step down of 30px is not a meaningful landing, a hop off a 56px log is, and so is a full jump", impactStrength(fallSpeed(30)) === 0 && impactStrength(fallSpeed(56)) > 0 && impactStrength(fallSpeed(peak)) > 0, `${fallSpeed(30).toFixed(0)} / ${fallSpeed(56).toFixed(0)} / ${fallSpeed(peak).toFixed(0)} px/s vs threshold ${MIN_IMPACT_SPEED}`);
  check("strength grows with the fall and is capped at 1", impactStrength(MIN_IMPACT_SPEED) > 0 && impactStrength(700) > impactStrength(MIN_IMPACT_SPEED) && impactStrength(FULL_IMPACT_SPEED) === 1 && impactStrength(5000) === 1 && impactStrength(0) === 0);

  const d = new LandingDetector();
  check("standing or running on the floor gives no landing", [0, 1, 2, 3].every(() => d.update(true, 0) === 0));
  d.update(false, -700); // rising
  d.update(false, 100);
  d.update(false, 600);
  d.update(false, 850);
  const hard = d.update(true, 0); // Arcade has already zeroed the speed on the landing frame
  check("a landing after a real fall is reported once, on the touchdown frame, using the fastest speed seen in the air", hard === impactStrength(850) && hard > 0 && d.update(true, 0) === 0, `strength ${hard.toFixed(2)}`);
  d.update(false, 150);
  d.update(false, 320);
  check("a small drop (peak 320 px/s) is not reported", d.update(true, 0) === 0);
  d.update(false, 900);
  d.reset();
  check("reset() forgets a flight in progress (a restart mid-air does not give a phantom landing)", d.update(true, 0) === 0);
  check("a one-frame floor-flag flicker while standing gives nothing", (() => { const x = new LandingDetector(); x.update(false, 40); return x.update(true, 0) === 0; })());
}

// --- danger ------------------------------------------------------------------------------------------------------------------
{
  const at = (state: DangerSource["state"], x: number, caught = false): DangerSource => Object.freeze({ state, x, caught });
  const rara = 1000;
  check("no Hunter: no danger", dangerLevel([], rara) === 0);
  check("IDLE, PATROL and LOST are not danger, even right beside her (nothing is shown until a Hunter has noticed her)", (["IDLE", "PATROL", "LOST"] as const).every((s) => dangerLevel([at(s, rara)], rara) === 0));
  const alertNear = dangerLevel([at("ALERT", rara)], rara);
  const alertFar = dangerLevel([at("ALERT", rara + 2 * DANGER_NEAR_PX)], rara);
  check("ALERT is a warning: shown, moderate, a little stronger when the Hunter is close", alertFar > 0 && alertNear > alertFar && alertNear <= 0.6, `${alertFar.toFixed(2)} far, ${alertNear.toFixed(2)} near`);
  const chaseNear = dangerLevel([at("CHASE", rara + 30)], rara);
  const chaseMid = dangerLevel([at("CHASE", rara + DANGER_NEAR_PX / 2)], rara);
  const chaseFar = dangerLevel([at("CHASE", rara + 3 * DANGER_NEAR_PX)], rara);
  check("CHASE is real danger: always clearly shown, and stronger the closer the Hunter is", chaseFar >= 0.4 && chaseMid > chaseFar && chaseNear > chaseMid && chaseNear <= 1, `${chaseFar.toFixed(2)} < ${chaseMid.toFixed(2)} < ${chaseNear.toFixed(2)}`);
  check("distance counts on both sides of her", dangerLevel([at("CHASE", rara - 100)], rara) === dangerLevel([at("CHASE", rara + 100)], rara));
  check("at the same distance a chase outranks an alert, near or far", dangerLevel([at("CHASE", rara)], rara) > alertNear && dangerLevel([at("CHASE", rara + 2 * DANGER_NEAR_PX)], rara) > alertFar);
  check("a Hunter that has already caught her shows nothing (it stands down)", dangerLevel([at("CHASE", rara, true)], rara) === 0);
  check("with several Hunters the strongest counts, and a calm one does not dilute it", dangerLevel([at("PATROL", 0), at("CHASE", rara + 30), at("IDLE", 5000)], rara) === chaseNear);
  const frozen = [at("CHASE", 1100)];
  dangerLevel(frozen, rara);
  check("it only reads the Hunters: the objects it is given are frozen and it does not write to them (it would throw)", frozen[0].state === "CHASE" && frozen[0].x === 1100);
}

// --- the pulse and reduced motion --------------------------------------------------------------------------------------------
{
  const samples = Array.from({ length: 90 }, (_, i) => heartbeat((i * HEARTBEAT_PERIOD_MS) / 90));
  check("the heartbeat stays in 0..1, has a strong beat and a quiet gap, and repeats every period", samples.every((v) => v >= 0 && v <= 1) && Math.max(...samples) > 0.95 && Math.min(...samples) < 0.05 && Math.abs(heartbeat(123) - heartbeat(123 + HEARTBEAT_PERIOD_MS)) < 1e-9);
  check("no danger, no tint", dangerEdgeAlpha(0, 500, false) === 0 && dangerEdgeAlpha(0, 500, true) === 0);
  const level = 0.8;
  const pulsing = Array.from({ length: 60 }, (_, i) => dangerEdgeAlpha(level, (i * HEARTBEAT_PERIOD_MS) / 60, false));
  check("the tint breathes but never drops below 70% of its level and never exceeds the maximum", Math.min(...pulsing) >= level * MAX_EDGE_ALPHA * 0.7 - 1e-9 && Math.max(...pulsing) <= level * MAX_EDGE_ALPHA + 1e-9 && Math.max(...pulsing) - Math.min(...pulsing) > 0.02, `${Math.min(...pulsing).toFixed(3)} .. ${Math.max(...pulsing).toFixed(3)}`);
  const still = new Set(Array.from({ length: 60 }, (_, i) => dangerEdgeAlpha(level, (i * HEARTBEAT_PERIOD_MS) / 60, true)));
  check("with reduced motion the tint is perfectly steady (no pulsing) but is still shown", still.size === 1 && [...still][0] > 0);
  check("the maximum tint is subtle: at most half of the screen edge, and it stays under the cap at any level", MAX_EDGE_ALPHA <= 0.5 && dangerEdgeAlpha(5, 0, false) <= MAX_EDGE_ALPHA);
}

// --- sound effects -----------------------------------------------------------------------------------------------------------
{
  const before = getSfxStats();
  check("no effect has been triggered yet", Object.values(before).every((n) => n === 0));
  playSfx("pickup", { step: 3 });
  playSfx("pickup", { step: 4 }); // immediately again: inside the minimum gap
  playSfx("jump");
  playSfx("land", { intensity: 0.7 });
  playSfx("danger");
  playSfx("danger"); // inside the 1.5s gap
  playSfx("capture");
  playSfx("complete");
  const after = getSfxStats();
  check("effects are counted when triggered and never throw without Web Audio (Node has none: they are simply silent)", after.pickup === 1 && after.jump === 1 && after.land === 1 && after.danger === 1 && after.capture === 1 && after.complete === 1, JSON.stringify(after));
  check("a repeat inside an effect's minimum gap is dropped (a burst of events cannot stack into noise)", after.pickup === 1 && after.danger === 1);
}

// --- isolation: the feedback layer only observes ------------------------------------------------------------------------------
{
  const dir = join(import.meta.dirname, "../../lib/feedback");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const offenders: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const m = /^\s*(import|export)\b.*\bfrom\s+"([^"]+)"/.exec(line);
      if (!m) continue;
      const [, kind, target] = m;
      const relative = target.startsWith(".");
      if (!relative) continue; // "phaser" (type-only, checked below)
      const insideFeedback = target.startsWith("./");
      const typeOnly = /^\s*import\s+type\b/.test(line);
      if (!insideFeedback && !typeOnly) offenders.push(`${file}: ${kind} ${target}`);
    }
  }
  check("lib/feedback imports nothing at runtime from movement, Hunters, the objective or the collectibles (only types): it cannot change them", offenders.length === 0, offenders.join("; ") || `${files.length} files`);
  const phaserImports = files.flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter((l) => /from "phaser"/.test(l) && !/^\s*import type\b/.test(l)));
  check("and it never imports Phaser itself at runtime (SSR-safe: `import type` only)", phaserImports.length === 0, phaserImports.join("; "));
}

console.log(failures === 0 ? "\nAll feedback checks passed." : `\n${failures} feedback check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
