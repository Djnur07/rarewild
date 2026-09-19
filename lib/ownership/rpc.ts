/**
 * Read-only JSON-RPC access. A transport is anything that can perform a
 * JSON-RPC request: either a plain HTTP endpoint (NEXT_PUBLIC_RAREWILD_RPC_URL)
 * or the connected wallet's own EIP-1193 provider. Only read methods
 * (`eth_call`, `eth_chainId`) are ever issued through it.
 */

export interface RpcTransport {
  request(method: string, params?: unknown[]): Promise<unknown>;
}

/** Failure of the RPC/provider itself (network, rate limit, revert, ...). */
export class RpcError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

export function createHttpTransport(url: string, fetchImpl: typeof fetch = fetch): RpcTransport {
  let nextId = 1;
  return {
    async request(method, params = []) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = (error as Error).name === "AbortError";
        throw new RpcError(timedOut ? "The RPC endpoint timed out." : "Could not reach the RPC endpoint.");
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new RpcError(`The RPC endpoint answered HTTP ${response.status}.`);
      let body: { result?: unknown; error?: { code?: number; message?: string } };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new RpcError("The RPC endpoint returned an unreadable response.");
      }
      if (body.error) throw new RpcError(body.error.message ?? "The RPC endpoint reported an error.", body.error.code ?? null);
      return body.result;
    },
  };
}

export type Eip1193Like = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

export function createProviderTransport(provider: Eip1193Like): RpcTransport {
  return {
    async request(method, params = []) {
      try {
        return await provider.request({ method, params });
      } catch (error) {
        const { code, message } = error as { code?: number; message?: string };
        throw new RpcError(message || "The wallet could not complete the request.", typeof code === "number" ? code : null);
      }
    },
  };
}

/** `eth_call` against the latest block; returns the raw hex result. */
export async function ethCall(transport: RpcTransport, to: string, data: string): Promise<string> {
  const result = await transport.request("eth_call", [{ to, data }, "latest"]);
  if (typeof result !== "string") throw new RpcError("The node returned an unexpected response.");
  return result;
}

/** The chain id the transport is connected to. */
export async function getChainId(transport: RpcTransport): Promise<number> {
  const result = await transport.request("eth_chainId");
  const parsed = typeof result === "string" && /^0x[0-9a-fA-F]+$/.test(result) ? Number(BigInt(result)) : NaN;
  if (!Number.isSafeInteger(parsed)) throw new RpcError("The node returned an invalid chain id.");
  return parsed;
}
