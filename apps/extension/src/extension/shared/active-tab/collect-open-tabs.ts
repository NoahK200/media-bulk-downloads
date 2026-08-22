import type { ImageInfo, MultiTabCollectionOptions, MultiTabCollectionResult, OpenTabInfo } from '@mbd/core/types';
export type { OpenTabInfo } from '@mbd/core/types';
import { dedupeByCanonical } from '@mbd/core/collection/multiTab';
import { mapWithConcurrency } from '@/extension/popup/utils';
import { ensureContentScript } from '@/extension/shared/active-tab/runtime-content';

/** Cap on concurrent per-tab GET_IMAGES sends, so scanning many tabs doesn't fan
 *  out into dozens of simultaneous collect runs. */
const TAB_SCAN_CONCURRENCY = 5;
export const MAX_MULTI_TAB_COUNT = 50;
/** Per-tab budget. An unresponsive tab (no live content script, not fully loaded,
 *  or a heavy page) is abandoned after this and counted as skipped, never stalling
 *  the batch. */
const TAB_SCAN_TIMEOUT_MS = 8000;

/** An open tab we can actually collect from: real tab id, loaded (not discarded),
 *  and an http(s) page (so restricted schemes — chrome://, chrome-extension://,
 *  file://, about:, view-source: — are excluded up front). */
function isEligibleTab(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number; url: string } {
  return typeof tab.id === 'number' && !tab.discarded && !!tab.url && /^https?:/i.test(tab.url);
}

/** Messages one tab's content script for its media, resolving null on any failure
 *  (no content script, runtime error, or timeout) so the caller can count it as
 *  skipped. Mirrors collect-active-tab's GET_IMAGES send, plus a timeout race. */
async function sendGetImages(tabId: number): Promise<ImageInfo[] | null> {
  try {
    await ensureContentScript(tabId);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: ImageInfo[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), TAB_SCAN_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'GET_IMAGES', allowNetwork: true }, (images: ImageInfo[]) => {
        if (chrome.runtime.lastError) return finish(null);
        finish(Array.isArray(images) ? images : []);
      });
    } catch {
      finish(null);
    }
  });
}

/** Eligible tabs in the current window, for the "Selected tabs" picker. */
export async function listOpenTabs(windowId?: number): Promise<OpenTabInfo[]> {
  const all = await chrome.tabs.query(windowId == null ? { currentWindow: true } : { windowId });
  return all.filter(isEligibleTab).slice(0, MAX_MULTI_TAB_COUNT).map((t) => ({
    id: t.id,
    title: t.title?.trim() || t.url,
    url: t.url,
    favIconUrl: t.favIconUrl,
  }));
}

/**
 * Collects media across the current window's open tabs (#283). With `tabIds`,
 * restricts to that subset (the "Selected tabs" scope); otherwise every eligible
 * tab ("All tabs"). Each tab is messaged with bounded concurrency and a per-tab
 * timeout; returned items are tagged with their source tab and the combined set is
 * de-duplicated by canonical identity (largest copy wins). Restricted/unresponsive
 * tabs are counted in `skipped`, never fatal.
 */
export async function collectOpenTabs(
  opts: MultiTabCollectionOptions & { windowId?: number } = {},
): Promise<MultiTabCollectionResult> {
  const all = await chrome.tabs.query(opts.windowId == null ? { currentWindow: true } : { windowId: opts.windowId });
  const wanted = opts.tabIds ? all.filter((t) => typeof t.id === 'number' && opts.tabIds!.includes(t.id)) : all;
  const allEligible = wanted.filter(isEligibleTab);
  const eligible = allEligible.slice(0, MAX_MULTI_TAB_COUNT);
  const ineligible = wanted.length - allEligible.length;
  const missing = opts.tabIds ? Math.max(0, opts.tabIds.length - wanted.length) : 0;
  const overLimit = Math.max(0, allEligible.length - eligible.length);

  const total = eligible.length;
  let done = 0;
  let failed = 0;

  const perTab = await mapWithConcurrency(eligible, TAB_SCAN_CONCURRENCY, async (tab) => {
    const images = await sendGetImages(tab.id);
    done++;
    opts.onProgress?.(done, total);
    if (!images) {
      failed++;
      return [] as ImageInfo[];
    }
    const sourcePage = { url: tab.url, title: tab.title };
    return images.map((im) => ({ ...im, sourcePage }));
  });

  return {
    items: dedupeByCanonical(perTab.flat()),
    scanned: total - failed,
    skipped: ineligible + missing + overLimit + failed,
  };
}
