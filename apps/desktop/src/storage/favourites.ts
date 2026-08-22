// Value-import from the pre-bundled ESM (deno desktop can't resolve bare
// @mbd/core source imports — see docs/runtime-recipe.md). Type-only imports stay
// on @mbd/core/types (erased at runtime, no resolution needed).
import { mergeFavourites, canonicalSrcKey, SrcKeySet } from '../core-bundle/download-name.gen.js';
import type { FavouriteEntry } from '@mbd/core/types';
import type { Store } from './kv.ts';

const KEY = 'favourites';
const MAX_FAVOURITES = 10_000;

function validWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function validFavourite(value: unknown): value is FavouriteEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return validWebUrl(entry.src)
    && ['image', 'video', 'audio'].includes(entry.kind as string)
    && typeof entry.type === 'string' && entry.type.length <= 256
    && (entry.sourcePageUrl === '' || validWebUrl(entry.sourcePageUrl))
    && typeof entry.time === 'number' && Number.isFinite(entry.time)
    && (entry.thumbnailSrc === undefined || validWebUrl(entry.thumbnailSrc))
    && (entry.sourcePageTitle === undefined || (typeof entry.sourcePageTitle === 'string' && entry.sourcePageTitle.length <= 1_024));
}

function sanitizeFavourites(value: unknown): FavouriteEntry[] {
  return Array.isArray(value) ? value.filter(validFavourite).slice(0, MAX_FAVOURITES) : [];
}

export async function loadFavourites(store: Store): Promise<FavouriteEntry[]> {
  return sanitizeFavourites(await store.durableGet<unknown>(KEY));
}

export async function addFavourite(store: Store, entry: FavouriteEntry): Promise<void> {
  if (!validFavourite(entry)) throw new Error('Invalid favourite entry.');
  await store.durableUpdate<FavouriteEntry[]>(KEY, (current) =>
    mergeFavourites(sanitizeFavourites(current), [entry]).slice(0, MAX_FAVOURITES));
}

export async function removeFavourite(store: Store, src: string): Promise<void> {
  const k = canonicalSrcKey(src);
  await store.durableUpdate<FavouriteEntry[]>(KEY, (current) =>
    sanitizeFavourites(current).filter((e) => canonicalSrcKey(e.src) !== k));
}

export async function clearFavourites(store: Store): Promise<void> {
  await store.durableUpdate<FavouriteEntry[]>(KEY, () => []);
}

/** SrcKeySet over current favourites, so callers can test `.has(item.src)`
 *  across CDN variants without touching canonicalSrcKey themselves. */
export async function favouriteKeys(store: Store): Promise<SrcKeySet> {
  return SrcKeySet.from((await loadFavourites(store)).map((e) => e.src));
}
