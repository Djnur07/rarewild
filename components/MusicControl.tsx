"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_MUSIC_STATE,
  getMusicState,
  setMusicMuted,
  setMusicVolume,
  startMusicOnFirstInteraction,
  subscribeToMusic,
} from "@/lib/audio/music";

/**
 * Mute button + volume slider for the background music, in the bottom-right
 * corner. It sits outside the "Wallet & Skins" drawer and outside Phaser, and
 * only talks to the shared music player, so opening the drawer or changing
 * skins can never restart or interrupt the music.
 */
export default function MusicControl() {
  const { volume, muted } = useSyncExternalStore(subscribeToMusic, getMusicState, () => DEFAULT_MUSIC_STATE);
  const silent = muted || volume === 0;

  useEffect(() => startMusicOnFirstInteraction(), []);

  return (
    <div
      className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded bg-black/70 px-2 py-1 font-mono text-xs text-zinc-200"
      data-testid="music-control"
    >
      <button
        type="button"
        aria-label={silent ? "Unmute music" : "Mute music"}
        aria-pressed={silent}
        title={silent ? "Unmute music" : "Mute music"}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10"
        onClick={(event) => {
          // Un-muting at volume 0 would still be silent, so bring the volume up as well.
          if (silent && volume === 0) setMusicVolume(0.22);
          else setMusicMuted(!muted);
          event.currentTarget.blur(); // keep Space/Enter from re-triggering the button while playing
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
          {silent ? (
            <path d="m16 9 5 6m0-6-5 6" />
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 6a9 9 0 0 1 0 12" />
            </>
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round((muted ? 0 : volume) * 100)}
        aria-label="Music volume"
        title={`Music volume ${Math.round((muted ? 0 : volume) * 100)}%`}
        className="h-1 w-20 cursor-pointer accent-emerald-500"
        onChange={(event) => setMusicVolume(Number(event.target.value) / 100)}
        // Drop focus after a mouse/touch drag so the arrow keys keep steering Rara instead of nudging the slider.
        onPointerUp={(event) => event.currentTarget.blur()}
      />
    </div>
  );
}
