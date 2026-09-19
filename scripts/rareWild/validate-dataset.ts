/**
 * Validation for the RAREWILD skin data system.
 *
 *   node scripts/rareWild/validate-dataset.ts [--art-dir <dir>] [--csv <path>]
 *
 * Checks the generated dataset (public/data/rarewild-metadata.json) through
 * the same decoder/registry the game uses:
 *   1. exactly 4,444 records, token IDs 1..4444, all unique
 *   2. file names map to token IDs (<id>.png) and names are "RAREWILD #<id>"
 *   3. every trait value is in the canonical vocabulary; no missing fields
 *   4. malformed datasets are rejected (not silently accepted)
 *   5. getRareWildSkin: #1, #2, #4444, invalid IDs, and the default skin
 *   6. the skin API never leaks gameplay-affecting fields
 *   7. artwork: every <id>.png exists in the artwork folders that are present
 *      (source folder and public/assets/rareWild/skins), is an 800x800 PNG
 *   8. (optional, with --csv or when a CSV is found) the JSON matches the CSV row by row
 *
 * Exits non-zero if anything fails.
 */

import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { decodeRareWildDataset } from "../../lib/rareWild/metadata.ts";
import {
  findRareWildSkin,
  getDefaultSkin,
  getRareWildSkin,
  getRareWildSkins,
  installRareWildSkins,
} from "../../lib/rareWild/registry.ts";
import { RAREWILD_SUPPLY, RAREWILD_TRAIT_TABLES } from "../../lib/rareWild/traits.ts";
import type { RareWildTraitCategory } from "../../lib/rareWild/traits.ts";
import { parseCsv } from "./csv.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function pngSize(path: string): Promise<{ width: number; height: number } | null> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    if (header.toString("latin1", 1, 4) !== "PNG") return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

async function checkArtworkDir(label: string, dir: string) {
  const missing: number[] = [];
  const wrongSize: number[] = [];
  for (let id = 1; id <= RAREWILD_SUPPLY; id++) {
    const file = join(dir, `${id}.png`);
    if (!existsSync(file)) {
      missing.push(id);
      continue;
    }
    const size = await pngSize(file);
    if (!size || size.width !== 800 || size.height !== 800) wrongSize.push(id);
  }
  check(`${label}: all ${RAREWILD_SUPPLY} files 1.png..${RAREWILD_SUPPLY}.png exist`, missing.length === 0, missing.length ? `missing ${missing.length}, first ${missing.slice(0, 5)}` : "");
  check(`${label}: every file is an 800x800 PNG`, wrongSize.length === 0, wrongSize.length ? `bad ${wrongSize.length}, first ${wrongSize.slice(0, 5)}` : "");
}

