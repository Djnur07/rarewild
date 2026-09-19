/**
 * Build the game's RAREWILD dataset from the collection CSV.
 *
 *   node scripts/rareWild/build-dataset.ts [--csv <path>] [--out <path>]
 *
 * Reads the CSV (never modifies it) and writes the compact JSON the browser
 * loads (public/data/rarewild-metadata.json). The game never parses the CSV
 * at runtime. Refuses to write anything if the CSV fails validation.
 *
 * CSV source, first that exists: --csv, $RAREWILD_CSV,
 * ~/Documents/metadata-RAREWILD.csv, ~/Downloads/metadata-RAREWILD.csv.
 * (macOS can block terminals from reading ~/Documents; copy the CSV to
 * ~/Downloads in that case.)
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  encodeRareWildRecord,
  rareWildFileName,
  rareWildName,
} from "../../lib/rareWild/metadata.ts";
import { RAREWILD_SUPPLY, RAREWILD_TRAIT_TABLES } from "../../lib/rareWild/traits.ts";
import type { RareWildTraitCategory } from "../../lib/rareWild/traits.ts";
import type { RareWildDatasetFile } from "../../lib/rareWild/types.ts";
import { parseCsv } from "./csv.ts";

const COLUMNS = {
  tokenId: "tokenID",
  name: "name",
  description: "description",
  fileName: "file_name",
  rank: "attributes[Rank]",
  tier: "attributes[Tier]",
  accessory: "attributes[Accessory]",
  background: "attributes[Background]",
  bodyColor: "attributes[Body Color]",
  expression: "attributes[Expression]",
} as const;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readCsvWithFallback(): Promise<{ path: string; text: string }> {
  const explicit = argValue("--csv") ?? process.env.RAREWILD_CSV;
  const candidates = [
    explicit,
    join(homedir(), "Documents", "metadata-RAREWILD.csv"),
    join(homedir(), "Downloads", "metadata-RAREWILD.csv"),
  ].filter((p): p is string => Boolean(p) && existsSync(p as string));
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return { path: resolve(candidate), text: await readFile(candidate, "utf8") };
    } catch (error) {
      // An explicitly requested file must not be silently replaced by another one.
      if (candidate === explicit) throw error;
      failures.push(`${candidate}: ${(error as Error).message}`);
    }
  }
  throw new Error(`Could not read a RAREWILD CSV.\n  ${failures.join("\n  ") || "no candidate file exists"}`);
}

async function main() {
  const { path: csvPath, text } = await readCsvWithFallback();
  const rows = parseCsv(text);
  const header = rows[0];
  const errors: string[] = [];

  const columnIndex = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, title] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const index = header.indexOf(title);
    if (index < 0) errors.push(`missing CSV column "${title}"`);
    columnIndex[key] = index;
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const data = rows.slice(1);
  if (data.length !== RAREWILD_SUPPLY) errors.push(`expected ${RAREWILD_SUPPLY} rows, found ${data.length}`);

  const seen = new Set<number>();
  const descriptions = new Set<string>();
  const records: number[][] = [];
  const traitCategories = Object.keys(RAREWILD_TRAIT_TABLES) as RareWildTraitCategory[];

  data.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== header.length) {
      errors.push(`line ${line}: ${cells.length} cells, expected ${header.length}`);
      return;
    }
    const get = (key: keyof typeof COLUMNS) => cells[columnIndex[key]].trim();
    const tokenId = Number(get("tokenId"));
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > RAREWILD_SUPPLY) {
      errors.push(`line ${line}: invalid tokenID "${get("tokenId")}"`);
      return;
    }
    if (seen.has(tokenId)) errors.push(`line ${line}: duplicate tokenID ${tokenId}`);
    seen.add(tokenId);
    if (get("name") !== rareWildName(tokenId)) errors.push(`token ${tokenId}: unexpected name "${get("name")}"`);
    if (get("fileName") !== rareWildFileName(tokenId)) {
      errors.push(`token ${tokenId}: file_name "${get("fileName")}" does not map to ${rareWildFileName(tokenId)}`);
    }
    descriptions.add(get("description"));
    const rank = Number(get("rank"));
    if (!Number.isInteger(rank) || rank < 1 || rank > RAREWILD_SUPPLY) {
      errors.push(`token ${tokenId}: invalid rank "${get("rank")}"`);
      return;
    }
    const traitValues = {} as Record<RareWildTraitCategory, string>;
    for (const category of traitCategories) {
      traitValues[category] = get(category);
      if (!(RAREWILD_TRAIT_TABLES[category] as readonly string[]).includes(traitValues[category])) {
        errors.push(`token ${tokenId}: invalid ${category} "${traitValues[category]}"`);
      }
    }
    if (errors.length === 0) records.push(encodeRareWildRecord(tokenId, rank, traitValues));
  });

  for (let id = 1; id <= RAREWILD_SUPPLY; id++) {
    if (!seen.has(id)) errors.push(`tokenID ${id} is missing`);
  }
  if (descriptions.size !== 1) errors.push(`expected one shared description, found ${descriptions.size}`);

  if (errors.length > 0) {
    console.error(`CSV validation FAILED (${errors.length} problems), nothing written:`);
    for (const message of errors.slice(0, 40)) console.error(`  - ${message}`);
    if (errors.length > 40) console.error(`  ... and ${errors.length - 40} more`);
    process.exit(1);
  }

  records.sort((a, b) => a[0] - b[0]);
  const dataset: RareWildDatasetFile = {
    version: 1,
    collection: "RAREWILD",
    supply: RAREWILD_SUPPLY,
    description: [...descriptions][0],
    traits: {
      tier: RAREWILD_TRAIT_TABLES.tier,
      accessory: RAREWILD_TRAIT_TABLES.accessory,
      background: RAREWILD_TRAIT_TABLES.background,
      bodyColor: RAREWILD_TRAIT_TABLES.bodyColor,
      expression: RAREWILD_TRAIT_TABLES.expression,
    },
    records,
  };

  const outPath = resolve(argValue("--out") ?? join(import.meta.dirname, "../../public/data/rarewild-metadata.json"));
  // One record per line: compact, but diffs stay readable.
  const body = records.map((r) => `    [${r.join(",")}]`).join(",\n");
  const head = { ...dataset, records: undefined };
  const json = `${JSON.stringify(head, null, 2).replace(/\n}$/, "")},\n  "records": [\n${body}\n  ]\n}\n`;
  await writeFile(outPath, json);
  console.log(`Read ${records.length} records from ${csvPath}`);
  console.log(`Wrote ${outPath} (${json.length} bytes)`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
