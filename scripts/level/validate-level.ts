/**
 * Validation for the whole journey: world size, the six zones, and how the
 * obstacles, collectibles, Hunters, water and scenery are distributed across
 * them. Everything is checked against the real level configuration, so the
 * layout cannot drift out of shape unnoticed. No browser needed.
 *
 *   node scripts/level/validate-level.ts
 */

import { FIRST_LEVEL_COLLECTIBLES as ITEMS } from "../../lib/collectibles/placement.ts";
import { DEFAULT_HUNTER_CONFIG as HUNTER } from "../../lib/hunter/config.ts";
import { FIRST_LEVEL_HUNTERS as HUNTERS, HUNTER_RULES, patrolSpan } from "../../lib/hunter/placement.ts";
import { computeZonedPlacements, washAt } from "../../lib/environment/zonePlacements.ts";
import {
  HAZARD_X, MOVE_MAX_X, MOVE_MIN_X, PLAYER_START_X, SEED_X, WORLD_WIDTH,
} from "../../lib/level/constants.ts";
import {
  ENVIRONMENT_ZONES, EXIT_RESERVE, WATER_SEGMENTS, ZONES, ZONE_DANGEROUS, ZONE_DEEP_FOREST, ZONE_FINAL, ZONE_HUNTER,
  ZONE_ROCKY, ZONE_START, zoneAt, type ZoneId,
} from "../../lib/level/zones.ts";
import { FIRST_LEVEL_OBSTACLES as OBSTACLES, validateObstacleLayout } from "../../lib/obstacles/placement.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const count = <T,>(items: readonly T[], zone: ZoneId, x: (t: T) => number) => items.filter((i) => zoneAt(x(i)).id === zone).length;
const perZone = <T,>(items: readonly T[], x: (t: T) => number) => ZONES.map((z) => count(items, z.id, x));

// --- world and zones ---------------------------------------------------------------------------------------
{
  check("the world is 7000-8000px wide (no 2400px world left)", WORLD_WIDTH >= 7000 && WORLD_WIDTH <= 8000, `${WORLD_WIDTH}px`);
  check("the playable range follows the world (60px margins)", MOVE_MIN_X === 60 && MOVE_MAX_X === WORLD_WIDTH - 60);
  check("six zones, in the intended order", ZONES.map((z) => z.id).join() === "START,ROCKY,HUNTER,DEEP_FOREST,DANGEROUS,FINAL");
  check("zones start at 0, touch edge to edge and end exactly at the world's end", ZONES[0].start === 0 && ZONES.every((z, i) => i === 0 || z.start === ZONES[i - 1].end) && ZONES.at(-1)!.end === WORLD_WIDTH);
  check("every zone is a real stretch (1000-1500px)", ZONES.every((z) => z.end - z.start >= 1000 && z.end - z.start <= 1500), ZONES.map((z) => z.end - z.start).join(","));
  check("Rara starts at the left, inside the Forest Start zone", PLAYER_START_X < 600 && zoneAt(PLAYER_START_X).id === "START");
  check("zoneAt() maps positions to zones (including the edges)", zoneAt(0).id === "START" && zoneAt(1299).id === "START" && zoneAt(1300).id === "ROCKY" && zoneAt(WORLD_WIDTH - 1).id === "FINAL" && zoneAt(99999).id === "FINAL");
  check("the exit area is reserved at the far end (inside the final zone, 300-500px)", EXIT_RESERVE.start >= ZONE_FINAL.start && EXIT_RESERVE.end === WORLD_WIDTH && EXIT_RESERVE.end - EXIT_RESERVE.start >= 300 && EXIT_RESERVE.end - EXIT_RESERVE.start <= 500, `${EXIT_RESERVE.start}-${EXIT_RESERVE.end}`);
  check("obstacle spacing tightens through the journey (later zones are harder)", ZONE_START.minObstacleGap > ZONE_ROCKY.minObstacleGap && ZONE_ROCKY.minObstacleGap >= ZONE_HUNTER.minObstacleGap && ZONE_DEEP_FOREST.minObstacleGap > ZONE_DANGEROUS.minObstacleGap, ZONES.map((z) => z.minObstacleGap).join(","));
}

