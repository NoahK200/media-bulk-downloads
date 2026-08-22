import { basename } from 'jsr:@std/path';
import type { Store } from '../storage/kv.ts';
import { recordDownloads } from '../storage/history.ts';
import { downloadOne } from './downloader.ts';

interface QueueItem {
  src: string;
  ext?: string;
  type?: string;
  kind?: 'image' | 'video' | 'audio';
  sourcePage?: { url?: string };
}

interface Deps {
  store: Store;
  root: string;
  settings: () => {
    downloadPath: string;
    namingMode: 'original' | 'prefixed';
    fileNamePrefix: string;
    downloadConcurrency: number;
  };
  sourcePageUrl?: string;
  downloadImpl?: typeof downloadOne;
  backoffMs?: (attempt: number) => number;
}

export interface Queue {
  enqueue(items: QueueItem[]): Promise<void>;
  status(): { pending: number; active: number; done: number; failed: number };
  drain(): Promise<void>;
  resume(): Promise<void>;
}

const KEY = 'downloadQueue';
const MAX_QUEUE_ITEMS = 5_000;

interface StoredQueueState {
  version: 2;
  pending: QueueItem[];
  active: QueueItem[];
}

function validQueueItem(value: unknown): value is QueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.src !== 'string' || item.src.length > 8_192) return false;
  try {
    const url = new URL(item.src);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  } catch { return false; }
  if (item.ext !== undefined && (typeof item.ext !== 'string' || item.ext.length > 32)) return false;
  if (item.type !== undefined && (typeof item.type !== 'string' || item.type.length > 256)) return false;
  if (item.kind !== undefined && !['image', 'video', 'audio'].includes(item.kind as string)) return false;
  if (item.sourcePage !== undefined) {
    if (!item.sourcePage || typeof item.sourcePage !== 'object' || Array.isArray(item.sourcePage)) return false;
    const source = item.sourcePage as Record<string, unknown>;
    if (source.url !== undefined && (typeof source.url !== 'string' || source.url.length > 8_192)) return false;
  }
  return true;
}

function readStoredQueue(value: unknown): QueueItem[] {
  if (Array.isArray(value)) return value.filter(validQueueItem).slice(0, MAX_QUEUE_ITEMS);
  if (!value || typeof value !== 'object') return [];
  const state = value as Partial<StoredQueueState>;
  const interrupted = Array.isArray(state.active) ? state.active.filter(validQueueItem) : [];
  const pending = Array.isArray(state.pending) ? state.pending.filter(validQueueItem) : [];
  return [...interrupted, ...pending].slice(0, MAX_QUEUE_ITEMS);
}

export function createQueue(deps: Deps): Queue {
  const dl = deps.downloadImpl ?? downloadOne;
  const backoff = deps.backoffMs ?? ((a: number) => Math.min(1000 * 2 ** a, 15000));
  let pending: QueueItem[] = [];
  const activeItems = new Map<number, QueueItem>();
  let activeSequence = 0, done = 0, failed = 0;
  let idleResolvers: Array<() => void> = [];
  let persistChain: Promise<void> = Promise.resolve();
  let pumping = false;

  const persist = (): Promise<void> => {
    const snapshot: StoredQueueState = {
      version: 2,
      pending: pending.slice(),
      active: [...activeItems.values()],
    };
    const run = persistChain.then(() => deps.store.durableUpdate<StoredQueueState>(KEY, () => snapshot).then(() => undefined));
    persistChain = run.catch(() => undefined);
    return run;
  };
  const settleIdle = () => {
    if (activeItems.size === 0 && pending.length === 0) {
      const ready = idleResolvers;
      idleResolvers = [];
      void persistChain.finally(() => ready.forEach((resolve) => resolve()));
    }
  };

  async function runOne(item: QueueItem): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const s = deps.settings();
        const { path } = await dl(item, {
          root: deps.root,
          template: s.downloadPath,
          index: 0,
          namingMode: s.namingMode,
          fileNamePrefix: s.fileNamePrefix,
          sourcePageUrl: item.sourcePage?.url ?? deps.sourcePageUrl,
        });
        await recordDownloads(deps.store, [{
          src: item.src,
          filename: basename(path) || item.src,
          kind: item.kind ?? 'image',
          type: item.type ?? '',
          sourcePageUrl: item.sourcePage?.url ?? deps.sourcePageUrl ?? '',
          time: Date.now(),
          path,
        }]);
        done++;
        return;
      } catch {
        if (attempt === 2) {
          failed++;
          return;
        }
        await new Promise((r) => setTimeout(r, backoff(attempt)));
      }
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (activeItems.size < deps.settings().downloadConcurrency && pending.length) {
        const item = pending.shift()!;
        const activeId = ++activeSequence;
        activeItems.set(activeId, item);
        try {
          // Persist the pending→active transition before dispatch. A restart
          // requeues stored active entries, so no accepted item is lost.
          await persist();
        } catch (error) {
          activeItems.delete(activeId);
          pending.unshift(item);
          console.warn('[mbd] queue persist failed:', (error as Error).message);
          break;
        }
        void runOne(item).finally(async () => {
          activeItems.delete(activeId);
          try { await persist(); }
          catch (error) { console.warn('[mbd] queue persist failed:', (error as Error).message); }
          await pump();
          settleIdle();
        });
      }
    } finally {
      pumping = false;
      settleIdle();
    }
  }

  return {
    async enqueue(items: QueueItem[]) {
      const accepted = items.filter(validQueueItem);
      if (accepted.length !== items.length) throw new Error('Invalid queue item.');
      if (pending.length + activeItems.size + accepted.length > MAX_QUEUE_ITEMS) throw new Error('Queue limit exceeded.');
      pending.push(...accepted);
      await persist();
      void pump();
    },
    status() {
      return { pending: pending.length, active: activeItems.size, done, failed };
    },
    drain() {
      return activeItems.size === 0 && pending.length === 0
        ? persistChain
        : new Promise<void>((res) => idleResolvers.push(res));
    },
    async resume() {
      pending = readStoredQueue(await deps.store.durableGet<unknown>(KEY));
      activeItems.clear();
      await persist();
      void pump();
    },
  };
}
