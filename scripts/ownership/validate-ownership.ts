/**
 * Validation for the wallet ownership layer (no real contract, wallet or
 * network involved — everything runs against in-memory fixtures).
 *
 *   node scripts/ownership/validate-ownership.ts
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ERC721_ENUMERABLE_INTERFACE_ID,
  decodeAddress,
  decodeBool,
  decodeUint,
  encodeBalanceOf,
  encodeOwnerOf,
  encodeSupportsInterface,
  encodeTokenOfOwnerByIndex,
} from "../../lib/ownership/abi.ts";
import { isAddress, shortenAddress } from "../../lib/ownership/address.ts";
import { parseCollectionConfig, readCollectionConfig } from "../../lib/ownership/config.ts";
import { fetchOwnedTokenIds, mapWithConcurrency } from "../../lib/ownership/lookup.ts";
import { loadOwnedTokenIds } from "../../lib/ownership/ownedRareWild.ts";
import { RpcError } from "../../lib/ownership/rpc.ts";
import { normalizeTokenIds, resolveOwnedSkins } from "../../lib/ownership/tokens.ts";
import { parseChainId } from "../../lib/ownership/wallet.ts";
import { decodeRareWildDataset } from "../../lib/rareWild/metadata.ts";
import { installRareWildSkins } from "../../lib/rareWild/registry.ts";
import { createMockContract } from "./mockContract.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
async function rejects(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error as Error;
  }
}

// Fixtures only. These are NOT a RAREWILD contract; they exist so the code paths can be exercised.
const CONTRACT = `0x${"c0".repeat(20)}`;
const ALICE = "0xabcdef0123456789abcdef0123456789abcdef01";
const BOB = "0x1111111111111111111111111111111111111111";
const walletProvider = { request: async () => { throw new Error("wallet provider must not be called in this test"); } };

async function main() {
  // --- config
  check("no env -> status missing (no contract is invented)", readCollectionConfig().status === "missing" || Boolean(process.env.NEXT_PUBLIC_RAREWILD_CONTRACT_ADDRESS));
  for (const blank of [undefined, "", "   "]) {
    check(`contract ${JSON.stringify(blank)} -> missing`, parseCollectionConfig({ contractAddress: blank }).status === "missing");
  }
  check("missing contract wins over other settings", parseCollectionConfig({ chainId: "1", rpcUrl: "https://rpc.example" }).status === "missing");
  for (const bad of ["0x123", "not-an-address", `0x${"g".repeat(40)}`, `0x${"0".repeat(40)}`, `0x${"a".repeat(41)}`]) {
    const c = parseCollectionConfig({ contractAddress: bad });
    check(`invalid contract ${bad.slice(0, 14)}… -> invalid`, c.status === "invalid" && c.problems.length > 0);
  }
  check("bad chain id -> invalid", parseCollectionConfig({ contractAddress: CONTRACT, chainId: "abc" }).status === "invalid");
  check("zero chain id -> invalid", parseCollectionConfig({ contractAddress: CONTRACT, chainId: "0" }).status === "invalid");
  check("non-http RPC URL -> invalid", parseCollectionConfig({ contractAddress: CONTRACT, rpcUrl: "ftp://x" }).status === "invalid");
  check("garbage RPC URL -> invalid", parseCollectionConfig({ contractAddress: CONTRACT, rpcUrl: "not a url" }).status === "invalid");
  const good = parseCollectionConfig({ contractAddress: ` ${CONTRACT.toUpperCase().replace("0X", "0x")} `, chainId: "137", rpcUrl: "https://rpc.example/v1" });
  check("valid config parses (address lowercased, chain + rpc kept)", good.status === "configured" && good.contractAddress === CONTRACT && good.chainId === 137 && good.rpcUrl === "https://rpc.example/v1");
  const minimal = parseCollectionConfig({ contractAddress: CONTRACT });
  check("address-only config is valid (chain + rpc optional)", minimal.status === "configured" && minimal.chainId === null && minimal.rpcUrl === null);

  // --- addresses / chain ids
  check("isAddress accepts 0x+40 hex, rejects the rest", isAddress(ALICE) && !isAddress("0x12") && !isAddress(123) && !isAddress(undefined));
  check("shortenAddress", shortenAddress(ALICE) === "0xabcd…ef01");
  check("parseChainId hex/number/garbage", parseChainId("0x89") === 137 && parseChainId(1) === 1 && parseChainId("0x") === null && parseChainId("x") === null && parseChainId(0) === null);

  // --- ABI (expected values produced independently with viem)
  check("balanceOf encoding", encodeBalanceOf(ALICE) === "0x70a08231000000000000000000000000abcdef0123456789abcdef0123456789abcdef01");
  check("tokenOfOwnerByIndex encoding", encodeTokenOfOwnerByIndex(ALICE, 7) === "0x2f745c59000000000000000000000000abcdef0123456789abcdef0123456789abcdef010000000000000000000000000000000000000000000000000000000000000007");
  check("ownerOf encoding", encodeOwnerOf(4444) === "0x6352211e000000000000000000000000000000000000000000000000000000000000115c");
  check("supportsInterface encoding", encodeSupportsInterface(ERC721_ENUMERABLE_INTERFACE_ID) === "0x01ffc9a7780e9d6300000000000000000000000000000000000000000000000000000000");
  check("encoders reject bad input", (() => { try { encodeBalanceOf("nope"); return false; } catch { return true; } })());
  check("decodeUint / decodeBool / decodeAddress", decodeUint(`0x${"0".repeat(63)}5`) === 5n && decodeBool(`0x${"0".repeat(63)}1`) && !decodeBool(`0x${"0".repeat(64)}`) && decodeAddress(`0x${"0".repeat(24)}${ALICE.slice(2)}`) === ALICE);
  for (const junk of ["0x", "", "0x12", "nonsense"]) {
    check(`decodeUint rejects ${JSON.stringify(junk)}`, (await rejects(async () => decodeUint(junk))) !== null);
  }

  // --- token normalization
  const normalized = normalizeTokenIds([2n, 1n, 4444n, 0n, 4445n, 2n, "7", " 8 ", "x", -1, 1.5, 3]);
  check("normalizeTokenIds keeps valid, sorted, unique ids", JSON.stringify(normalized.tokenIds) === "[1,2,3,7,8,4444]", JSON.stringify(normalized.tokenIds));
  check("normalizeTokenIds counts dropped values", normalized.ignored === 6, `ignored ${normalized.ignored}`);

  // --- concurrency helper
  const order = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { await new Promise((r) => setTimeout(r, (8 - n) * 2)); return n * 10; });
  check("mapWithConcurrency preserves input order", JSON.stringify(order) === "[10,20,30,40,50,60,70]");

  // --- lookup: enumerable and fallback paths
  const tokens = { 1: BOB, 2: ALICE, 4444: ALICE, 10: ALICE, 11: BOB };
  for (const enumerable of [true, false]) {
    const { transport, stats } = createMockContract({ tokens, enumerable });
    const ids = (await fetchOwnedTokenIds(transport, CONTRACT, ALICE, { maxTokenId: 4444 })).map(Number).sort((a, b) => a - b);
    check(`${enumerable ? "enumerable" : "ownerOf-scan fallback"}: finds Alice's tokens`, JSON.stringify(ids) === "[2,10,4444]", JSON.stringify(ids));
    check(`${enumerable ? "enumerable" : "fallback"}: uses ${enumerable ? "tokenOfOwnerByIndex" : "ownerOf"}`, stats.calls.includes(enumerable ? "0x2f745c59" : "0x6352211e") && !stats.calls.includes(enumerable ? "0x6352211e" : "0x2f745c59"));
  }
  const empty = createMockContract({ tokens, enumerable: true });
  check("wallet with no tokens -> empty list, no enumeration calls", (await fetchOwnedTokenIds(empty.transport, CONTRACT, `0x${"2".repeat(40)}`, { maxTokenId: 4444 })).length === 0 && !empty.stats.calls.includes("0x2f745c59"));
  const noContract = await rejects(() => fetchOwnedTokenIds(createMockContract({ tokens, enumerable: true, noContract: true }).transport, CONTRACT, ALICE, { maxTokenId: 4444 }));
  check("no contract at address -> readable error", noContract !== null && /No collection contract/.test(noContract.message), noContract?.message);
  const netDown = await rejects(() => fetchOwnedTokenIds(createMockContract({ tokens, enumerable: false, failWith: new RpcError("Could not reach the RPC endpoint.") }).transport, CONTRACT, ALICE, { maxTokenId: 4444 }));
  check("network failure surfaces (never looks like 'owns nothing')", netDown !== null);

  // --- full pipeline
  const configured = parseCollectionConfig({ contractAddress: CONTRACT, chainId: "137" });
  const mock = () => createMockContract({ tokens, enumerable: true, chainId: 137 });
  let r = await loadOwnedTokenIds({ config: { status: "missing" }, owner: ALICE, walletProvider, walletChainId: 1 });
  check("pipeline: contract not configured -> not-configured (no wallet/RPC calls made)", r.status === "not-configured");
  r = await loadOwnedTokenIds({ config: parseCollectionConfig({ contractAddress: "0xbad" }), owner: ALICE, walletProvider, walletChainId: 1 });
  check("pipeline: invalid contract address -> invalid-config", r.status === "invalid-config");
  r = await loadOwnedTokenIds({ config: configured, owner: ALICE, walletProvider, walletChainId: 1 });
  check("pipeline: wallet on the wrong chain -> wrong-network", r.status === "wrong-network" && r.expectedChainId === 137 && r.walletChainId === 1);
  r = await loadOwnedTokenIds({ config: configured, owner: ALICE, walletProvider, walletChainId: 137, transport: mock().transport });
  check("pipeline: configured + right chain -> ready with Alice's ids", r.status === "ready" && JSON.stringify(r.tokenIds) === "[2,10,4444]" && r.ignored === 0, JSON.stringify(r));
  r = await loadOwnedTokenIds({ config: configured, owner: `0x${"2".repeat(40)}`, walletProvider, walletChainId: 137, transport: mock().transport });
  check("pipeline: no NFTs -> ready with empty list", r.status === "ready" && r.tokenIds.length === 0);
  r = await loadOwnedTokenIds({ config: configured, owner: ALICE, walletProvider, walletChainId: 137, transport: createMockContract({ tokens, enumerable: true, failWith: new RpcError("429 Too Many Requests") }).transport });
  check("pipeline: RPC failure -> error with message", r.status === "error" && /429/.test(r.message), r.status === "error" ? r.message : "");
  r = await loadOwnedTokenIds({ config: configured, owner: ALICE, walletProvider, walletChainId: 137, transport: createMockContract({ tokens, enumerable: true, noContract: true }).transport });
  check("pipeline: wrong/nonexistent contract -> error", r.status === "error");
  const bigTokens = createMockContract({ tokens: { 5: ALICE, 99999: ALICE }, enumerable: true, chainId: 137 });
  r = await loadOwnedTokenIds({ config: configured, owner: ALICE, walletProvider, walletChainId: 137, transport: bigTokens.transport });
  check("pipeline: token ids outside 1..4444 are ignored, not shown", r.status === "ready" && JSON.stringify(r.tokenIds) === "[5]" && r.ignored === 1, JSON.stringify(r));
  const withRpc = parseCollectionConfig({ contractAddress: CONTRACT, chainId: "137", rpcUrl: "https://rpc.example" });
  r = await loadOwnedTokenIds({ config: withRpc, owner: ALICE, walletProvider, walletChainId: 1, transport: createMockContract({ tokens, enumerable: true, chainId: 1 }).transport });
  check("pipeline: RPC on a different chain than configured -> error", r.status === "error" && /chain 1/.test(r.message), r.status === "error" ? r.message : "");

  // --- token ids -> local metadata
  const dataset = JSON.parse(await readFile(join(import.meta.dirname, "../../public/data/rarewild-metadata.json"), "utf8"));
  installRareWildSkins(decodeRareWildDataset(dataset));
  const resolved = resolveOwnedSkins([2, 4444, 10]);
  check("owned ids map to local metadata records", resolved.skins.length === 3 && resolved.skins[0].name === "RAREWILD #2" && resolved.skins[1].fileName === "4444.png" && resolved.unmatched === 0);
  check("unknown ids are reported as unmatched", resolveOwnedSkins([2, 5000]).unmatched === 1);

  console.log(failures === 0 ? "\nAll ownership checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
