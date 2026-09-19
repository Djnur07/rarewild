"use client";

import { useState } from "react";

/**
 * Collapsible panel floating over the top-right corner of the game, so the
 * skin/wallet controls don't take space away from the full-window canvas.
 * Children stay mounted while it is closed, so wallet state survives.
 */
export default function OverlayDrawer({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] flex-col items-end gap-2 font-mono text-sm">
      <button
        type="button"
        aria-expanded={open}
        className="rounded bg-black/70 px-3 py-1 text-zinc-100 hover:bg-black/85"
        onClick={(event) => {
          setOpen((current) => !current);
          event.currentTarget.blur(); // keep keyboard focus off the button so Space/Enter can't re-trigger it mid-game
        }}
      >
        {open ? "Close" : label}
      </button>
      <div
        className={`${open ? "flex" : "hidden"} w-[min(30rem,calc(100vw-1.5rem))] flex-col gap-4 overflow-y-auto rounded bg-black/80 p-3`}
        data-testid="overlay-drawer"
      >
        {children}
      </div>
    </div>
  );
}
