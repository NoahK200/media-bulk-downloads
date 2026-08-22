/** On-demand collection/deep-scan content script. It is never manifest-registered
 * on a fresh install; popup actions inject it, while badge consent may register it. */
import type { DeepScanProgress } from '@mbd/core/types';
import { collectMedia } from '@/extension/content/collect';
import { ensureShopifyProduct } from '@/extension/content/shopify-product';
import { loadEffectiveSettingsForHost } from '@mbd/storage/per-host-settings';
import { startDeepScan } from '@/extension/content/deepScanRunner';
import { classifyPage, collectPageSignals } from '@mbd/core/collection/pageType';
import { clearSnifferBuffers, syncSnifferBuffers } from '@/extension/content/sniffer-hydrate';

export * from '@/extension/content/collect';

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const getImages = message === 'GET_IMAGES'
    || (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'GET_IMAGES');
  if (getImages) {
    const allowNetwork = typeof message === 'object' && message !== null
      && (message as { allowNetwork?: unknown }).allowNetwork === true;
    void loadEffectiveSettingsForHost(location.hostname)
      .then(async (settings) => {
        if (allowNetwork && settings.resolveOriginals) await ensureShopifyProduct(location.href);
        await syncSnifferBuffers();
        sendResponse(collectMedia(undefined, { smartPageDefaults: settings.smartPageDefaults, resolveOriginals: settings.resolveOriginals }));
      })
      .catch(async () => {
        await syncSnifferBuffers();
        sendResponse(collectMedia());
      });
    return true;
  }
  if (message === 'GET_PAGE_TYPE') sendResponse(classifyPage(collectPageSignals(document)));
  if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'OBSERVATION_STOP') {
    clearSnifferBuffers();
  }
});

let deepScanAbort: AbortController | null = null;
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (message === 'DEEP_SCAN') {
    deepScanAbort?.abort();
    deepScanAbort = new AbortController();
    const signal = deepScanAbort.signal;
    const onProgress: Parameters<typeof startDeepScan>[0] = (found, scrolls, elapsedMs, reason) => {
      const progress: DeepScanProgress = { type: 'DEEP_SCAN_PROGRESS', found, scrolls, elapsedMs };
      if (reason) progress.reason = reason;
      chrome.runtime.sendMessage(progress).catch(() => {});
    };
    void loadEffectiveSettingsForHost(location.hostname)
      .then(async (settings) => {
        if (settings.resolveOriginals) await ensureShopifyProduct(location.href);
        await syncSnifferBuffers();
        return startDeepScan(onProgress, signal, {
          maxItems: settings.deepScanMaxItems,
          maxMs: settings.deepScanMaxSeconds * 1000,
          maxScrolls: settings.deepScanMaxScrolls,
          clickLoadMore: settings.deepScanClickLoadMore,
          rememberScanBehaviour: settings.rememberScanBehaviour,
        });
      })
      .then((media) => sendResponse(media))
      .catch(() => sendResponse([]));
    return true;
  }
  if (message === 'DEEP_SCAN_ABORT') {
    deepScanAbort?.abort();
    sendResponse(true);
  }
});
