/**
 * Browser-side dataset loader: one fetch of the compact JSON, decoded and
 * installed into the registry, then cached for the life of the page.
 */

import { getDatasetUrl } from "./assets.ts";
import { decodeRareWildDataset } from "./metadata.ts";
import { installRareWildSkins, isRareWildLoaded } from "./registry.ts";

let pending: Promise<void> | null = null;

/** Resolves once the dataset is installed. Safe to call repeatedly; a failed load can be retried. */
export function loadRareWildDataset(): Promise<void> {
  if (isRareWildLoaded()) return Promise.resolve();
  if (!pending) {
    pending = fetch(getDatasetUrl())
      .then((response) => {
        if (!response.ok) throw new Error(`RAREWILD dataset request failed: HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((raw) => installRareWildSkins(decodeRareWildDataset(raw)))
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
