// Value-import from the pre-bundled ESM (deno desktop can't resolve bare
// @mbd/core source imports — see docs/runtime-recipe.md). Type-only imports stay
// on @mbd/core/types (erased at runtime, no resolution needed).
import { mergeHistory, canonicalSrcKey } from '../core-bundle/download-name.gen.js';
import type { HistoryEntry } from '@mbd/core/types';
import type { Store } from './kv.ts';

/** HistoryEntry plus the on-disk download path (desktop-only; used for
 *  duplicate-file detection). mergeHistory is typed HistoryEntry[]→HistoryEntry[]
 *  but preserves the actual objects, so `path` survives the round-trip. */
export type StoredHistoryEntry = HistoryEntry & { path?: string };

const KEY = 'downloadHistory';
const MAX_HISTORY = 10_000;

function validWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function validHistoryEntry(value: unknown): value is StoredHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return validWebUrl(entry.src)
    && typeof entry.filename === 'string' && entry.filename.length <= 1_024
    && ['image', 'video', 'audio'].includes(entry.kind as string)
    && typeof entry.type === 'string' && entry.type.length <= 256
    && (entry.sourcePageUrl === '' || validWebUrl(entry.sourcePageUrl))
    && typeof entry.time === 'number' && Number.isFinite(entry.time)
    && (entry.thumbnailSrc === undefined || validWebUrl(entry.thumbnailSrc))
    && (entry.sourcePageTitle === undefined || (typeof entry.sourcePageTitle === 'string' && entry.sourcePageTitle.length <= 1_024))
    && (entry.path === undefined || (typeof entry.path === 'string' && entry.path.length <= 32_768));
}

function sanitizeHistory(value: unknown): StoredHistoryEntry[] {
  return Array.isArray(value) ? value.filter(validHistoryEntry).slice(0, MAX_HISTORY) : [];
}

export async function loadHistory(store: Store): Promise<StoredHistoryEntry[]> {
  return sanitizeHistory(await store.durableGet<unknown>(KEY));
}

export async function recordDownloads(store: Store, added: StoredHistoryEntry[]): Promise<void> {
  const safeAdded = sanitizeHistory(added);
  if (!safeAdded.length) return;
  await store.durableUpdate<StoredHistoryEntry[]>(KEY, (current) =>
    (mergeHistory(sanitizeHistory(current), safeAdded) as StoredHistoryEntry[]).slice(0, MAX_HISTORY));
}

export async function removeHistoryEntry(store: Store, src: string): Promise<void> {
  const k = canonicalSrcKey(src);
  await store.durableUpdate<StoredHistoryEntry[]>(KEY, (current) =>
    sanitizeHistory(current).filter((e) => canonicalSrcKey(e.src) !== k));
}

export async function clearHistory(store: Store): Promise<void> {
  await store.durableUpdate<StoredHistoryEntry[]>(KEY, () => []);
}