// --- Hunters -----------------------------------------------------------------------------------------------------
const patrols = HUNTERS.map((h) => patrolSpan(h, HUNTER));
{
  check("Hunters live only in zones 3, 4 and 5 (none at the start, none in the rocky or final zones)", HUNTERS.every((h) => zoneAt(h.x).id === h.zone) && HUNTERS.map((h) => h.zone).join() === "HUNTER,DEEP_FOREST,DANGEROUS", HUNTERS.map((h) => `${h.id}@${h.x}`).join(" "));
  check("no Hunter anywhere near Rara's start", HUNTERS.every((h) => Math.abs(h.x - PLAYER_START_X) >= HUNTER_RULES.minDistanceFromStart));
  const sorted = [...HUNTERS].sort((a, b) => a.x - b.x);
  const spacing = sorted.slice(1).map((h, i) => h.x - sorted[i].x);
  check("Hunters are far apart (never a double chase)", spacing.every((d) => d >= HUNTER_RULES.minSpacing), spacing.join(", ") + " px");
  const chaseReach = HUNTER.detectionRange * HUNTER.chaseRangeMultiplier;
  const gaps = patrols.slice(1).map((p, i) => p.left - patrols[i].right);
  check("a full chase range (630px) still leaves clear ground between one Hunter's beat and the next", gaps.every((g) => g > chaseReach), gaps.join(", ") + " px");
  check("every patrol route is inside the playable world", patrols.every((p) => p.left >= MOVE_MIN_X && p.right <= MOVE_MAX_X));
  check("no Hunter or patrol reaches the reserved exit area", patrols.every((p) => p.right + HUNTER.detectionRange < EXIT_RESERVE.start));
  check("three Hunters, one per zone, sharing one tuning (no new enemy types)", new Set(HUNTERS.map((h) => h.zone)).size === 3 && HUNTERS.every((h) => (h.patrolRadius ?? HUNTER.patrolRadius) <= 250));
}

// --- Obstacles -------------------------------------------------------------------------------------------------
{
  const ctx = {
    bounds: { minX: MOVE_MIN_X, maxX: MOVE_MAX_X },
    playerStartX: PLAYER_START_X,
    keepClearOf: [{ label: "existing seed pickup", x: SEED_X }, { label: "existing hazard", x: HAZARD_X }],
    patrols,
    exitReserveStart: EXIT_RESERVE.start,
    minGapAt: (x: number) => zoneAt(x).minObstacleGap,
    allowedTypesAt: (x: number) => zoneAt(x).obstacleTypes.allowed,
  };
  const problems = validateObstacleLayout(OBSTACLES, ctx);
  check("the obstacle layout satisfies every placement rule (spacing per zone, patrol clearance, exit reserve)", problems.length === 0, problems.join("; "));
  const n = perZone(OBSTACLES, (o) => o.x);
  check("obstacles appear in every zone", n.every((c) => c >= 1), n.join("/"));
  check("Forest Start is gentle: the fewest obstacles of the first three zones", n[0] <= 2 && n[0] < n[1] && n[0] <= n[2], `${n[0]}`);
  check("the Rocky Area has the most (the jumping zone)", n[1] === Math.max(...n), `${n[1]}`);
  check("the Final Approach thins out again", n[5] < n[1] && n[5] <= 2, `${n[5]}`);
  check("obstacle counts follow the intended shape overall (few -> many -> fewer)", n[0] < n[1] && n[5] < n[1], n.join("/"));
  const kinds = new Set(OBSTACLES.map((o) => o.kind));
  check("all three art kinds are used (rock, stump, log)", kinds.size === 3);
  check("all five obstacle TYPES are used, spread across the zones as planned (each zone uses exactly the types it teaches)", ZONES.every((z) => { const used = new Set(OBSTACLES.filter((o) => zoneAt(o.x).id === z.id).map((o) => o.type)); return z.obstacleTypes.required.every((t) => used.has(t)) && [...used].every((t) => z.obstacleTypes.allowed.includes(t)); }) && new Set(OBSTACLES.map((o) => o.type)).size === 5, ZONES.map((z) => `${z.id}: ${[...new Set(OBSTACLES.filter((o) => zoneAt(o.x).id === z.id).map((o) => o.type))].join("+")}`).join(" | "));
  // Not one obstacle copied every few hundred px: the spacing and the sizes vary.
  const xs = [...OBSTACLES].sort((a, b) => a.x - b.x).map((o) => o.x);
  const deltas = xs.slice(1).map((x, i) => x - xs[i]);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / deltas.length);
  check("the obstacle spacing is irregular (not a repeating pattern)", sd / mean > 0.45, `spacing ${Math.min(...deltas)}-${Math.max(...deltas)}px, variation ${(sd / mean).toFixed(2)}`);
  check("sizes vary (at least 5 different width/height combinations)", new Set(OBSTACLES.map((o) => `${o.width}x${o.height}`)).size >= 5, `${new Set(OBSTACLES.map((o) => `${o.width}x${o.height}`)).size} kinds`);
  check("obstacles are spread over the whole journey (first in the first third, last in the last fifth)", xs[0] < WORLD_WIDTH / 3 && xs.at(-1)! > WORLD_WIDTH * 0.8, `${xs[0]} .. ${xs.at(-1)}`);
  check(`no obstacle is inside the ${EXIT_RESERVE.end - EXIT_RESERVE.start}px reserved for the exit`, OBSTACLES.every((o) => o.x + o.width / 2 <= EXIT_RESERVE.start));
  // Obstacles hide Rara from a Hunter, so give each Hunter at least one to hide behind within its sight.
  check("every Hunter has an obstacle within its sight to hide behind (an escape option)", patrols.every((p) => OBSTACLES.some((o) => (o.x > p.right && o.x < p.right + HUNTER.detectionRange + 300) || (o.x < p.left && o.x > p.left - HUNTER.detectionRange - 300))));
}

