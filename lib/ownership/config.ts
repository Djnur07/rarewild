/**
 * RAREWILD collection configuration, read from public environment variables:
 *
 *   NEXT_PUBLIC_RAREWILD_CONTRACT_ADDRESS  the collection's ERC-721 contract
 *   NEXT_PUBLIC_RAREWILD_CHAIN_ID          the chain that contract lives on (optional)
 *   NEXT_PUBLIC_RAREWILD_RPC_URL           a read-only JSON-RPC endpoint (optional)
 *
 * There is deliberately no default contract address: until one is supplied
 * the status is "missing" and ownership detection is simply unavailable.
 */

import { isAddress, isZeroAddress } from "./address.ts";

export type CollectionConfig =
  | { status: "missing" }
  | { status: "invalid"; problems: string[] }
  | {
      status: "configured";
      contractAddress: string;
      /** Chain the contract is on, when configured. */
      chainId: number | null;
      /** Read-only RPC endpoint, when configured (otherwise the wallet's own provider is used). */
      rpcUrl: string | null;
    };

export type RawCollectionEnv = {
  contractAddress?: string;
  chainId?: string;
  rpcUrl?: string;
};

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/** Pure parser (no process.env access), so it can be tested with any input. */
export function parseCollectionConfig(env: RawCollectionEnv): CollectionConfig {
  if (blank(env.contractAddress)) return { status: "missing" };

  const problems: string[] = [];
  const contractAddress = env.contractAddress!.trim();
  if (!isAddress(contractAddress)) {
    problems.push("the contract address must be 0x followed by 40 hex characters");
  } else if (isZeroAddress(contractAddress)) {
    problems.push("the contract address cannot be the zero address");
  }

  let chainId: number | null = null;
  if (!blank(env.chainId)) {
    const text = env.chainId!.trim();
    const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0) chainId = parsed;
    else problems.push("the chain id must be a positive whole number");
  }

  let rpcUrl: string | null = null;
  if (!blank(env.rpcUrl)) {
    try {
      const url = new URL(env.rpcUrl!.trim());
      if (url.protocol === "http:" || url.protocol === "https:") rpcUrl = url.toString();
      else problems.push("the RPC URL must start with http:// or https://");
    } catch {
      problems.push("the RPC URL is not a valid URL");
    }
  }

  if (problems.length > 0) return { status: "invalid", problems };
  return { status: "configured", contractAddress: contractAddress.toLowerCase(), chainId, rpcUrl };
}

/** Reads the public env vars. Each must be referenced literally so Next can inline it into the client bundle. */
export function readCollectionConfig(): CollectionConfig {
  return parseCollectionConfig({
    contractAddress: process.env.NEXT_PUBLIC_RAREWILD_CONTRACT_ADDRESS,
    chainId: process.env.NEXT_PUBLIC_RAREWILD_CHAIN_ID,
    rpcUrl: process.env.NEXT_PUBLIC_RAREWILD_RPC_URL,
  });
}
