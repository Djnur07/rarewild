/**
 * Short sound effects, synthesized with the Web Audio API: no audio files to download, nothing to
 * preload, and nothing here touches the background music element (lib/audio/music.ts).
 *
 * - They play through the game's ONE shared AudioContext (lib/audio/context.ts). Browsers keep it
 *   suspended until the player has interacted with the page (on phones it is unlocked by the same
 *   first touch that starts the music); if it cannot run, or Web Audio does not exist, effects are
 *   silently skipped.
 * - The effects follow the music controls: muted or at volume 0 means silent. On desktop the level
 *   rises a little with the volume slider; on a phone it follows the slider proportionally, so the
 *   slider audibly changes the effects (see `sfxLevel`).
 * - Every effect is a few oscillator notes of at most half a second. Each note disconnects itself
 *   when it ends, so nothing accumulates. A minimum gap per effect keeps a burst of events from
 *   stacking into noise, and jump / land / pickup vary slightly in pitch so they do not repeat exactly.
 * - `getSfxStats()` counts the effects that were triggered (whether or not they were audible), so the
 *   browser tests can check the game asks for the right sound at the right moment.
 */

import { isTouchPhone } from "../platform/touchPhone.ts";
import { sharedAudioContext } from "./context.ts";
import { getMusicState } from "./music.ts";

export type SfxName = "pickup" | "jump" | "land" | "danger" | "capture" | "complete";

export interface SfxOptions {
  /** 0..1, how strong (land: how hard the impact was). Default 1. */
  intensity?: number;
  /** pickup: the running count, which walks the chime up a small scale so successive pickups are not identical. */
  step?: number;
}

/** Fewest ms between two triggers of the same effect. */
const MIN_GAP_MS: Record<SfxName, number> = { pickup: 40, jump: 70, land: 120, danger: 1500, capture: 800, complete: 800 };

const stats: Record<SfxName, number> = { pickup: 0, jump: 0, land: 0, danger: 0, capture: 0, complete: 0 };
const lastTriggeredAt: Record<SfxName, number> = { pickup: -Infinity, jump: -Infinity, land: -Infinity, danger: -Infinity, capture: -Infinity, complete: -Infinity };

let master: GainNode | null = null;
let masterContext: AudioContext | null = null;

/** How many times each effect has been triggered since the page loaded (a development / test aid). */
export function getSfxStats(): Readonly<Record<SfxName, number>> {
  return { ...stats };
}

function audioContext(): AudioContext | null {
  const ac = sharedAudioContext();
  if (!ac) return null;
  if (masterContext !== ac || !master) {
    master = ac.createGain();
    master.connect(ac.destination);
    masterContext = ac;
  }
  if (ac.state === "suspended") void ac.resume().catch(() => undefined);
  return ac;
}

/**
 * The overall effects level (0 = silent) for the music controls' state. Desktop: the original curve,
 * a floor plus a little of the slider (0.16 + 0.34 * volume). Phone: 0 at the bottom of the slider and
 * 0.55 at the top, rising at every step in between (a power curve, so it never flattens out), with the
 * same loudness as desktop at the default volume. The slider therefore audibly changes the effects
 * everywhere along its length, which the desktop curve (a floor of 0.16) does not.
 */
export function sfxLevel(volume: number, muted: boolean, touchPhone: boolean): number {
  if (muted || volume <= 0) return 0;
  return touchPhone ? 0.55 * Math.min(1, volume) ** PHONE_SFX_EXPONENT : 0.16 + 0.34 * volume;
}

/** 0.55 * 0.22 ** 0.5616 = 0.235, the desktop level at the default volume (0.22). */
const PHONE_SFX_EXPONENT = 0.5616;

/** The level the effects would play at right now (a development / test aid). */
export function currentSfxLevel(): number {
  const { muted, volume } = getMusicState();
  return sfxLevel(volume, muted, isTouchPhone());
}

interface Note {
  /** Seconds after the effect starts. */
  at: number;
  freq: number;
  /** If given, the pitch glides to this over the note. */
  freqEnd?: number;
  duration: number;
  type: OscillatorType;
  /** Peak gain, 0..1 (before the master level). */
  peak: number;
}

function playNote(ac: AudioContext, out: AudioNode, start: number, note: Note) {
  const t0 = start + note.at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = note.type;
  osc.frequency.setValueAtTime(note.freq, t0);
  if (note.freqEnd) osc.frequency.exponentialRampToValueAtTime(note.freqEnd, t0 + note.duration);
  const attack = Math.min(0.012, note.duration / 3);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(note.peak, 0.0002), t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.duration);
  osc.connect(gain).connect(out);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(t0);
  osc.stop(t0 + note.duration + 0.02);
}

/** A pentatonic walk (semitones above the base note), so pickups climb without ever clashing. */
const PICKUP_STEPS = [0, 2, 4, 7, 9];

function notesFor(name: SfxName, { intensity = 1, step = 0 }: SfxOptions): Note[] {
  const jitter = 1 + (Math.random() - 0.5) * 0.08; // +-4% so repeats are not identical
  switch (name) {
    case "pickup": {
      const semitones = PICKUP_STEPS[Math.abs(Math.floor(step)) % PICKUP_STEPS.length];
      const f = 660 * 2 ** (semitones / 12);
      return [
        { at: 0, freq: f, duration: 0.07, type: "triangle", peak: 0.5 },
        { at: 0.055, freq: f * 1.5, duration: 0.11, type: "triangle", peak: 0.45 },
      ];
    }
    case "jump":
      return [{ at: 0, freq: 280 * jitter, freqEnd: 500 * jitter, duration: 0.11, type: "triangle", peak: 0.26 }];
    case "land": {
      const s = Math.min(1, Math.max(0, intensity));
      return [
        { at: 0, freq: 150 * jitter, freqEnd: 62, duration: 0.1, type: "sine", peak: 0.16 + 0.34 * s },
        { at: 0, freq: 320 * jitter, freqEnd: 140, duration: 0.04, type: "triangle", peak: 0.08 + 0.1 * s },
      ];
    }
    case "danger":
      return [
        { at: 0, freq: 392, duration: 0.09, type: "triangle", peak: 0.34 },
        { at: 0.1, freq: 311, duration: 0.16, type: "triangle", peak: 0.32 },
      ];
    case "capture":
      return [
        { at: 0, freq: 230, freqEnd: 55, duration: 0.34, type: "sine", peak: 0.6 },
        { at: 0, freq: 170, freqEnd: 80, duration: 0.2, type: "triangle", peak: 0.22 },
      ];
    case "complete":
      return [523, 659, 784, 1047].map((freq, i) => ({ at: i * 0.09, freq, duration: i === 3 ? 0.32 : 0.16, type: "triangle" as OscillatorType, peak: 0.36 }));
  }
}

/** Play one effect (subject to the mute / volume of the music controls and the per-effect minimum gap). */
export function playSfx(name: SfxName, options: SfxOptions = {}): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastTriggeredAt[name] < MIN_GAP_MS[name]) return;
  lastTriggeredAt[name] = now;
  stats[name]++;

  const level = currentSfxLevel();
  if (level <= 0) return;
  const ac = audioContext();
  if (!ac || !master || ac.state !== "running") return;
  master.gain.value = level;
  const start = ac.currentTime + 0.005;
  for (const note of notesFor(name, options)) playNote(ac, master, start, note);
}
