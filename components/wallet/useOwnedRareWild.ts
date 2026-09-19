"use client";

import { useCallback, useEffect, useState } from "react";
import { checkPrerequisites, loadOwnedTokenIds, resolveOwnedSkins } from "@/lib/ownership";
import type { CollectionConfig } from "@/lib/ownership";
import { loadRareWildDataset } from "@/lib/rareWild";
import type { RareWildSkin } from "@/lib/rareWild";
import type { WalletSessionState } from "./useWallet";

export type OwnedRareWildState =
  | { status: "disconnected" }
  | { status: "not-configured" }
  | { status: "invalid-config"; problems: string[] }
  | { status: "wrong-network"; expectedChainId: number; walletChainId: number | null }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; skins: RareWildSkin[]; ignored: number };

/**
 * The connected wallet's RAREWILD NFTs as local skin records. States that
 * need no network (disconnected, contract not configured, wrong network)
 * are derived synchronously; only a real lookup touches the network. A
 * failed lookup becomes an `error` state — it never throws into the UI or
 * the game.
 */
export function useOwnedRareWild(session: WalletSessionState | null, config: CollectionConfig) {
  const [fetched, setFetched] = useState<{ key: string; state: OwnedRareWildState } | null>(null);
  const [nonce, setNonce] = useState(0);

  const prerequisite = session ? checkPrerequisites(config, session.chainId) : null;
  const key = session ? `${session.address}|${session.chainId}|${nonce}` : null;
  const needsLookup = session !== null && prerequisite === null;
  const provider = session?.wallet.provider ?? null;
  const address = session?.address ?? null;
  const chainId = session?.chainId ?? null;

  useEffect(() => {
    if (!needsLookup || !provider || !address || !key) return;
    let cancelled = false;

    (async (): Promise<OwnedRareWildState> => {
      const result = await loadOwnedTokenIds({ config, owner: address, walletProvider: provider, walletChainId: chainId });
      if (result.status !== "ready") return result as OwnedRareWildState;
      try {
        await loadRareWildDataset();
      } catch {
        return { status: "error", message: "Could not load the RAREWILD metadata." };
      }
      const { skins, unmatched } = resolveOwnedSkins(result.tokenIds);
      return { status: "ready", skins, ignored: result.ignored + unmatched };
    })()
      .catch((): OwnedRareWildState => ({ status: "error", message: "Something went wrong while looking up your RAREWILD NFTs." }))
      .then((state) => {
        if (!cancelled) setFetched({ key, state });
      });

    return () => {
      cancelled = true;
    };
  }, [needsLookup, provider, address, chainId, config, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  let state: OwnedRareWildState;
  if (!session) state = { status: "disconnected" };
  else if (prerequisite) state = prerequisite as OwnedRareWildState;
  else if (fetched && fetched.key === key) state = fetched.state;
  else state = { status: "loading" };

  return { state, reload };
}
