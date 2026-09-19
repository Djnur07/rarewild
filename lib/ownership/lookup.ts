/**
 * ERC-721 ownership lookup: which token ids does `owner` hold in `contract`?
 *
 *  1. If the contract supports ERC721Enumerable, ask it directly
 *     (balanceOf, then tokenOfOwnerByIndex for each index).
 *  2. Otherwise fall back to scanning ownerOf(1..maxTokenId) and keeping the
 *     tokens whose owner matches. RAREWILD has a fixed, small supply
 *     (4,444), so this stays bounded; it stops early once every token the
 *     wallet holds (balanceOf) has been found.
 *
 * Read-only: only `eth_call`s are issued. Token ids come back as bigint and
 * are normalized/validated separately (tokens.ts).
 */

import {
  ERC721_ENUMERABLE_INTERFACE_ID,
  decodeAddress,
  decodeBool,
  decodeUint,
  encodeBalanceOf,
  encodeOwnerOf,
  encodeSupportsInterface,
  encodeTokenOfOwnerByIndex,
} from "./abi.ts";
import { RpcError, ethCall } from "./rpc.ts";
import type { RpcTransport } from "./rpc.ts";

/** Lookup failed in a way worth telling the player about. */
export class OwnershipError extends Error {
  readonly reason: "no-contract" | "unsupported" | "rpc";
  constructor(reason: OwnershipError["reason"], message: string) {
    super(message);
    this.name = "OwnershipError";
    this.reason = reason;
  }
}

const CONCURRENCY = 12;

/** True when the node/wallet reports the call reverted (as opposed to failing to run at all). */
function isRevert(error: RpcError): boolean {
  return error.code === 3 || /revert/i.test(error.message);
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function call(transport: RpcTransport, contract: string, data: string): Promise<string> {
  const result = await ethCall(transport, contract, data);
  // An empty result means there is no contract with this interface at the address on this chain.
  if (result === "0x") throw new OwnershipError("no-contract", "No collection contract was found at that address on this network.");
  return result;
}

async function supportsEnumerable(transport: RpcTransport, contract: string): Promise<boolean> {
  try {
    return decodeBool(await call(transport, contract, encodeSupportsInterface(ERC721_ENUMERABLE_INTERFACE_ID)));
  } catch {
    // Not ERC-165, or the call reverted: treat as "not enumerable" and use the scan fallback.
    return false;
  }
}

export async function fetchOwnedTokenIds(
  transport: RpcTransport,
  contract: string,
  owner: string,
  options: { maxTokenId: number },
): Promise<bigint[]> {
  const { maxTokenId } = options;

  let balance: bigint;
  try {
    balance = decodeUint(await call(transport, contract, encodeBalanceOf(owner)));
  } catch (error) {
    if (error instanceof OwnershipError || error instanceof RpcError) throw error;
    throw new OwnershipError("unsupported", "The contract does not look like an ERC-721 collection.");
  }
  if (balance === 0n) return [];
  if (balance > BigInt(maxTokenId)) {
    throw new OwnershipError("unsupported", "The contract reports more tokens than the RAREWILD collection contains.");
  }

  if (await supportsEnumerable(transport, contract)) {
    const indexes = Array.from({ length: Number(balance) }, (_, i) => i);
    return mapWithConcurrency(indexes, CONCURRENCY, async (index) =>
      decodeUint(await call(transport, contract, encodeTokenOfOwnerByIndex(owner, index))),
    );
  }

  // Fallback: scan ownerOf across the whole (small, fixed) supply.
  const wallet = owner.toLowerCase();
  const found: bigint[] = [];
  const target = Number(balance);
  const batchSize = CONCURRENCY * 8;
  for (let start = 1; start <= maxTokenId && found.length < target; start += batchSize) {
    const ids = Array.from({ length: Math.min(batchSize, maxTokenId - start + 1) }, (_, i) => start + i);
    const owners = await mapWithConcurrency(ids, CONCURRENCY, async (tokenId) => {
      try {
        return decodeAddress(await call(transport, contract, encodeOwnerOf(tokenId)));
      } catch (error) {
        // ownerOf reverts for tokens that don't exist (yet): simply not owned.
        // Any other failure (network, timeout, rate limit) must surface, not look like "owns nothing".
        if (error instanceof RpcError && isRevert(error)) return null;
        throw error;
      }
    });
    owners.forEach((tokenOwner, i) => {
      if (tokenOwner === wallet) found.push(BigInt(ids[i]));
    });
  }
  return found;
}
