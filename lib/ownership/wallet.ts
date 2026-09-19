/**
 * Browser wallet access via EIP-6963 (multi-wallet discovery) with a
 * `window.ethereum` fallback for older injected wallets, talking to the
 * selected wallet through the standard EIP-1193 `request` API.
 *
 * Only these wallet methods are ever used: eth_requestAccounts (connect),
 * eth_chainId, wallet_switchEthereumChain (optional, on the player's
 * click), and a best-effort wallet_revokePermissions on disconnect. No
 * signing, no transactions, no keys — nothing here can move funds.
 */

import { isAddress } from "./address.ts";

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
};

export type WalletInfo = {
  /** Stable id: the wallet's EIP-6963 rdns, or "injected" for the legacy fallback. */
  id: string;
  name: string;
  /** Data-URI icon announced by the wallet, when it is a safe image. */
  icon: string | null;
  provider: Eip1193Provider;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

type AnnouncedProvider = {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider?: Eip1193Provider;
};

/**
 * Discover wallets announced through EIP-6963. `onChange` receives the full
 * list every time a new wallet announces itself. Returns an unsubscribe fn.
 */
export function subscribeToWallets(onChange: (wallets: WalletInfo[]) => void): () => void {
  const wallets = new Map<string, WalletInfo>();

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<AnnouncedProvider>).detail;
    if (!detail?.provider || typeof detail.provider.request !== "function") return;
    const id = detail.info?.rdns || detail.info?.uuid || detail.info?.name || `wallet-${wallets.size}`;
    const icon = detail.info?.icon;
    wallets.set(id, {
      id,
      name: detail.info?.name || "Browser wallet",
      icon: typeof icon === "string" && icon.startsWith("data:image/") ? icon : null,
      provider: detail.provider,
    });
    onChange([...wallets.values()]);
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}

/** Older wallets only inject `window.ethereum` and never announce over EIP-6963. */
export function getInjectedFallback(): WalletInfo | null {
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!provider || typeof provider.request !== "function") return null;
  return { id: "injected", name: "Browser wallet", icon: null, provider };
}

/** Wallet-facing failure with a message that is safe to show to the player. */
export class WalletError extends Error {
  readonly kind: "rejected" | "pending" | "no-accounts" | "unknown-chain" | "failed";
  constructor(kind: WalletError["kind"], message: string) {
    super(message);
    this.name = "WalletError";
    this.kind = kind;
  }
}

function toWalletError(error: unknown, fallback: string): WalletError {
  if (error instanceof WalletError) return error;
  const code = (error as { code?: number })?.code;
  if (code === 4001) return new WalletError("rejected", "The request was cancelled in your wallet.");
  if (code === -32002) return new WalletError("pending", "Your wallet already has a pending request. Open it to continue.");
  if (code === 4902) return new WalletError("unknown-chain", "Your wallet doesn't know this network yet. Add it in your wallet first.");
  return new WalletError("failed", fallback);
}

export function parseChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    const parsed = Number(BigInt(value));
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export type WalletSession = { address: string; chainId: number | null };

/** Ask the wallet for account access (shows the wallet's own connect prompt; no signature). */
export async function connectWallet(provider: Eip1193Provider): Promise<WalletSession> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (error) {
    throw toWalletError(error, "Could not connect to the wallet.");
  }
  const address = Array.isArray(accounts) ? accounts.find(isAddress) : undefined;
  if (!address) throw new WalletError("no-accounts", "The wallet did not share an account.");

  let chainId: number | null = null;
  try {
    chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
  } catch {
    // Chain is only used for a helpful network warning; connecting still succeeded.
  }
  return { address: address.toLowerCase(), chainId };
}

export async function switchWalletChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
  } catch (error) {
    throw toWalletError(error, "Could not switch the network.");
  }
}

/** Best effort: also drop this site's access in the wallet, so "Disconnect" is real. Failure is harmless. */
export async function revokeSiteAccess(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // Not supported by every wallet.
  }
}
