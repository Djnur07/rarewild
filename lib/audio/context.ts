/**
 * The ONE Web Audio context the game shares. The sound effects (lib/audio/sfx.ts) play through it, and
 * on phones the background music does too (lib/audio/music.ts), so there is a single audio graph and a
 * single place to unlock it, not two.
 *
 * Browsers keep a context suspended until the player has interacted with the page, and iOS Safari in
 * particular only lets it start from inside a touch handler. So it is created and resumed from the
 * same gestures that already start the music, and resumed again if the system suspends it later (a
 * phone call, the tab going to the background). Creating it is lazy: nothing exists until it is needed.
 */

let context: AudioContext | null = null;
let unavailable = false;

/** The shared context, created on first use; null where Web Audio does not exist. */
export function sharedAudioContext(): AudioContext | null {
  if (unavailable || typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      unavailable = true;
      return null;
    }
    try {
      context = new Ctor();
    } catch {
      unavailable = true;
      return null;
    }
  }
  return context;
}

/** Resume the context if it exists and is not running. Never creates one. Safe to call as often as you like. */
export function resumeAudioContext(): void {
  if (context && context.state !== "running") void context.resume().catch(() => undefined);
}

/** The context's state ("running", "suspended", ...), or null if there is none yet. */
export function audioContextState(): string | null {
  return context ? context.state : null;
}