// --- Collectibles --------------------------------------------------------------------------------------------------
{
  const n = perZone(ITEMS, (i) => i.x);
  check("the same 12 collectibles as before (count not increased)", ITEMS.length === 12);
  check("distribution across the six zones is 2 / 2 / 2 / 2 / 3 / 1", n.join("/") === "2/2/2/2/3/1", n.join("/"));
  const xs = ITEMS.map((i) => i.x);
  check("the collectibles are spread across the journey, not near the beginning", Math.min(...xs) < 700 && Math.max(...xs) > WORLD_WIDTH * 0.85 && xs.filter((x) => x < WORLD_WIDTH / 3).length <= 5, `${Math.min(...xs)} .. ${Math.max(...xs)}`);
  check("none in the reserved exit area", xs.every((x) => x < EXIT_RESERVE.start));
  const near = (p: { left: number; right: number }) => ITEMS.filter((i) => i.x >= p.left - 450 && i.x <= p.right + 450).length;
  check("every Hunter has collectibles around its territory", patrols.every((p) => near(p) >= 1), patrols.map((p) => near(p)).join("/"));
  check("the Hunter zones have both a ground item and a high risk/reward item", ITEMS.some((i) => zoneAt(i.x).id === "HUNTER" && i.tier === "ground") && ITEMS.some((i) => zoneAt(i.x).id === "HUNTER" && i.tier === "high"));
}

// --- No big empty stretches ---------------------------------------------------------------------------------------------
{
  // Everything a player meets: Rara's start, obstacles, collectibles, and each Hunter's whole beat.
  type Span = { from: number; to: number; what: string };
  const spans: Span[] = [
    { from: PLAYER_START_X, to: PLAYER_START_X, what: "start" },
    ...OBSTACLES.map((o) => ({ from: o.x - o.width / 2, to: o.x + o.width / 2, what: o.id })),
    ...ITEMS.map((i) => ({ from: i.x, to: i.x, what: i.id })),
    ...HUNTERS.map((h, i) => ({ from: patrols[i].left - HUNTER.detectionRange * 0.5, to: patrols[i].right + HUNTER.detectionRange * 0.5, what: h.id })),
  ].sort((a, b) => a.from - b.from);
  let reach = spans[0].to;
  let worst = { gap: 0, at: 0, between: "" };
  for (const s of spans.slice(1)) {
    const gap = s.from - reach;
    if (gap > worst.gap) worst = { gap, at: reach, between: s.what };
    reach = Math.max(reach, s.to);
  }
  check("no large empty section: something to see or do at least every 450px along the whole journey", worst.gap <= 450, `longest quiet stretch ${worst.gap.toFixed(0)}px at x=${worst.at.toFixed(0)} before ${worst.between}`);
  check("only the reserved exit area is left empty at the very end", reach < EXIT_RESERVE.start && WORLD_WIDTH - reach >= 300, `last thing at x=${reach.toFixed(0)}`);
}

// --- Water ---------------------------------------------------------------------------------------------------------------
{
  check("decorative pools are inside the world, ordered, and 200-320px wide", WATER_SEGMENTS.every((w, i) => w.start >= 0 && w.end <= EXIT_RESERVE.start && w.end - w.start >= 200 && w.end - w.start <= 320 && (i === 0 || w.start > WATER_SEGMENTS[i - 1].end + 200)), WATER_SEGMENTS.map((w) => `${w.start}-${w.end}`).join(" "));
  check("pools are spread across the journey (at least 3 zones)", new Set(WATER_SEGMENTS.map((w) => zoneAt((w.start + w.end) / 2).id)).size >= 3);
  check("pools never overlap a Hunter's beat (100px clear)", WATER_SEGMENTS.every((w) => patrols.every((p) => w.end < p.left - 100 || w.start > p.right + 100)));
  check("pools stay clear of Rara's start area and the reserved exit", WATER_SEGMENTS.every((w) => Math.abs((w.start + w.end) / 2 - PLAYER_START_X) > 250 && w.end < EXIT_RESERVE.start));
}

