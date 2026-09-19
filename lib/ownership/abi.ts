/**
 * The few ERC-721 read calls ownership detection needs, hand-encoded so no
 * ABI library is required. Every function here is a read-only `eth_call`
 * payload — nothing that could be a transaction or a signature request.
 */

import { isAddress } from "./address.ts";

export const SELECTORS = {
  balanceOf: "0x70a08231", // balanceOf(address)
  tokenOfOwnerByIndex: "0x2f745c59", // tokenOfOwnerByIndex(address,uint256)
  ownerOf: "0x6352211e", // ownerOf(uint256)
  supportsInterface: "0x01ffc9a7", // supportsInterface(bytes4)
} as const;

/** ERC-165 interface id of ERC721Enumerable. */
export const ERC721_ENUMERABLE_INTERFACE_ID = "0x780e9d63";

function word(hex: string): string {
  return hex.padStart(64, "0");
}

function encodeAddress(address: string): string {
  if (!isAddress(address)) throw new Error(`Invalid address: ${address}`);
  return word(address.slice(2).toLowerCase());
}

function encodeUint(value: bigint | number): string {
  const big = BigInt(value);
  if (big < 0n) throw new Error("Cannot encode a negative number");
  return word(big.toString(16));
}

export function encodeBalanceOf(owner: string): string {
  return SELECTORS.balanceOf + encodeAddress(owner);
}

export function encodeTokenOfOwnerByIndex(owner: string, index: bigint | number): string {
  return SELECTORS.tokenOfOwnerByIndex + encodeAddress(owner) + encodeUint(index);
}

export function encodeOwnerOf(tokenId: bigint | number): string {
  return SELECTORS.ownerOf + encodeUint(tokenId);
}

export function encodeSupportsInterface(interfaceId: string): string {
  if (!/^0x[0-9a-fA-F]{8}$/.test(interfaceId)) throw new Error(`Invalid interface id: ${interfaceId}`);
  return SELECTORS.supportsInterface + interfaceId.slice(2).toLowerCase().padEnd(64, "0");
}

function requireWord(result: string): string {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error(`Unexpected contract response: ${String(result).slice(0, 80)}`);
  }
  return result.slice(2);
}

export function decodeUint(result: string): bigint {
  return BigInt(`0x${requireWord(result)}`);
}

export function decodeBool(result: string): boolean {
  return decodeUint(result) !== 0n;
}

export function decodeAddress(result: string): string {
  return `0x${requireWord(result).slice(24).toLowerCase()}`;
}
