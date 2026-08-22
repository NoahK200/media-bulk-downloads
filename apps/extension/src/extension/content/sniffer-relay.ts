import { isPinterestHost } from '@mbd/core/resolvers/sniffers/pinterest-hosts';
import { isMangadexHost } from '@mbd/core/resolvers/sniffers/mangadex-media-sniff';
import { bufferSniffed, clearSnifferBufferValues } from '@/extension/content/sniffer-buffer';

const host = location.hostname;
const valid = (event: MessageEvent): boolean => event.source === window && event.origin === location.origin;
const forward = (kind: 'ig' | 'fb' | 'pinterest' | 'mangadex' | 'hls', entries: unknown[]): void => {
  bufferSniffed(kind, entries);
  chrome.runtime.sendMessage({ type: 'PASSIVE_SNIFFER_SEEN', kind, entries }).catch(() => {});
};

if (host === 'x.com' || host === 'twitter.com') window.addEventListener('message', (event) => {
  if (!valid(event)) return;
  const data = event.data as { source?: unknown; pairs?: unknown } | null;
  if (data?.source === 'mbd-x-media' && Array.isArray(data.pairs)) chrome.runtime.sendMessage({ type: 'X_MEDIA_SEEN', pairs: data.pairs }).catch(() => {});
});
if (host === 'instagram.com' || host.endsWith('.instagram.com')) window.addEventListener('message', (event) => {
  if (!valid(event)) return;
  const data = event.data as { source?: unknown; entries?: unknown } | null;
  if (data?.source === 'mbd-ig-media' && Array.isArray(data.entries)) forward('ig', data.entries);
});
if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
  window.addEventListener('message', (event) => {
    if (!valid(event)) return;
    const data = event.data as { source?: unknown; entries?: unknown } | null;
    if (data?.source === 'mbd-fb-media' && Array.isArray(data.entries)) forward('fb', data.entries);
  });
  window.postMessage({ source: 'mbd-fb-ready' }, location.origin);
}
if (isPinterestHost(host)) {
  window.addEventListener('message', (event) => {
    if (!valid(event)) return;
    const data = event.data as { source?: unknown; entries?: unknown } | null;
    if (data?.source === 'mbd-pinterest-media' && Array.isArray(data.entries)) forward('pinterest', data.entries);
  });
  window.postMessage({ source: 'mbd-pinterest-ready' }, location.origin);
}
if (isMangadexHost(host)) {
  window.addEventListener('message', (event) => {
    if (!valid(event)) return;
    const data = event.data as { source?: unknown; entries?: unknown } | null;
    if (data?.source === 'mbd-mangadex-media' && Array.isArray(data.entries)) forward('mangadex', data.entries);
  });
  window.postMessage({ source: 'mbd-mangadex-ready' }, location.origin);
}
window.addEventListener('message', (event) => {
  if (!valid(event)) return;
  const data = event.data as { source?: unknown; urls?: unknown } | null;
  if (data?.source === 'mbd-hls' && Array.isArray(data.urls)) forward('hls', data.urls);
});
window.postMessage({ source: 'mbd-hls-ready' }, location.origin);

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'OBSERVATION_STOP') {
    clearSnifferBufferValues();
    window.postMessage({ source: 'mbd-observation-stop' }, location.origin);
  }
});

// Runtime content scripts are separate bundles and some browsers isolate their
// module/global caches. Hand the extracted metadata across that boundary through
// a same-window, same-origin structured-clone message whenever the on-demand
// collector asks for the current snapshot.
window.addEventListener('message', (event) => {
  if (!valid(event)) return;
  if ((event.data as { source?: unknown } | null)?.source !== 'mbd-collector-ready') return;
  const snapshot = (globalThis as typeof globalThis & {
    __mbdSnifferBuffer?: Record<string, unknown[]>;
  }).__mbdSnifferBuffer;
  window.postMessage({
    source: 'mbd-relay-snapshot',
    snapshot: snapshot
      ? Object.fromEntries(Object.entries(snapshot).map(([key, values]) => [key, [...values]]))
      : { ig: [], fb: [], pinterest: [], mangadex: [], hls: [] },
  }, location.origin);
});

const snapshotRequestEvent = `${chrome.runtime.id}:mbd-sniffer-snapshot-request`;
const snapshotResponseEvent = `${chrome.runtime.id}:mbd-sniffer-snapshot-response`;
document.addEventListener(snapshotRequestEvent, () => {
  const snapshot = (globalThis as typeof globalThis & {
    __mbdSnifferBuffer?: Record<string, unknown[]>;
  }).__mbdSnifferBuffer ?? { ig: [], fb: [], pinterest: [], mangadex: [], hls: [] };
  document.dispatchEvent(new CustomEvent(snapshotResponseEvent, {
    // A JSON string crosses Chrome/Firefox isolated-world boundaries without
    // exposing privileged objects. Collector-side ingesters revalidate it.
    detail: JSON.stringify(snapshot),
  }));
});
