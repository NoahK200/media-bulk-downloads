import { ingestSniffedIgMedia, __resetIgResolver } from '@mbd/core/resolvers/sites/instagram';
import { ingestSniffedFbMedia, __resetFbResolver } from '@mbd/core/resolvers/sites/facebook';
import { ingestSniffedPinterestMedia, __resetPinterestSniffed } from '@mbd/core/resolvers/sites/pinterest';
import { ingestSniffedMangadexMedia, __resetMangadexSniffed } from '@mbd/core/resolvers/sites/mangadex';
import { ingestSniffedHls, resetSniffedHls } from '@mbd/core/resolvers/sniffers/hls-sniff';
import { clearSnifferBufferValues, snifferSnapshot } from '@/extension/content/sniffer-buffer';

export function hydrateSnifferBuffers(): void {
  const buffered = snifferSnapshot();
  ingestSniffedIgMedia(buffered.ig);
  ingestSniffedFbMedia(buffered.fb);
  ingestSniffedPinterestMedia(buffered.pinterest);
  ingestSniffedMangadexMedia(buffered.mangadex);
  ingestSniffedHls(buffered.hls);
}

function ingestSnapshot(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const snapshot = value as Partial<Record<'ig' | 'fb' | 'pinterest' | 'mangadex' | 'hls', unknown>>;
  ingestSniffedIgMedia(snapshot.ig);
  ingestSniffedFbMedia(snapshot.fb);
  ingestSniffedPinterestMedia(snapshot.pinterest);
  ingestSniffedMangadexMedia(snapshot.mangadex);
  ingestSniffedHls(snapshot.hls);
}

export function syncSnifferBuffers(timeoutMs = 100): Promise<void> {
  hydrateSnifferBuffers();
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    let documentListener: (event: Event) => void;
    const snapshotResponseEvent = `${chrome.runtime.id}:mbd-sniffer-snapshot-response`;
    const finish = (snapshot?: unknown): void => {
      if (settled) return;
      settled = true;
      if (snapshot !== undefined) ingestSnapshot(snapshot);
      clearTimeout(timer);
      window.removeEventListener('message', listener);
      document.removeEventListener(snapshotResponseEvent, documentListener);
      resolve();
    };
    const listener = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { source?: unknown; snapshot?: unknown } | null;
      if (data?.source !== 'mbd-relay-snapshot') return;
      finish(data.snapshot);
    };
    const snapshotRequestEvent = `${chrome.runtime.id}:mbd-sniffer-snapshot-request`;
    documentListener = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      try { finish(JSON.parse(detail)); } catch { /* malformed page event */ }
    };
    timer = setTimeout(() => finish(), timeoutMs);
    window.addEventListener('message', listener);
    document.addEventListener(snapshotResponseEvent, documentListener);
    try {
      chrome.runtime.sendMessage({ type: 'GET_PASSIVE_SNIFFER_SNAPSHOT' }, (snapshot: unknown) => {
        const error = chrome.runtime.lastError;
        if (!error && snapshot !== undefined) finish(snapshot);
      });
    } catch { /* use the page-relay fallback */ }
    document.dispatchEvent(new CustomEvent(snapshotRequestEvent));
    window.postMessage({ source: 'mbd-collector-ready' }, location.origin);
  });
}

export function clearSnifferBuffers(): void {
  clearSnifferBufferValues();
  __resetIgResolver();
  __resetFbResolver();
  __resetPinterestSniffed();
  __resetMangadexSniffed();
  resetSniffedHls();
}
