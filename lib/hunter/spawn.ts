/**
 * Where the Hunter starts. Pure and deterministic: the preferred position is
 * clamped into the playable world and, if that is too close to the player's
 * start, moved out to the minimum safe distance (on the side that has room).
 */

import type { HunterSpawnConfig } from "./config.ts";

export function resolveHunterSpawnX(
  spawn: HunterSpawnConfig,
  playerX: number,
  bounds: { minX: number; maxX: number },
): number {
  const clamp = (x: number) => Math.min(Math.max(x, bounds.minX), bounds.maxX);
  const preferred = clamp(spawn.x);
  if (Math.abs(preferred - playerX) >= spawn.minDistanceFromPlayer) return preferred;

  const candidates = [playerX + spawn.minDistanceFromPlayer, playerX - spawn.minDistanceFromPlayer].filter(
    (x) => x >= bounds.minX && x <= bounds.maxX,
  );
  if (candidates.length === 0) {
    // World too small for the safe distance: use the edge farthest from the player.
    return Math.abs(bounds.minX - playerX) > Math.abs(bounds.maxX - playerX) ? bounds.minX : bounds.maxX;
  }
  return candidates.reduce((best, x) => (Math.abs(x - preferred) < Math.abs(best - preferred) ? x : best));
}
