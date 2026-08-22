import { ChromeMessage, SettingsData } from '@mbd/core/types';
import { withDefaults } from '@mbd/storage/settings';
import { EXCLUDED_KEY } from '@mbd/storage/excluded';
import { markSaveAsPromptSeen } from '@mbd/storage/save-as-hint';
import { persistStorage, syncStores } from '@mbd/storage/sync';
import { initQueueDispatcher, reconcileQueue } from '@/extension/background/download/download-queue';
import {
  currentPrivacy, currentSettings, excludedReady, settingsReady, privacyReady, PRIVACY_KEY,
  loadSettings, reloadExcluded, resolveSettingsGate, setCurrentPrivacy, setCurrentSettings, setApplySettingsHook,
} from '@/extension/background/state';
import {
  applySettings, updateTabBadge, updateTabActionMode, updateAllTabsBadges, BADGE_COLOR,
} from '@/extension/background/badge';
import { clearPassiveSnifferEntries, snifferByTab } from '@/extension/background/sniffer-store';
import { setupContextMenus } from '@/extension/background/context-menu';
import { onCommand, onContextMenuClick } from '@/extension/background/commands';
import { messageRouter, broadcastSettings, type SendResponse } from '@/extension/background/message-router';
import { platform } from '@/extension/platform';
import {
  DEFAULT_PRIVACY_PREFERENCES,
  sanitizePrivacyPreferences,
  savePrivacyPreferences,
} from '@mbd/storage/privacy';
import {
  injectObservationIntoOpenTabs,
  stopObservationInOpenTabs,
  syncRuntimeContentScripts,
} from '@/extension/background/content-scripts';
import { isValidBackgroundMessage } from '@/extension/background/message-validation';
import { handleCaptureDownloadChanged } from '@/extension/background/download/capture';
import { purgeAbandonedCaptureFiles } from '@/extension/capture/capture-sink';

setApplySettingsHook(applySettings);

void persistStorage();
void syncStores();
void purgeAbandonedCaptureFiles();

chrome.contextMenus?.onClicked.addListener(onContextMenuClick);
chrome.commands?.onCommand.addListener(onCommand);
chrome.runtime.onStartup?.addListener(setupContextMenus);

chrome.runtime.onInstalled.addListener((details) => {
  loadSettings();
  setupContextMenus();
  if (details?.reason === 'update') {
    // Consent is deliberately per-version as well as per-device. An upgrade
    // cannot inherit page-inspection or credential access without presenting
    // the new build's privacy review first.
    void savePrivacyPreferences(DEFAULT_PRIVACY_PREFERENCES).then((result) => {
      if (!result.ok) return;
      setCurrentPrivacy({ ...DEFAULT_PRIVACY_PREFERENCES });
      stopObservationInOpenTabs();
      applySettings();
      return syncRuntimeContentScripts(currentSettings, currentPrivacy);
    }).catch(() => {});
  }
});

if (chrome.storage?.sync) {
  loadSettings();
}

initQueueDispatcher({
  getConcurrency: () => currentSettings.downloadConcurrency,
  getSaveAs: () => currentSettings.saveAs,
});
chrome.runtime.onStartup?.addListener(() => {
  void reconcileQueue();
});
void settingsReady.then(() => reconcileQueue()).catch(() => {});
void Promise.all([settingsReady, privacyReady])
  .then(async () => {
    applySettings();
    await syncRuntimeContentScripts(currentSettings, currentPrivacy);
  })
  .catch(() => {})
  .finally(() => {
    (globalThis as typeof globalThis & { __mbdBackgroundReady?: boolean }).__mbdBackgroundReady = true;
  });
void settingsReady.then(() => {
  chrome.storage.sync.get(['settings'], (result) => {
    const raw = result.settings && typeof result.settings === 'object' ? result.settings as Record<string, unknown> : {};
    if (raw.showImageCount !== false || raw.sankakuAuthedOriginals !== false) {
      chrome.storage.sync.set({ settings: { ...raw, showImageCount: false, sankakuAuthedOriginals: false } });
    }
  });
}).catch(() => {});

platform.downloader.onChanged((change) => {
  handleCaptureDownloadChanged(change);
  if (change.error === 'USER_CANCELED') void markSaveAsPromptSeen();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.settings) {
    const next = withDefaults(changes.settings.newValue as Partial<SettingsData>);
    setCurrentSettings(next);
    applySettings();
    void syncRuntimeContentScripts(currentSettings, currentPrivacy);
    resolveSettingsGate();
    broadcastSettings(next);
  } else if (namespace === 'local' && changes[PRIVACY_KEY]) {
    const wasObserving = currentPrivacy.observeMediaRequests;
    setCurrentPrivacy(sanitizePrivacyPreferences(changes[PRIVACY_KEY].newValue));
    if (!wasObserving && currentPrivacy.observeMediaRequests) void injectObservationIntoOpenTabs();
    if (wasObserving && !currentPrivacy.observeMediaRequests) {
      snifferByTab.clear();
      clearPassiveSnifferEntries();
      stopObservationInOpenTabs();
    }
    applySettings();
    void syncRuntimeContentScripts(currentSettings, currentPrivacy);
  } else if (namespace === 'local' && changes[EXCLUDED_KEY]) {
    reloadExcluded();
    if (currentPrivacy.automaticBadgeScanning) void excludedReady.then(() => updateAllTabsBadges());
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  snifferByTab.delete(tabId);
  clearPassiveSnifferEntries(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (currentPrivacy.automaticBadgeScanning) {
    updateTabBadge(activeInfo.tabId);
  }
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) return;
    updateTabActionMode(tab.id, tab.url);
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, 'TOGGLE_BUBBLE', () => void chrome.runtime.lastError);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    snifferByTab.delete(tabId);
    clearPassiveSnifferEntries(tabId);
  }

  if (changeInfo.status === 'complete' || changeInfo.url) {
    updateTabActionMode(tabId, tab.url);
  }

  if (!currentPrivacy.automaticBadgeScanning) {
    return;
  }

  if (changeInfo.status === 'complete' && tab.url) {
    updateTabBadge(tabId);
  } else if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '...', tabId });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
  }
});

chrome.runtime.onMessage.addListener(
  (message: ChromeMessage, sender: chrome.runtime.MessageSender, sendResponse: SendResponse) => {
    if (!isValidBackgroundMessage(message)) return false;
    const handler = messageRouter[message.type];
    if (!handler) return false;
    return (handler as (m: ChromeMessage, s: chrome.runtime.MessageSender, r: SendResponse) => boolean | void)(
      message,
      sender,
      sendResponse,
    );
  },
);

export { DEFAULT_SETTINGS } from '@mbd/storage/settings';
export { sanitizePathSegment } from '@mbd/core/collection/paths';
export { buildDownloadFilename, extensionForType, originalNameFromUrl } from '@mbd/core/collection/download-name';
export { loadSettings } from '@/extension/background/state';
export { isInjectableUrl, updateTabBadge } from '@/extension/background/badge';
export { downloadAndRecord, downloadStatusMessage } from '@/extension/background/download/downloads';
export { resolveOriginalsBatch, storeSniffedMedia } from '@/extension/background/sniffer-store';
export { setupContextMenus, mediaFromContext } from '@/extension/background/context-menu';
