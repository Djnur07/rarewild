/** EVM address helpers. Format checks only — no checksum validation (that would need keccak). */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/;

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function isZeroAddress(value: string): boolean {
  return ZERO_ADDRESS.test(value);
}

/** "0x1234…abcd" for display. */
export function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
