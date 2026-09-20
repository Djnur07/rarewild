/** Placeholder art variants; gameplay never depends on the kind, only on the box. */
export type ObstacleKind = "rock" | "stump" | "log";

/**
 * One obstacle: a solid box standing on the ground. `x` is the horizontal
 * centre; the box sits on the ground surface, so only width and height are
 * needed. The drawn art must fill this box exactly (what you see is what you
 * collide with).
 */
export interface ObstacleSpec {
  id: string;
  kind: ObstacleKind;
  x: number;
  width: number;
  height: number;
}