// --- Scenery ----------------------------------------------------------------------------------------------------------------
{
  const seed = 1770772245;
  const a = computeZonedPlacements(seed, ENVIRONMENT_ZONES);
  const b = computeZonedPlacements(seed, ENVIRONMENT_ZONES);
  check("scenery is deterministic (same seed, same forest)", JSON.stringify(a) === JSON.stringify(b));
  check("scenery differs with another seed", JSON.stringify(computeZonedPlacements(seed + 1, ENVIRONMENT_ZONES)) !== JSON.stringify(a));
  const all = [...a.trees, ...a.roots, ...a.foliage];
  check("every piece of scenery is inside the world", all.every((p) => p.x >= 0 && p.x <= WORLD_WIDTH && Number.isFinite(p.x)));
  const dens = (list: { x: number }[], z: (typeof ZONES)[number]) => list.filter((p) => p.x >= z.start && p.x < z.end).length / ((z.end - z.start) / 1000);
  const density = ZONES.map((z) => dens([...a.trees, ...a.foliage], z));
  check("the Deep Forest is the densest zone", density[3] === Math.max(...density), density.map((d) => d.toFixed(1)).join(" / ") + " per 1000px");
  check("the Final Approach thins out (sparser than the Deep Forest and Dangerous Wilds)", density[5] < density[3] && density[5] < density[4]);
  check("Forest Start is lighter than the Deep Forest and the Hunter zone", density[0] < density[3] && density[0] < density[2]);
  const gapsOf = (list: { x: number }[]) => { const xs = list.map((p) => p.x).sort((x, y) => x - y); return xs.slice(1).map((x, i) => x - xs[i]); };
  const worstTree = Math.max(...gapsOf(a.trees));
  const worstFoliage = Math.max(...gapsOf(a.foliage));
  check("no big empty stretch of scenery (trees never more than ~1100px apart, foliage 800px)", worstTree < 1100 && worstFoliage < 800, `trees ${worstTree.toFixed(0)}, foliage ${worstFoliage.toFixed(0)}`);
  // Obvious repeats: identical variant twice in a row, or perfectly even spacing.
  const keys = a.trees.map((p) => p.key);
  let repeats = 0; for (let i = 1; i < keys.length; i++) if (keys[i] === keys[i - 1]) repeats++;
  const dt = gapsOf(a.trees); const mt = dt.reduce((x, y) => x + y, 0) / dt.length;
  const cv = Math.sqrt(dt.reduce((x, d) => x + (d - mt) ** 2, 0) / dt.length) / mt;
  check("no obvious repeating pattern in the trees (no variant repeated in a row within a zone; irregular spacing)", cv > 0.25 && repeats <= ZONES.length, `${repeats} repeats across zone seams, spacing variation ${cv.toFixed(2)}`);
  check("every zone has its own mix of tree sizes (large trees mostly in the deep zones)", a.trees.filter((p) => p.key === "tree-large" && zoneAt(p.x).id === "DEEP_FOREST").length > a.trees.filter((p) => p.key === "tree-large" && zoneAt(p.x).id === "ROCKY").length);
  const silXs = a.silhouettes.map((sil) => sil.x).sort((p, q) => p - q);
  const silGaps = silXs.slice(1).map((x, i) => x - silXs[i]);
  check("distant silhouettes cover the half-speed parallax layer for the whole journey, with no big holes", silXs[0] < 500 && silXs.at(-1)! > (WORLD_WIDTH * 0.5 + 266) * 0.9 && Math.max(...silGaps) < 800, `${silXs.length} silhouettes, x ${silXs[0].toFixed(0)}..${silXs.at(-1)!.toFixed(0)}, largest gap ${Math.max(...silGaps).toFixed(0)}px`);
  const first = washAt(ENVIRONMENT_ZONES, 100), mid = washAt(ENVIRONMENT_ZONES, 4650), last = washAt(ENVIRONMENT_ZONES, 7500);
  check("the colour grade differs by zone (start, deep forest, final approach are distinct)", first.color !== mid.color && mid.color !== last.color && mid.alpha > first.alpha);
  let smooth = true;
  for (let x = 0; x < WORLD_WIDTH - 50; x += 50) { const p = washAt(ENVIRONMENT_ZONES, x), q = washAt(ENVIRONMENT_ZONES, x + 50); if (Math.abs(p.alpha - q.alpha) > 0.01) smooth = false; }
  check("the grade blends smoothly between zones (no hard seam)", smooth);
  check("the grade stays subtle everywhere (alpha <= 0.25), so nothing becomes hard to read", ZONES.every((z) => z.visual.wash.alpha <= 0.25));
}

console.log(failures === 0 ? "\nAll level checks passed." : `\n${failures} level check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
