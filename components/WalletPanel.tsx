"use client";

import { useState } from "react";
import { readCollectionConfig, shortenAddress } from "@/lib/ownership";
import type { RareWildSkin } from "@/lib/rareWild";
import { useOwnedRareWild } from "@/components/wallet/useOwnedRareWild";
import { useWallet } from "@/components/wallet/useWallet";

/** Read once: the values are inlined at build time from NEXT_PUBLIC_RAREWILD_* (see .env.example). */
const COLLECTION_CONFIG = readCollectionConfig();
const THUMBNAILS_PER_PAGE = 48;

type Props = {
  activeSkin: RareWildSkin;
  /** Make a token Rara's active skin. The panel never touches the game directly. */
  onSelectToken: (tokenId: number) => void;
};

/**
 * Wallet connection + "Your RAREWILD" panel, rendered under the game canvas
 * (outside Phaser, so it can't interfere with game input). Connecting only
 * requests account access — no signatures, no transactions.
 */
export default function WalletPanel({ activeSkin, onSelectToken }: Props) {
  const { wallets, session, connecting, error, connect, disconnect, switchNetwork } = useWallet();
  const { state, reload } = useOwnedRareWild(session, COLLECTION_CONFIG);
  const [choosing, setChoosing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(THUMBNAILS_PER_PAGE);

  const button = "rounded bg-zinc-800 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50";
  // Keep keyboard focus off the buttons so Space/Enter can't re-trigger them while playing.
  const blurAfter = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    action();
    event.currentTarget.blur();
  };

  const onConnectClick = () => {
    if (wallets.length > 1) setChoosing((open) => !open);
    else void connect();
  };

  return (
    <section className="w-full font-mono text-sm text-zinc-200" data-testid="wallet-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-400">Wallet</span>
        {session ? (
          <>
            <span className="rounded bg-zinc-800 px-3 py-1 text-emerald-300" data-testid="wallet-address" title={session.address}>
              {shortenAddress(session.address)}
            </span>
            <span className="text-zinc-500">{session.wallet.name}</span>
            <button type="button" className={button} onClick={blurAfter(disconnect)}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" className={button} disabled={connecting} onClick={blurAfter(onConnectClick)}>
            {connecting ? "Check your wallet…" : "Connect Wallet"}
          </button>
        )}
      </div>

      {!session && choosing && wallets.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="wallet-picker">
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              className={`${button} flex items-center gap-2`}
              onClick={blurAfter(() => {
                setChoosing(false);
                void connect(wallet.id);
              })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny data-URI icon announced by the wallet */}
              {wallet.icon && <img src={wallet.icon} alt="" width={16} height={16} />}
              {wallet.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-2 text-amber-300" data-testid="wallet-error">
          {error}
        </div>
      )}

      <h3 className="mt-3 text-zinc-400">Your RAREWILD</h3>
      <div className="mt-1 leading-5" data-testid="owned-panel" data-state={state.status}>
        {state.status === "disconnected" && <div>Connect wallet to see your RAREWILD NFTs.</div>}

        {state.status === "not-configured" && (
          <div className="text-amber-300">
            Collection contract is not configured.
            <div className="text-zinc-500">Set NEXT_PUBLIC_RAREWILD_CONTRACT_ADDRESS to enable NFT detection.</div>
          </div>
        )}

        {state.status === "invalid-config" && (
          <div className="text-amber-300">
            Collection contract settings are invalid: {state.problems.join("; ")}.
          </div>
        )}

        {state.status === "wrong-network" && (
          <div className="text-amber-300">
            Your wallet is on {state.walletChainId === null ? "an unknown network" : `chain ${state.walletChainId}`}, but the
            RAREWILD collection is on chain {state.expectedChainId}.{" "}
            <button type="button" className={button} onClick={blurAfter(() => void switchNetwork(state.expectedChainId))}>
              Switch network
            </button>
          </div>
        )}

        {state.status === "loading" && <div className="text-zinc-400">Looking for your RAREWILD NFTs…</div>}

        {state.status === "error" && (
          <div className="text-amber-300">
            {state.message}{" "}
            <button type="button" className={button} onClick={blurAfter(reload)}>
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && state.skins.length === 0 && (
          <div>
            No RAREWILD NFTs found in this wallet.
            {state.ignored > 0 && <span className="text-zinc-500"> ({state.ignored} unrecognized token(s) ignored.)</span>}
          </div>
        )}

        {state.status === "ready" && state.skins.length > 0 && (
          <>
            <div className="text-zinc-400">
              {state.skins.length} owned - click one to wear it as Rara&apos;s skin
              {state.ignored > 0 && `; ${state.ignored} unrecognized token(s) ignored`}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-2" data-testid="owned-list">
              {state.skins.slice(0, visibleCount).map((skin) => {
                const active = activeSkin.tokenId === skin.tokenId;
                return (
                  <li key={skin.tokenId}>
                    <button
                      type="button"
                      aria-label={`Use ${skin.name} as Rara's skin`}
                      aria-pressed={active}
                      data-token-id={skin.tokenId}
                      title={`${skin.name} - ${skin.tier}, rank ${skin.rank}\n${skin.accessory} / ${skin.bodyColor} / ${skin.expression} / ${skin.background}`}
                      className={`flex w-full items-center gap-2 rounded p-1 text-left text-xs ${
                        active ? "bg-emerald-700 text-white" : "bg-zinc-800 hover:bg-zinc-700"
                      }`}
                      onClick={blurAfter(() => onSelectToken(skin.tokenId))}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- static collection artwork; base URL may point at a CDN */}
                      <img src={skin.imagePath} alt="" width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded" />
                      <span className="min-w-0 leading-4" data-testid="owned-card-details">
                        <span className="block font-bold">#{skin.tokenId}</span>
                        <span className="block">
                          {skin.tier} - rank {skin.rank}
                        </span>
                        <span className="block truncate text-zinc-400">{skin.accessory}</span>
                        <span className="block truncate text-zinc-400">{skin.bodyColor}</span>
                        <span className="block truncate text-zinc-400">{skin.expression}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {state.skins.length > visibleCount && (
              <button type="button" className={`${button} mt-2`} onClick={blurAfter(() => setVisibleCount((n) => n + THUMBNAILS_PER_PAGE))}>
                Show more ({state.skins.length - visibleCount} left)
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
