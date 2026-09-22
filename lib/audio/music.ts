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
 * - On a phone or tablet the same element is routed through a gain node on the game's shared audio
 *   context (lib/audio/context.ts), and the slider sets that gain. iOS Safari ignores
 *   `HTMLAudioElement.volume` (it always plays at full volume), so without this the slider does
 *   nothing there. Desktop keeps using `element.volume` exactly as before.
 */

import { audioContextState, resumeAudioContext, sharedAudioContext } from "./context.ts";
import { isTouchPhone } from "../platform/touchPhone.ts";

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
/** Phones only: the gain node the music element plays through (null on desktop, or if routing was not possible). */
let gain: GainNode | null = null;
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

/** Push the volume / mute to whatever produces the sound: the gain node on a phone, the element itself elsewhere. */
function applyOutput(element: HTMLAudioElement, next: MusicState) {
  if (gain) {
    element.volume = 1; // the gain node is the only volume control while routed
    element.muted = next.muted;
    gain.gain.value = next.muted ? 0 : next.volume;
  } else {
    element.volume = next.volume;
    element.muted = next.muted;
  }
}

/** Phones only: play the element through a gain node so its volume can be controlled on iOS. Falls back to element.volume if that is not possible. */
function routeThroughGain(element: HTMLAudioElement) {
  if (!isTouchPhone() || gain) return;
  const ac = sharedAudioContext();
  if (!ac) return;
  try {
    const node = ac.createGain();
    ac.createMediaElementSource(element).connect(node);
    node.connect(ac.destination);
    gain = node;
    applyOutput(element, getMusicState());
  } catch {
    gain = null; // the element keeps playing on its own, with element.volume
  }
}

/** What is actually producing the sound right now (a development / test aid). */
export function getMusicOutput() {
  return {
    routed: gain !== null,
    gain: gain ? gain.gain.value : null,
    elementVolume: audio ? audio.volume : null,
    elementMuted: audio ? audio.muted : null,
    contextState: audioContextState(),
    playing: audio ? !audio.paused : false,
  };
}

function update(next: MusicState) {
  state = next;
  if (audio) applyOutput(audio, next);
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
  // A phone unlocks its audio inside this gesture: iOS only starts an audio context from a touch handler.
  if (isTouchPhone()) resumeAudioContext();
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
    routeThroughGain(created);
    if (isTouchPhone()) resumeAudioContext();
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

  // Phones: the system can suspend the audio context later (a call, the tab in the background), which would silence
  // the routed music and the effects. Any later touch, or the page becoming visible again, brings it back.
  const onWake = () => resumeAudioContext();
  const watchWake = isTouchPhone();
  if (watchWake) {
    window.addEventListener("pointerdown", onWake, { capture: true, passive: true });
    window.addEventListener("touchend", onWake, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onWake);
  }

  return () => {
    removeGestureListeners();
    if (watchWake) {
      window.removeEventListener("pointerdown", onWake, true);
      window.removeEventListener("touchend", onWake, true);
      document.removeEventListener("visibilitychange", onWake);
    }
    audio?.pause();
  };
}
