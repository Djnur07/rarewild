/**
 * Decoding of the compact RAREWILD dataset (see RareWildDatasetFile in
 * types.ts) into full RareWildSkin records. Pure — no fetch, no fs — so the
 * browser loader and the Node validation script run the exact same code.
 */

import { skinImagePath } from "./assets.ts";
import { RAREWILD_SUPPLY, RAREWILD_TRAIT_TABLES } from "./traits.ts";
import type { RareWildTraitCategory } from "./traits.ts";
import type { RareWildDatasetFile, RareWildSkin } from "./types.ts";

const TRAIT_CATEGORIES = Object.keys(RAREWILD_TRAIT_TABLES) as RareWildTraitCategory[];
/** Record layout: [tokenId, rank, tier, accessory, background, bodyColor, expression]. */
const RECORD_LENGTH = 2 + TRAIT_CATEGORIES.length;

export function rareWildName(tokenId: number): string {
  return `RAREWILD #${tokenId}`;
}

export function rareWildFileName(tokenId: number): string {
  return `${tokenId}.png`;
}

export function isValidTokenId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= RAREWILD_SUPPLY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Decode and structurally validate a parsed dataset file. Throws a
 * descriptive Error on anything malformed; on success returns skins indexed
 * so that `skins[tokenId - 1]` is token `tokenId`.
 */
export function decodeRareWildDataset(raw: unknown): RareWildSkin[] {
  if (!isRecord(raw) || raw.version !== 1) {
    throw new Error("RAREWILD dataset: unsupported or missing version");
  }
  const { traits, records } = raw;
  if (!isRecord(traits) || !Array.isArray(records)) {
    throw new Error("RAREWILD dataset: missing traits table or records");
  }
  if (raw.supply !== RAREWILD_SUPPLY || records.length !== RAREWILD_SUPPLY) {
    throw new Error(
      `RAREWILD dataset: expected ${RAREWILD_SUPPLY} records, found ${records.length} (supply field: ${String(raw.supply)})`,
    );
  }

  // The file's trait tables must match the canonical vocabulary exactly, otherwise indexes would silently mean something else.
  for (const category of TRAIT_CATEGORIES) {
    const table = traits[category];
    const canonical = RAREWILD_TRAIT_TABLES[category] as readonly string[];
    if (
      !Array.isArray(table) ||
      table.length !== canonical.length ||
      table.some((value, index) => value !== canonical[index])
    ) {
      throw new Error(`RAREWILD dataset: trait table "${category}" does not match the canonical list`);
    }
  }

  const skins: RareWildSkin[] = new Array(RAREWILD_SUPPLY);
  for (let i = 0; i < records.length; i++) {
    const row: unknown = records[i];
    if (!Array.isArray(row) || row.length !== RECORD_LENGTH) {
      throw new Error(`RAREWILD dataset: record ${i} is malformed`);
    }
    const [tokenId, rank, ...indexes] = row as number[];
    if (tokenId !== i + 1) {
      throw new Error(`RAREWILD dataset: record ${i} has tokenId ${tokenId}, expected ${i + 1}`);
    }
    if (!Number.isInteger(rank) || rank < 1 || rank > RAREWILD_SUPPLY) {
      throw new Error(`RAREWILD dataset: token ${tokenId} has invalid rank ${rank}`);
    }
    const values = TRAIT_CATEGORIES.map((category, column) => {
      const value = (RAREWILD_TRAIT_TABLES[category] as readonly string[])[indexes[column]];
      if (value === undefined) {
        throw new Error(`RAREWILD dataset: token ${tokenId} has invalid ${category} index ${indexes[column]}`);
      }
      return value;
    });
    const fileName = rareWildFileName(tokenId);
    skins[i] = {
      tokenId,
      name: rareWildName(tokenId),
      fileName,
      imagePath: skinImagePath(fileName),
      rank,
      tier: values[0] as RareWildSkin["tier"],
      accessory: values[1] as RareWildSkin["accessory"],
      background: values[2] as RareWildSkin["background"],
      bodyColor: values[3] as RareWildSkin["bodyColor"],
      expression: values[4] as RareWildSkin["expression"],
      isDefault: false,
    };
  }
  return skins;
}

/** Inverse of decode, used by the build script: encode one row of the compact dataset. */
export function encodeRareWildRecord(
  tokenId: number,
  rank: number,
  traitValues: Record<RareWildTraitCategory, string>,
): number[] {
  return [
    tokenId,
    rank,
    ...TRAIT_CATEGORIES.map((category) => {
      const index = (RAREWILD_TRAIT_TABLES[category] as readonly string[]).indexOf(traitValues[category]);
      if (index < 0) throw new Error(`token ${tokenId}: invalid ${category} "${traitValues[category]}"`);
      return index;
    }),
  ];
}

export type { RareWildDatasetFile };
