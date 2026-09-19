/**
 * Ownership pipeline: collection config + connected wallet -> owned token
 * ids (or a precise reason why not). This module knows nothing about React,
 * Phaser or skins; callers map the ids to metadata (tokens.ts).
 *
 *   config.status = "missing"    -> { status: "not-configured" }  (no request is made)
 *   config.status = "invalid"    -> { status: "invalid-config" }
 *   RPC URL configured           -> read through that endpoint, whatever chain the wallet is on
 *   no RPC URL                   -> read through the wallet's provider, which must be on the collection chain
 */

import { RAREWILD_SUPPLY } from "../rareWild/traits.ts";
import type { CollectionConfig } from "./config.ts";
import { OwnershipError, fetchOwnedTokenIds } from "./lookup.ts";
import { RpcError, createHttpTransport, createProviderTransport, getChainId } from "./rpc.ts";
import type { Eip1193Like, RpcTransport } from "./rpc.ts";
import { normalizeTokenIds } from "./tokens.ts";

export type OwnedTokensResult =
  | { status: "not-configured" }
  | { status: "invalid-config"; problems: string[] }
  | { status: "wrong-network"; expectedChainId: number; walletChainId: number | null }
  | { status: "ready"; tokenIds: number[]; ignored: number }
  | { status: "error"; message: string };

export type LoadOwnedTokensInput = {
  config: CollectionConfig;
  /** Connected account (lowercase 0x address). */
  owner: string;
  walletProvider: Eip1193Like;
  walletChainId: number | null;
  /** Test seam: override the transport instead of building one from config/provider. */
  transport?: RpcTransport;
};

/**
 * The states that can be decided from configuration and the wallet's chain
 * alone, without any network request. Returns null when a lookup is needed.
 * The UI uses this to answer instantly; `loadOwnedTokenIds` applies the same
 * checks first, so the two can never disagree.
 */
export function checkPrerequisites(
  config: CollectionConfig,
  walletChainId: number | null,
  options: { customTransport?: boolean } = {},
): OwnedTokensResult | null {
  if (config.status === "missing") return { status: "not-configured" };
  if (config.status === "invalid") return { status: "invalid-config", problems: config.problems };
  const usingWalletProvider = config.rpcUrl === null && !options.customTransport;
  if (usingWalletProvider && config.chainId !== null && walletChainId !== config.chainId) {
    return { status: "wrong-network", expectedChainId: config.chainId, walletChainId };
  }
  return null;
}

export async function loadOwnedTokenIds(input: LoadOwnedTokensInput): Promise<OwnedTokensResult> {
  const { config, owner, walletProvider, walletChainId } = input;
  const blocked = checkPrerequisites(config, walletChainId, { customTransport: Boolean(input.transport) });
  if (blocked) return blocked;
  if (config.status !== "configured") return { status: "not-configured" }; // unreachable; narrows the type

  const transport = input.transport ?? (config.rpcUrl ? createHttpTransport(config.rpcUrl) : createProviderTransport(walletProvider));
  try {
    if (config.rpcUrl && config.chainId !== null) {
      const rpcChainId = await getChainId(transport);
      if (rpcChainId !== config.chainId) {
        return {
          status: "error",
          message: `The configured RPC URL is on chain ${rpcChainId}, but the collection is configured for chain ${config.chainId}.`,
        };
      }
    }
    const raw = await fetchOwnedTokenIds(transport, config.contractAddress, owner, { maxTokenId: RAREWILD_SUPPLY });
    const { tokenIds, ignored } = normalizeTokenIds(raw);
    return { status: "ready", tokenIds, ignored };
  } catch (error) {
    if (error instanceof OwnershipError) return { status: "error", message: error.message };
    if (error instanceof RpcError) return { status: "error", message: `Could not read from the network: ${error.message}` };
    return { status: "error", message: "Something went wrong while looking up your RAREWILD NFTs." };
  }
}
