"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  WalletError,
  connectWallet,
  getInjectedFallback,
  isAddress,
  parseChainId,
  revokeSiteAccess,
  subscribeToWallets,
  switchWalletChain,
} from "@/lib/ownership";
import type { Eip1193Provider, WalletInfo } from "@/lib/ownership";

export type WalletSessionState = {
  wallet: WalletInfo;
  address: string;
  chainId: number | null;
};

/**
 * Wallet connection state for the UI. Connecting only ever happens on an
 * explicit call to `connect` (a click), and asks for account access only —
 * never a signature or a transaction. Failures land in `error` as
 * player-readable text; nothing here throws into the game.
 */
export function useWallet() {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [session, setSession] = useState<WalletSessionState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => subscribeToWallets(setWallets), []);

  const provider: Eip1193Provider | null = session?.wallet.provider ?? null;
  useEffect(() => {
    if (!provider) return;
    const onAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? accounts.find(isAddress) : undefined;
      // No account left means the player disconnected from inside the wallet.
      setSession((current) => (current && next ? { ...current, address: next.toLowerCase() } : null));
    };
    const onChainChanged = (chainId: unknown) => {
      setSession((current) => (current ? { ...current, chainId: parseChainId(chainId) } : null));
    };
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [provider]);

  /** Connect to the given discovered wallet id, or the only/first available wallet. */
  const connect = useCallback(
    async (walletId?: string) => {
      const available = wallets.length > 0 ? wallets : [getInjectedFallback()].filter((w): w is WalletInfo => w !== null);
      const target = walletId ? available.find((w) => w.id === walletId) : available[0];
      if (!target) {
        setError("No browser wallet found. Install MetaMask or another EVM wallet, then reload this page.");
        return;
      }
      const attempt = ++attemptRef.current;
      setConnecting(true);
      setError(null);
      try {
        const { address, chainId } = await connectWallet(target.provider);
        if (attempt === attemptRef.current) setSession({ wallet: target, address, chainId });
      } catch (caught) {
        if (attempt === attemptRef.current) {
          setError(caught instanceof WalletError ? caught.message : "Could not connect to the wallet.");
        }
      } finally {
        if (attempt === attemptRef.current) setConnecting(false);
      }
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    attemptRef.current++; // abandon any connect still in flight
    const current = session;
    setSession(null);
    setConnecting(false);
    setError(null);
    if (current) void revokeSiteAccess(current.wallet.provider);
  }, [session]);

  const switchNetwork = useCallback(
    async (chainId: number) => {
      if (!session) return;
      setError(null);
      try {
        await switchWalletChain(session.wallet.provider, chainId);
      } catch (caught) {
        setError(caught instanceof WalletError ? caught.message : "Could not switch the network.");
      }
    },
    [session],
  );

  return { wallets, session, connecting, error, connect, disconnect, switchNetwork };
}
