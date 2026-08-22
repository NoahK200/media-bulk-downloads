export interface CollectedItem {
  src: string;
  kind: 'image' | 'video' | 'audio';
  type?: string;
  ext?: string;
  thumbnailSrc?: string;
  poster?: string;
  width?: number;
  height?: number;
  sourcePage?: { url?: string; title?: string };
  hlsManifest?: string;
}

export interface StoredHistoryEntry {
  src: string;
  filename: string;
  kind: 'image' | 'video' | 'audio';
  type: string;
  thumbnailSrc?: string;
  sourcePageUrl: string;
  sourcePageTitle?: string;
  time: number;
  downloadId?: number;
  path?: string;
}

export interface FavouriteEntry {
  src: string;
  kind: 'image' | 'video' | 'audio';
  type: string;
  thumbnailSrc?: string;
  sourcePageUrl: string;
  sourcePageTitle?: string;
  time: number;
}

// The token is embedded only in the unguessable authenticated shell path.
const embedded = document.querySelector('meta[name="mbd-token"]')?.getAttribute('content') ?? '';
const token = embedded && embedded !== '__MBD_TOKEN__' ? embedded : '';
const h = { 'x-mbd-token': token, 'content-type': 'application/json' };

async function toJson(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (res.status === 204) return {};
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export const api = {
  get: (p: string) => fetch(p, { headers: h }).then(toJson),
  post: (p: string, b?: unknown) =>
    fetch(p, { method: 'POST', headers: h, body: JSON.stringify(b ?? {}) }).then(toJson),
  put: (p: string, b?: unknown) =>
    fetch(p, { method: 'PUT', headers: h, body: JSON.stringify(b ?? {}) }).then(toJson),
  del: (p: string) => fetch(p, { method: 'DELETE', headers: h }).then(toJson),
};

export function subscribe(handlers: Record<string, (data: unknown) => void>): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch('/events', { headers: h, signal: controller.signal });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const data = frame.match(/^data:\s*(.*)$/m)?.[1];
          if (!event || data === undefined || !handlers[event]) continue;
          try { handlers[event](JSON.parse(data)); } catch { /* malformed event */ }
        }
      }
    } catch {
      // Closing the dashboard aborts the stream; reconnect is handled by remount.
    }
  })();
  return () => controller.abort();
}
