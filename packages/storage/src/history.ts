import { HistoryEntry, PersistenceResult } from '@mbd/core/types';
import { canonicalSrcKey } from '@mbd/core/collection/canonical';
import { durableSet } from '@mbd/storage/idb';
import { mergeHistory, HISTORY_CAP, HISTORY_MAX_BYTES } from '@mbd/core/collection/entry-merge';

export const HISTORY_KEY = 'downloadHistory';
export { mergeHistory, HISTORY_CAP, HISTORY_MAX_BYTES };
const safeStoredSrc = (value: unknown): value is string => typeof value === 'string' && value.length <= 16_384
  && (/^https?:\/\//i.test(value) || /^data:image\//i.test(value) || (!value.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(value)));

export async function loadHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const raw = (result as Record<string, unknown>)[HISTORY_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is HistoryEntry => !!e && typeof e === 'object' && safeStoredSrc((e as HistoryEntry).src))
    .map((e) => ({ ...e, time: Number((e as HistoryEntry).time) || 0 }));
}

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

/** Resolves to whether the write persisted (see durableSet); `true` on an empty no-op. */
export async function recordDownloads(added: HistoryEntry[]): Promise<PersistenceResult> {
  if (!added.length) return { ok: true };
  return serialize(async () => {
    const merged = mergeHistory(await loadHistory(), added);
    return durableSet(HISTORY_KEY, merged);
  });
}

export async function removeEntry(src: string): Promise<PersistenceResult> {
  return serialize(async () => {
    const next = (await loadHistory()).filter((e) => canonicalSrcKey(e.src) !== canonicalSrcKey(src));
    return durableSet(HISTORY_KEY, next);
  });
}

export async function clearHistory(): Promise<PersistenceResult> {
  return serialize(async () => {
    return durableSet(HISTORY_KEY, []);
  });
}

/** Replace history with an imported list, normalized (dedup/sort/cap/byte-budget). */
export async function restoreHistory(entries: HistoryEntry[]): Promise<PersistenceResult> {
  return serialize(async () => {
    return durableSet(HISTORY_KEY, mergeHistory([], entries));
  });
}

export type DiskState = 'exists' | 'deleted' | 'unknown';

/**
 * The srcs from history whose downloaded file has NOT been positively reported gone.
 * `stateById(id)` returns 'exists' (browser knows it, file present), 'deleted' (browser
 * knows it, file removed), or 'unknown' (browser no longer has the record — e.g. the user
 * cleared Chrome's download history). Only 'deleted' drops an entry; 'unknown' keeps it
 * (trust our own record), so a still-on-disk file isn't wrongly re-offered. Legacy entries
 * with no downloadId are always kept.
 */
export function srcsStillOnDisk(
  history: HistoryEntry[],
  stateById: (id: number) => DiskState,
): string[] {
  return history
    .filter((e) => e.downloadId === undefined || stateById(e.downloadId) !== 'deleted')
    .map((e) => e.src);
}
