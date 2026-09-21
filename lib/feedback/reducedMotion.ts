/**
 * The player's `prefers-reduced-motion` setting, read from the browser and kept up to date while the
 * game is open. The feedback effects ask it before doing anything that moves a lot (screen shake,
 * particle bursts, expanding rings); the gameplay never reads it.
 *
 * `destroy()` removes the listener, so a scene that shuts down does not leave one behind.
 * SSR-safe: with no `window` (or no `matchMedia`) motion is simply allowed.
 */

export interface MotionPreference {
  /** True while the player asks the browser for reduced motion. */
  readonly reduced: boolean;
  destroy(): void;
}

export function watchReducedMotion(): MotionPreference {
  const query: MediaQueryList | null =
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = query?.matches ?? false;
  const onChange = (event: MediaQueryListEvent) => {
    reduced = event.matches;
  };
  query?.addEventListener?.("change", onChange);
  return {
    get reduced() {
      return reduced;
    },
    destroy() {
      query?.removeEventListener?.("change", onChange);
    },
  };
}
