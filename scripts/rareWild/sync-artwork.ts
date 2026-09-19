/**
 * Copy the RAREWILD artwork into public/assets/rareWild/skins/ for local
 * development (that folder is git-ignored — 157 MB of PNGs doesn't belong in
 * the repository).
 *
 *   node scripts/rareWild/sync-artwork.ts [--src <dir>] [--dest <dir>]
 *
 * Copies only (the source directory is never modified) and skips files that
 * already exist with the same size, so it's cheap to re-run. For production,
 * upload the same folder to a CDN and set NEXT_PUBLIC_RAREWILD_ASSET_BASE
 * (see lib/rareWild/assets.ts) instead of shipping it with the app.
 */

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { RAREWILD_SUPPLY } from "../../lib/rareWild/traits.ts";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const src = resolve(argValue("--src") ?? process.env.RAREWILD_ART_DIR ?? join(homedir(), "Downloads", "beast NFT"));
  const dest = resolve(argValue("--dest") ?? join(import.meta.dirname, "../../public/assets/rareWild/skins"));

  const available = new Set(await readdir(src));
  const missing: string[] = [];
  for (let id = 1; id <= RAREWILD_SUPPLY; id++) {
    if (!available.has(`${id}.png`)) missing.push(`${id}.png`);
  }
  if (missing.length > 0) {
    console.error(`Source is missing ${missing.length} artwork files (first: ${missing.slice(0, 5).join(", ")}). Nothing copied.`);
    process.exit(1);
  }

  await mkdir(dest, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (let id = 1; id <= RAREWILD_SUPPLY; id++) {
    const from = join(src, `${id}.png`);
    const to = join(dest, `${id}.png`);
    const [fromStat, toStat] = await Promise.all([stat(from), stat(to).catch(() => null)]);
    if (toStat && toStat.size === fromStat.size) {
      skipped++;
      continue;
    }
    await copyFile(from, to);
    copied++;
  }
  console.log(`Artwork ${src} -> ${dest}: ${copied} copied, ${skipped} already up to date.`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
