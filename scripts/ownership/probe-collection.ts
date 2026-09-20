/**
 * Read-only check of the configured RAREWILD collection contract, using the
 * same code the game uses. Only eth_chainId / eth_getCode / eth_call are sent:
 * no transactions, no signing, no keys.
 *
 *   node --env-file=.env.local scripts/ownership/probe-collection.ts [owner-address]
 *
 * Reports whether the RPC is reachable, the chain id matches, the contract has
 * code, behaves as ERC-721 (ERC-165), whether it is Enumerable (which decides
 * the lookup strategy), and, for the given owner address (default: an unused
 * address), what `fetchOwnedTokenIds` returns. It never invents or lists test
 * NFTs: token ids come only from the contract.
 */

import {
  ERC721_ENUMERABLE_INTERFACE_ID,
  decodeAddress,
  decodeBool,
  decodeUint,
  encodeOwnerOf,
  encodeSupportsInterface,
} from "../../lib/ownership/abi.ts";
import { isAddress } from "../../lib/ownership/address.ts";
import { readCollectionConfig } from "../../lib/ownership/config.ts";
import { fetchOwnedTokenIds } from "../../lib/ownership/lookup.ts";
import { RpcError, createHttpTransport, ethCall, getChainId } from "../../lib/ownership/rpc.ts";
import { normalizeTokenIds } from "../../lib/ownership/tokens.ts";
import { RAREWILD_SUPPLY } from "../../lib/rareWild/traits.ts";

const ERC165_INTERFACE_ID = "0x01ffc9a7";
const INVALID_INTERFACE_ID = "0xffffffff"; // a correct ERC-165 contract must answer false
const ERC721_INTERFACE_ID = "0x80ac58cd";
const ERC721_METADATA_INTERFACE_ID = "0x5b5e139f";
const UNUSED_ADDRESS = "0x000000000000000000000000000000000000dEaD";

let hardFailures = 0;
function report(label: string, ok: boolean | null, detail = "") {
  const tag = ok === null ? "INFO" : ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${label}${detail ? `  (${detail})` : ""}`);
  if (ok === false) hardFailures++;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function decodeString(hex: string): string {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const length = Number(BigInt(`0x${bytes.subarray(32, 64).toString("hex")}`));
  return bytes.subarray(64, 64 + length).toString("utf8");
}

async function main() {
  const config = readCollectionConfig();
  if (config.status !== "configured") {
    report("collection configuration", false, config.status === "missing" ? "contract address is not set" : config.problems.join("; "));
    return;
  }
  report("collection configuration", true, `${config.contractAddress} chain ${config.chainId ?? "unset"}`);
  if (!config.rpcUrl) {
    report("RPC URL", false, "NEXT_PUBLIC_RAREWILD_RPC_URL is not set; this probe reads through it");
    return;
  }

  // A plain request first, so a network problem (DNS, firewall) is told apart from a contract problem.
  try {
    await fetch(config.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; hostname?: string } }).cause;
    report("RPC endpoint reachable", false, `${cause?.code ?? message(error)}${cause?.hostname ? ` for ${cause.hostname}` : ""}`);
    console.log("      The request never reached the RPC server. Check DNS/firewall/VPN for this host from this machine.");
    return;
  }
  const transport = createHttpTransport(config.rpcUrl);
  const call = (data: string) => ethCall(transport, config.contractAddress, data);
  const interfaceSupported = async (id: string) => decodeBool(await call(encodeSupportsInterface(id)));
  report("RPC endpoint reachable", true, config.rpcUrl);

  const chainId = await getChainId(transport);
  report("chain id matches configuration", config.chainId === null ? null : chainId === config.chainId, `RPC says ${chainId}`);

  const code = (await transport.request("eth_getCode", [config.contractAddress, "latest"])) as string;
  report("contract has code at the address", typeof code === "string" && code !== "0x", `${(code.length - 2) / 2} bytes`);
  if (code === "0x") return;

  let erc165 = false;
  try {
    erc165 = (await interfaceSupported(ERC165_INTERFACE_ID)) && !(await interfaceSupported(INVALID_INTERFACE_ID));
  } catch (error) {
    report("ERC-165 supportsInterface", null, `not available: ${message(error)}`);
  }
  let erc721 = false;
  let enumerable = false;
  if (erc165) {
    report("ERC-165 supportsInterface", true);
    erc721 = await interfaceSupported(ERC721_INTERFACE_ID);
    report("supports ERC-721", erc721);
    report("supports ERC-721 Metadata", null, String(await interfaceSupported(ERC721_METADATA_INTERFACE_ID)));
    enumerable = await interfaceSupported(ERC721_ENUMERABLE_INTERFACE_ID);
    report("supports ERC-721 Enumerable", null, String(enumerable));
  }

  for (const [label, selector, decode] of [
    ["name()", "0x06fdde03", decodeString],
    ["symbol()", "0x95d89b41", decodeString],
    ["totalSupply()", "0x18160ddd", (hex: string) => decodeUint(hex).toString()],
  ] as const) {
    try {
      report(label, null, decode(await call(selector)));
    } catch (error) {
      report(label, null, `not available: ${message(error)}`);
    }
  }

  // ownerOf on the first and last valid ids: a revert means "not minted yet", which is fine and is not treated as an error.
  for (const tokenId of [1, RAREWILD_SUPPLY]) {
    try {
      report(`ownerOf(${tokenId})`, null, decodeAddress(await call(encodeOwnerOf(tokenId))));
    } catch (error) {
      report(`ownerOf(${tokenId})`, null, error instanceof RpcError && (error.code === 3 || /revert/i.test(error.message)) ? "reverts (token not minted)" : `unexpected: ${message(error)}`);
    }
  }

  const owner = process.argv[2] ?? UNUSED_ADDRESS;
  if (!isAddress(owner)) {
    report("owner argument", false, "not a valid 0x address");
    return;
  }
  const raw = await fetchOwnedTokenIds(transport, config.contractAddress, owner.toLowerCase(), { maxTokenId: RAREWILD_SUPPLY });
  const { tokenIds, ignored } = normalizeTokenIds(raw);
  report(`ownership lookup for ${owner}`, true, `${tokenIds.length} token(s) [${tokenIds.slice(0, 20).join(",")}], ${ignored} ignored`);
  report("lookup strategy the game will use", null, enumerable ? "ERC-721 Enumerable (tokenOfOwnerByIndex)" : "ownerOf scan of token ids 1-4444");
}

main()
  .catch((error: unknown) => {
    report("probe", false, message(error));
  })
  .finally(() => {
    console.log(hardFailures === 0 ? "\nProbe finished with no failures." : `\n${hardFailures} check(s) FAILED.`);
    process.exit(hardFailures === 0 ? 0 : 1);
  });
