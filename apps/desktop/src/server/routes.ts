import type { ApiHandler } from './types.ts';
import type { MediaStore } from './media-store.ts';
import type { SseHub } from './sse.ts';
import type { Store } from '../storage/kv.ts';
import type { DesktopSettings } from '../storage/settings.ts';
import { loadHistory, removeHistoryEntry, clearHistory } from '../storage/history.ts';
import { loadFavourites, addFavourite, removeFavourite } from '../storage/favourites.ts';
import { downloadedKeysOnDisk, splitByDownloaded } from '../platform/dedup.ts';
import type { Queue } from '../platform/queue.ts';
import type { FavouriteEntry } from '@mbd/core/types';
import { pickKnownSettings } from '../storage/settings.ts';

export interface Backup {
  version: number;
  settings: DesktopSettings;
  history: unknown[];
  favourites: unknown[];
}

export interface ImportPayload {
  settings?: Partial<DesktopSettings>;
  history?: unknown[];
  favourites?: unknown[];
}

export interface RouteDeps {
  store: Store;
  queue: Queue;
  media: MediaStore;
  sse: SseHub;
  settings: () => DesktopSettings;
  setSettings: (s: DesktopSettings) => Promise<void>;
  navigate: (url: string) => void;
  showBrowser?: () => void;
  deepScan?: () => void;
  capture?: (src: string) => void;
  exportData: () => Promise<Backup>;
  importData: (backup: ImportPayload) => Promise<{ history: number; favourites: number }>;
}

const MAX_JSON_BYTES = 1024 * 1024;
class RequestError extends Error {
  constructor(readonly status: number) { super(`request failed (${status})`); }
}

async function readJsonLimited(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new RequestError(413);
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) { await reader.cancel(); throw new RequestError(413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError(400); }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function lastSegment(url: URL): string {
  const segs = url.pathname.split('/');
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export function buildRoutes(deps: RouteDeps): Record<string, ApiHandler> {
  return {
    'GET /api/media': () => Response.json({ items: deps.media.list() }),

    'POST /api/download': async (req) => {
      const body = await readJsonLimited(req);
      if (!object(body) || !Array.isArray(body.srcs) || body.srcs.length > 5_000 || !body.srcs.every((src) => typeof src === 'string')) throw new RequestError(400);
      const srcs = body.srcs as string[];
      const items = srcs
        .map((src) => deps.media.get(src))
        .filter((it): it is NonNullable<typeof it> => it != null && !it.hlsManifest);
      let keep = items;
      let skipped: typeof items = [];
      if (deps.settings().skipDuplicateDownloads) {
        const keys = await downloadedKeysOnDisk(deps.store);
        ({ keep, skipped } = splitByDownloaded(items, keys));
      }
      await deps.queue.enqueue(keep);
      deps.sse.broadcast('queue', deps.queue.status());
      return Response.json({ queued: keep.length, skipped: skipped.length });
    },

    'GET /api/queue': () => Response.json(deps.queue.status()),

    'GET /api/settings': () => Response.json(deps.settings()),

    'PUT /api/settings': async (req) => {
      const body = await readJsonLimited(req);
      if (!object(body)) throw new RequestError(400);
      const merged = pickKnownSettings(deps.settings(), body as Partial<DesktopSettings>);
      await deps.setSettings(merged);
      return Response.json(deps.settings());
    },

    'GET /api/history': async () => Response.json({ items: await loadHistory(deps.store) }),

    'DELETE /api/history': async () => {
      await clearHistory(deps.store);
      return Response.json({ ok: true });
    },

    'DELETE /api/history/:key': async (_req, url) => {
      await removeHistoryEntry(deps.store, lastSegment(url));
      return Response.json({ ok: true });
    },

    'GET /api/favourites': async () => Response.json({ items: await loadFavourites(deps.store) }),

    'POST /api/favourites': async (req) => {
      const body = await readJsonLimited(req);
      if (!object(body) || !object(body.item) || typeof body.item.src !== 'string') throw new RequestError(400);
      const item = body.item as unknown as FavouriteEntry;
      await addFavourite(deps.store, item);
      return Response.json({ ok: true });
    },

    'DELETE /api/favourites/:key': async (_req, url) => {
      await removeFavourite(deps.store, lastSegment(url));
      return Response.json({ ok: true });
    },

    'GET /api/export': async () => Response.json(await deps.exportData()),

    'POST /api/import': async (req) => {
      const body = await readJsonLimited(req);
      if (!object(body)
        || (body.settings !== undefined && !object(body.settings))
        || (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 10_000))
        || (body.favourites !== undefined && (!Array.isArray(body.favourites) || body.favourites.length > 10_000))) {
        throw new RequestError(400);
      }
      const { history, favourites } = await deps.importData(body);
      return Response.json({ ok: true, history, favourites });
    },

    'POST /api/navigate': async (req) => {
      const body = await readJsonLimited(req);
      const target = object(body) && typeof body.url === 'string' ? body.url : '';
      let parsed: URL;
      try { parsed = new URL(target); } catch { throw new RequestError(400); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new RequestError(400);
      deps.navigate(target);
      return Response.json({ ok: true });
    },

    'POST /api/show-browser': () => {
      deps.showBrowser?.();
      return Response.json({ ok: true });
    },

    'POST /api/deep-scan': () => {
      deps.deepScan?.();
      return Response.json({ ok: true });
    },

    'POST /api/capture': async (req) => {
      const body = await readJsonLimited(req);
      const src = object(body) && typeof body.src === 'string' ? body.src : '';
      const item = src ? deps.media.get(src) : undefined;
      if (!item?.hlsManifest) throw new RequestError(404);
      deps.capture?.(src);
      return Response.json({ ok: true });
    },
  };
}
