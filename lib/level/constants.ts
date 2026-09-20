/**
 * The level's fixed dimensions and landmarks, shared by the scene, the
 * obstacle/collectible/hunter layouts and their validation scripts so none of
 * them can drift out of sync. World px.
 */

import { feetOffset } from "../movement/physicsBody.ts";

/**
 * The whole journey, START (left) to the eventual END (right). Zone boundaries
 * and the reserved exit area are in ./zones.ts.
 */
export const WORLD_WIDTH = 7600;
export const WORLD_HEIGHT = 600;
/** The sprite centre's height when Rara stands on the ground. */
export const GROUND_Y = 420;
export const CHARACTER_SCALE = 0.5;
/** Playable range for a character's centre. */
export const MOVE_MIN_X = 60;
export const MOVE_MAX_X = WORLD_WIDTH - 60;
export const PLAYER_START_X = 400;
/** The walkable top of the ground: Rara's feet (and the Hunter's) rest here. */
export const GROUND_SURFACE_Y = GROUND_Y + feetOffset(CHARACTER_SCALE);

/** The existing pickup ("seed") and hazard positions; new layouts keep clear of them. */
export const SEED_X = 620;
export const HAZARD_X = 140;
