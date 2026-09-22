/**
 * RAREWILD is landscape-first on a phone: turning sideways gives more width to see a Hunter coming (the same
 * wider landscape framing already used by the mobile camera and controls in lib/mobile/layout.ts). This
 * overlay covers the screen and asks a portrait phone to rotate, instead of showing a cramped portrait view.
 *
 * Pure CSS, gated on the same two media features the rest of the mobile UI already uses: `(hover: none) and
 * (pointer: coarse)` for "this is a touch phone" (see lib/platform/touchPhone.ts) and `(orientation: portrait)`
 * for "held upright". It needs no JavaScript and no orientation API — it reacts to a real rotation the instant
 * the media query stops matching, is invisible on desktop and in landscape by construction, and never locks or
 * requests any device orientation: rotating stays entirely the player's choice.
 *
 * It sits above the canvas, the HUD and the other overlays and fills the screen, but it never intercepts input
 * (see the note on `pointer-events-none` below): the game keeps receiving touches and running underneath exactly
 * as it always did, so this changes nothing about how the game plays, only what the player sees while portrait.
 */
export default function RotateDeviceOverlay() {
  return (
    <div
      // Always pointer-events-none: Phaser's touch input has its own window-level listener that processes a touch by its
      // coordinates even when the browser's own hit-test says some other element (like this one) was the actual target,
      // so a DOM overlay cannot reliably block canvas touches here. This stays purely visual, which also keeps every
      // existing touch / multi-touch behavior exactly as it was, matching the requirement not to change that behavior.
      className="pointer-events-none fixed inset-0 z-50 hidden flex-col items-center justify-center gap-4 bg-[#0b150f] px-8 text-center font-mono text-[#cfe8d5] [@media(hover:none)_and_(pointer:coarse)_and_(orientation:portrait)]:flex"
      role="alert"
      aria-live="polite"
    >
      <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#9ee493" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="7" y="2" width="10" height="16" rx="1.6" />
        <path d="M11 15.5h2" />
        <path d="M20 9a7 7 0 0 1-2 6.5l-1.4-1" />
        <path d="M15.6 15.5l1 3.3 3.4-.4" />
      </svg>
      <p className="text-lg font-bold text-white">Rotate your device</p>
      <p className="max-w-xs text-sm text-[#9ee493]">RAREWILD plays in landscape — turn your phone sideways to continue.</p>
    </div>
  );
}
