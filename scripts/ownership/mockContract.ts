/**
 * Test fixture: an in-memory ERC-721 "contract" behind the RpcTransport
 * interface. It decodes eth_call payloads on its own (independently of
 * lib/ownership/abi.ts) so the tests exercise the real encoders. Used by
 * validate-ownership.ts; contains no real addresses or endpoints.
 */

import type { RpcTransport } from "../../lib/ownership/rpc.ts";
import { RpcError } from "../../lib/ownership/rpc.ts";

const hex = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

export type MockContractOptions = {
  /** tokenId -> owner (lowercase address). */
  tokens: Record<number, string>;
  enumerable: boolean;
  chainId?: number;
  /** Simulate a missing contract (every eth_call returns "0x"). */
  noContract?: boolean;
  /** Throw this error for every request. */
  failWith?: Error;
};

export function createMockContract(options: MockContractOptions) {
  const stats = { requests: 0, calls: [] as string[] };
  const transport: RpcTransport = {
    async request(method, params = []) {
      stats.requests++;
      if (options.failWith) throw options.failWith;
      if (method === "eth_chainId") return `0x${(options.chainId ?? 1).toString(16)}`;
      if (method !== "eth_call") throw new RpcError(`unexpected method ${method}`);
      const data = (params[0] as { data: string }).data;
      const selector = data.slice(0, 10);
      const words: string[] = data.slice(10).match(/.{64}/g) ?? [];
      stats.calls.push(selector);
      if (options.noContract) return "0x";

      const ownerArg = () => `0x${words[0].slice(24)}`;
      const owned = (address: string) =>
        Object.entries(options.tokens)
          .filter(([, holder]) => holder === address)
          .map(([id]) => Number(id))
          .sort((a, b) => a - b);

      switch (selector) {
        case "0x70a08231": // balanceOf
          return hex(BigInt(owned(ownerArg()).length));
        case "0x01ffc9a7": // supportsInterface
          return hex(options.enumerable && words[0].startsWith("780e9d63") ? 1n : 0n);
        case "0x2f745c59": { // tokenOfOwnerByIndex
          if (!options.enumerable) throw new RpcError("execution reverted", 3);
          const id = owned(ownerArg())[Number(BigInt(`0x${words[1]}`))];
          if (id === undefined) throw new RpcError("execution reverted", 3);
          return hex(BigInt(id));
        }
        case "0x6352211e": { // ownerOf
          const holder = options.tokens[Number(BigInt(`0x${words[0]}`))];
          if (!holder) throw new RpcError("execution reverted: owner query for nonexistent token", 3);
          return hex(BigInt(holder));
        }
        default:
          throw new RpcError("execution reverted", 3);
      }
    },
  };
  return { transport, stats };
}