async function main() {
  const datasetPath = resolve(join(import.meta.dirname, "../../public/data/rarewild-metadata.json"));
  const raw: unknown = JSON.parse(await readFile(datasetPath, "utf8"));

  // 1-3. Decode through the game's own decoder (throws on any structural problem).
  let skins: ReturnType<typeof decodeRareWildDataset> = [];
  try {
    skins = decodeRareWildDataset(raw);
    check("dataset decodes without errors", true);
  } catch (error) {
    check("dataset decodes without errors", false, (error as Error).message);
  }
  installRareWildSkins(skins);

  const all = getRareWildSkins();
  check(`exactly ${RAREWILD_SUPPLY} records`, all.length === RAREWILD_SUPPLY, `found ${all.length}`);
  const ids = new Set(all.map((skin) => skin.tokenId));
  check("token IDs are unique", ids.size === all.length);
  check(
    `token IDs cover 1..${RAREWILD_SUPPLY}`,
    all.every((skin, index) => skin.tokenId === index + 1),
  );
  check(
    "file names map to token IDs (<id>.png)",
    all.every((skin) => skin.fileName === `${skin.tokenId}.png`),
  );
  check(
    "names are RAREWILD #<id>",
    all.every((skin) => skin.name === `RAREWILD #${skin.tokenId}`),
  );
  check(
    "image paths end with the file name",
    all.every((skin) => skin.imagePath.endsWith(`/${skin.fileName}`)),
  );
  check(
    "no required field is missing/empty",
    all.every(
      (skin) =>
        skin.name && skin.fileName && skin.imagePath && skin.tier && skin.accessory && skin.background && skin.bodyColor && skin.expression && Number.isInteger(skin.rank),
    ),
  );
  check(
    "ranks are integers within 1..4444",
    all.every((skin) => skin.rank >= 1 && skin.rank <= RAREWILD_SUPPLY),
  );
  for (const category of Object.keys(RAREWILD_TRAIT_TABLES) as RareWildTraitCategory[]) {
    const valid = RAREWILD_TRAIT_TABLES[category] as readonly string[];
    const used = new Set(all.map((skin) => skin[category] as string));
    check(
      `${category}: only valid values (${used.size}/${valid.length} used)`,
      [...used].every((value) => valid.includes(value)),
    );
  }

  // 4. Malformed input must be rejected.
  const malformed: [string, unknown][] = [
    ["null", null],
    ["wrong version", { ...(raw as object), version: 2 }],
    ["truncated records", { ...(raw as { records: number[][] }), records: (raw as { records: number[][] }).records.slice(1) }],
    [
      "bad trait index",
      {
        ...(raw as { records: number[][] }),
        records: (raw as { records: number[][] }).records.map((r, i) => (i === 0 ? [r[0], r[1], 99, ...r.slice(3)] : r)),
      },
    ],
    [
      "token id out of order",
      {
        ...(raw as { records: number[][] }),
        records: (raw as { records: number[][] }).records.map((r, i) => (i === 5 ? [7, ...r.slice(1)] : r)),
      },
    ],
  ];
  for (const [label, value] of malformed) {
    let rejected = false;
    try {
      decodeRareWildDataset(value);
    } catch {
      rejected = true;
    }
    check(`malformed dataset rejected: ${label}`, rejected);
  }

  // 5. Skin API behavior.
  const s1 = getRareWildSkin(1);
  const s2 = getRareWildSkin(2);
  const s4444 = getRareWildSkin(4444);
  check("token #1 resolves", s1.tokenId === 1 && s1.name === "RAREWILD #1" && s1.fileName === "1.png" && !s1.isDefault, `${s1.tier}/${s1.accessory}/${s1.background}/${s1.bodyColor}/${s1.expression} rank ${s1.rank}`);
  check(
    "token #2 = Rare / Monocle / Forest Night / Mossy Green / Sleepy / rank 1501",
    s2.tokenId === 2 && s2.tier === "Rare" && s2.accessory === "Monocle" && s2.background === "Forest Night" && s2.bodyColor === "Mossy Green" && s2.expression === "Sleepy" && s2.rank === 1501,
  );
  check("token #4444 resolves", s4444.tokenId === 4444 && s4444.fileName === "4444.png" && !s4444.isDefault, `${s4444.tier}/${s4444.accessory}/${s4444.background}/${s4444.bodyColor}/${s4444.expression} rank ${s4444.rank}`);
  check("numeric-string token id resolves ('2')", getRareWildSkin("2").tokenId === 2);
  for (const bad of [0, -1, 4445, 1.5, NaN, Infinity, "abc", "", "2x", null, undefined, {}, [], "0"]) {
    const skin = getRareWildSkin(bad);
    check(`invalid token id ${JSON.stringify(bad) ?? String(bad)} -> default skin`, skin.isDefault && skin === getDefaultSkin() && findRareWildSkin(bad) === null);
  }
  const def = getDefaultSkin();
  check("default skin needs no NFT data", def.isDefault && def.tokenId === 0 && def.imagePath === "" && def.bodyColor === "Original Brown");
  check(
    "skin fields are identity-only (no gameplay stats)",
    Object.keys(s1).sort().join(",") === ["accessory", "background", "bodyColor", "expression", "fileName", "imagePath", "isDefault", "name", "rank", "tier", "tokenId"].join(","),
  );

  // 7. Artwork on disk.
  const publicArt = resolve(join(import.meta.dirname, "../../public/assets/rareWild/skins"));
  const sourceArt = resolve(argValue("--art-dir") ?? join(homedir(), "Downloads", "beast NFT"));
  if (existsSync(sourceArt)) await checkArtworkDir("source artwork", sourceArt);
  else console.log(`SKIP  source artwork folder not found: ${sourceArt}`);
  if (existsSync(publicArt)) await checkArtworkDir("public artwork", publicArt);
  else console.log(`SKIP  public artwork not synced yet (npm run rarewild:sync-art): ${publicArt}`);

  // 8. Cross-check against the CSV, when one can be read.
  const csvCandidates = [argValue("--csv"), join(homedir(), "Documents", "metadata-RAREWILD.csv"), join(homedir(), "Downloads", "metadata-RAREWILD.csv")].filter((p): p is string => Boolean(p));
  let csvText: string | null = null;
  let csvPath = "";
  for (const candidate of csvCandidates) {
    try {
      csvText = await readFile(candidate, "utf8");
      csvPath = candidate;
      break;
    } catch {
      // try the next candidate
    }
  }
  if (csvText) {
    const [header, ...rows] = parseCsv(csvText);
    const col = (title: string) => header.indexOf(title);
    const mismatches = rows.filter((cells) => {
      const skin = getRareWildSkin(Number(cells[col("tokenID")]));
      return (
        skin.isDefault ||
        String(skin.rank) !== cells[col("attributes[Rank]")] ||
        skin.tier !== cells[col("attributes[Tier]")] ||
        skin.accessory !== cells[col("attributes[Accessory]")] ||
        skin.background !== cells[col("attributes[Background]")] ||
        skin.bodyColor !== cells[col("attributes[Body Color]")] ||
        skin.expression !== cells[col("attributes[Expression]")] ||
        skin.fileName !== cells[col("file_name")]
      );
    });
    check(`dataset matches the CSV row by row (${csvPath})`, rows.length === RAREWILD_SUPPLY && mismatches.length === 0, `${mismatches.length} mismatches`);
  } else {
    console.log("SKIP  no readable CSV found for the row-by-row cross-check");
  }

  console.log(failures === 0 ? "\nAll RAREWILD validation checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
