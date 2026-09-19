/**
 * Background music: ONE looping HTMLAudioElement shared by the whole page.
 *
 * - Nothing is created or downloaded until the player's first interaction
 *   (browsers block audio before that), so the page makes no audio request on
 *   load.
 * - Interaction events are retried until `play()` succeeds, so an autoplay
 *   refusal is never an error — the next click or key press simply tries again.
 * - There is only ever one element, so music can't start twice, and nothing in
 *   the game or UI (skins, drawer, wallet) touches it, so it never restarts.
 * - Volume and mute live here (not in React state), survive re-renders, and are
 *   remembered across visits.
 */

const MUSIC_SRC = "/audio/rarewild-theme.mp3";
const DEFAULT_VOLUME = 0.22;
const STORAGE_KEY = "rarewild:music";
/** Events that count as a user gesture in Chrome and Safari; whichever succeeds first starts the music. */
const GESTURE_EVENTS = ["pointerdown", "pointerup", "click", "touchend", "keydown"] as const;

export type MusicState = {
  /** 0..1 */
  volume: number;
  muted: boolean;
};

/** Server / first-paint state (also what a visitor with no saved preference gets). */
export const DEFAULT_MUSIC_STATE: MusicState = Object.freeze({ volume: DEFAULT_VOLUME, muted: false });

let state: MusicState | null = null;
let audio: HTMLAudioElement | null = null;
let unavailable = false;
const listeners = new Set<() => void>();

function readSaved(): MusicState {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<MusicState> | null;
    if (saved && typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1) {
      return { volume: saved.volume, muted: saved.muted === true };
    }
  } catch {
    // Storage blocked or corrupt: fall back to the defaults.
  }
  return { ...DEFAULT_MUSIC_STATE };
}

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / storage disabled: the setting just won't persist.
  }
}

/** Stable snapshot for useSyncExternalStore (same object until something changes). */
export function getMusicState(): MusicState {
  if (state === null) state = readSaved();
  return state;
}

export function subscribeToMusic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(next: MusicState) {
  state = next;
  if (audio) {
    audio.volume = next.volume;
    audio.muted = next.muted;
  }
  save();
  listeners.forEach((listener) => listener());
}

export function setMusicVolume(volume: number) {
  const clamped = Math.min(1, Math.max(0, volume));
  const current = getMusicState();
  // Raising the volume while muted is an obvious "unmute".
  update({ volume: clamped, muted: clamped > 0 ? false : current.muted });
}

export function setMusicMuted(muted: boolean) {
  update({ ...getMusicState(), muted });
}

function tryPlay(removeGestureListeners: () => void) {
  if (unavailable) return;
  if (!audio) {
    const created = new Audio(MUSIC_SRC);
    created.loop = true;
    created.preload = "auto";
    created.volume = getMusicState().volume;
    created.muted = getMusicState().muted;
    // A missing or undecodable file: give up quietly, the game carries on silently.
    created.addEventListener("error", () => {
      unavailable = true;
      removeGestureListeners();
    });
    audio = created;
  }
  if (!audio.paused) {
    removeGestureListeners();
    return;
  }
  // Older Safari returns undefined from play(); modern browsers return a promise that rejects if blocked.
  const attempt: Promise<void> | undefined = audio.play();
  attempt?.then(removeGestureListeners).catch((error: unknown) => {
    // NotAllowedError = still no user activation: keep listening and retry on the next gesture.
    if ((error as DOMException)?.name !== "NotAllowedError") {
      unavailable = true;
      removeGestureListeners();
    }
  });
}

/**
 * Start the music on the first user gesture. Returns a cleanup function that
 * removes the listeners and pauses the music (used when the page unmounts).
 */
export function startMusicOnFirstInteraction(): () => void {
  const onGesture = () => tryPlay(removeGestureListeners);
  const removeGestureListeners = () => {
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture, true);
  };
  for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, { capture: true, passive: true });

  return () => {
    removeGestureListeners();
    audio?.pause();
  };
}
