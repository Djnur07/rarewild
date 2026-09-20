"use client";

import { useState } from "react";
import type { RareWildSkin } from "@/lib/rareWild";

/** Quick-pick tokens for local skin testing: first, second and last of the collection. */
const PRESET_TOKENS = [1, 2, 4444];

type Props = {
  activeSkin: RareWildSkin;
  notice: string | null;
  onSelect: (input: string | number | null) => void;
};

/**
 * Development skin picker shown in the Wallet & Skins overlay (outside Phaser,
 * so it never competes with gameplay input). Picks any RAREWILD token id to
 * preview; it does no ownership check and is never a claim that the wallet
 * owns the token. Owned NFTs are listed separately, in WalletPanel.
 */
export default function SkinSelector({ activeSkin, notice, onSelect }: Props) {
  const [tokenInput, setTokenInput] = useState("");

  const buttonClass = (active: boolean) =>
    `rounded px-3 py-1 text-sm ${active ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}`;

  return (
    <div className="w-full font-mono text-sm text-zinc-200" data-testid="skin-selector">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-400" title="Preview any token; not tied to your wallet">Preview skin</span>
        <button
          type="button"
          className={buttonClass(activeSkin.isDefault)}
          onClick={(event) => {
            onSelect(null);
            event.currentTarget.blur();
          }}
        >
          Default
        </button>
        {PRESET_TOKENS.map((tokenId) => (
          <button
            key={tokenId}
            type="button"
            className={buttonClass(activeSkin.tokenId === tokenId)}
            onClick={(event) => {
              onSelect(tokenId);
              event.currentTarget.blur();
            }}
          >
            #{tokenId}
          </button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSelect(tokenInput);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input
            aria-label="RAREWILD token id"
            className="w-24 rounded bg-zinc-800 px-2 py-1 text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500"
            inputMode="numeric"
            placeholder="token id"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          <button type="submit" className={buttonClass(false)}>
            Load
          </button>
        </form>
      </div>

      <div className="mt-2 leading-5" data-testid="skin-info">
        {activeSkin.isDefault ? (
          <div>Rara (default skin)</div>
        ) : (
          <>
            <div className="text-emerald-300">{activeSkin.name}</div>
            <div>{activeSkin.tier}</div>
            <div>{activeSkin.accessory}</div>
            <div>{activeSkin.background}</div>
            <div>{activeSkin.bodyColor}</div>
            <div>{activeSkin.expression}</div>
            <div>Rank {activeSkin.rank}</div>
          </>
        )}
        {notice && <div className="text-amber-300">{notice}</div>}
      </div>
    </div>
  );
}
