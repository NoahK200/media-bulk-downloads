import type {
  CollectOpenTabsProgressMessage,
  CollectOpenTabsResponse,
  ListOpenTabsResponse,
  MultiTabCollectionOptions,
  MultiTabCollectionResult,
  OpenTabInfo,
} from '@mbd/core/types';

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tabs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function responseError(response: unknown, fallback: string): Error {
  const message = response && typeof response === 'object' && 'message' in response
    && typeof (response as { message?: unknown }).message === 'string'
    ? (response as { message: string }).message
    : undefined;
  return new Error(message || chrome.runtime.lastError?.message || fallback);
}

/** Lists tabs through the background because the bubble runs in a content script
 * and cannot use the privileged tabs API directly. The background derives the
 * window from sender.tab instead of accepting a caller-supplied window id. */
export function listOpenTabsFromBackground(): Promise<OpenTabInfo[]> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'LIST_OPEN_TABS' }, (response?: ListOpenTabsResponse) => {
        if (chrome.runtime.lastError || !response?.ok || !Array.isArray(response.tabs)) {
          reject(responseError(response, 'Open tabs are unavailable.'));
          return;
        }
        resolve(response.tabs);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Open tabs are unavailable.'));
    }
  });
}

/** Runs a bubble-originated multi-tab scan in the background and translates its
 * request-scoped progress events back into the App collector callback contract. */
export function collectOpenTabsFromBackground(
  options: MultiTabCollectionOptions = {},
): Promise<MultiTabCollectionResult> {
  const id = requestId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      chrome.runtime.onMessage.removeListener(onMessage);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onMessage = (message: unknown): void => {
      const progress = message as Partial<CollectOpenTabsProgressMessage> | null;
      if (
        !progress
        || progress.type !== 'COLLECT_OPEN_TABS_PROGRESS'
        || progress.requestId !== id
        || typeof progress.done !== 'number'
        || typeof progress.total !== 'number'
      ) return;
      options.onProgress?.(progress.done, progress.total);
    };
    const onAbort = (): void => finish(() => reject(new Error('Multi-tab collection was cancelled.')));

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    chrome.runtime.onMessage.addListener(onMessage);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      chrome.runtime.sendMessage(
        { type: 'COLLECT_OPEN_TABS', requestId: id, ...(options.tabIds ? { tabIds: options.tabIds } : {}) },
        (response?: CollectOpenTabsResponse) => {
          if (chrome.runtime.lastError || !response?.ok) {
            finish(() => reject(responseError(response, 'Multi-tab collection is unavailable.')));
            return;
          }
          finish(() => resolve({
            items: Array.isArray(response.items) ? response.items : [],
            scanned: response.scanned,
            skipped: response.skipped,
          }));
        },
      );
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('Multi-tab collection is unavailable.')));
    }
  });
}
