import { ImageInfo } from '@mbd/core/types';
import { filterImagesBySettings, filterExcluded } from '@mbd/core/collection/filters';
import { currentPrivacy, currentSettings, excludedCache, settingsReady, excludedReady } from '@/extension/background/state';
import { ensureContentScript } from '@/extension/shared/active-tab/runtime-content';

export const BADGE_COLOR = '#4F46E5';

/**
 * Whether the on-page bubble can be injected into a given URL. Content scripts
 * don't run on browser pages, the extension gallery, or the Chrome Web Store.
 */
export function isInjectableUrl(url: string | undefined): boolean {
  if (!url || !/^(https?|file):/i.test(url)) return false;
  if (/^https:\/\/chromewebstore\.google\.com/i.test(url)) return false;
  if (/^https:\/\/chrome\.google\.com\/webstore/i.test(url)) return false;
  if (/^https:\/\/addons\.mozilla\.org/i.test(url)) return false;
  return true;
}

/**
 * When the bubble is enabled on an injectable page, clear the toolbar popup so a
 * click toggles the on-page bubble instead. Everywhere else, keep the popup as a
 * fallback (it's the only surface that works on restricted pages).
 */
export function updateTabActionMode(tabId: number, url: string | undefined): void {
  const useBubble = currentSettings.bubbleEnabled && isInjectableUrl(url);
  chrome.action.setPopup({ tabId, popup: useBubble ? '' : 'popup.html' });
}

export function updateAllTabsActionMode(): void {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        updateTabActionMode(tab.id, tab.url);
      }
    });
  });
}

/**
 * Clear the badge text for all tabs.
 */
export function clearAllBadges(): void {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.action.setBadgeText({ text: '', tabId: tab.id });
      }
    });
  });
}

/**
 * Update the badge text for all tabs.
 */
export function updateAllTabsBadges(): void {
  chrome.tabs.query({}, (tabs) => {
    const ids = tabs.flatMap((tab) => tab.id == null ? [] : [tab.id]).slice(0, 50);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < ids.length) await updateTabBadge(ids[cursor++]);
    };
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  });
}

/**
 * Update the badge text for the given tab.
 */
export async function updateTabBadge(tabId: number): Promise<void> {
  await Promise.all([settingsReady, excludedReady]);
  try {
    await ensureContentScript(tabId);
    await new Promise<void>((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_IMAGES', allowNetwork: false }, (images: ImageInfo[]) => {
        if (chrome.runtime.lastError) {
          chrome.action.setBadgeText({ text: '', tabId });
          resolve();
          return;
        }
        if (images) {
          const eligible = filterExcluded(filterImagesBySettings(images, currentSettings), excludedCache);
          chrome.action.setBadgeText({ text: eligible.length.toString(), tabId });
          chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
        }
        resolve();
      });
    });
  } catch {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

/**
 * Apply the current settings to all tabs.
 */
export function applySettings(): void {
  if (!currentPrivacy.automaticBadgeScanning) {
    clearAllBadges();
  } else {
    updateAllTabsBadges();
  }
  updateAllTabsActionMode();
}
