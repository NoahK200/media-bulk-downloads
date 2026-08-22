import type { PrivacyPreferences, SettingsData } from '@mbd/core/types';
import { isPinterestHost, PINTEREST_MATCHES } from '@mbd/core/resolvers/sniffers/pinterest-hosts';

type Script = chrome.scripting.RegisteredContentScript;

const collector = (): Script => ({
  id: 'mbd-content',
  js: ['content-scripts/content.js'],
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  persistAcrossSessions: true,
});

const bubble = (): Script => ({
  id: 'mbd-bubble',
  js: ['content-scripts/bubble.js'],
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  persistAcrossSessions: true,
});

const snifferRelay = (): Script => ({
  id: 'mbd-sniffer-relay',
  js: ['content-scripts/sniffer-relay.js'],
  matches: ['<all_urls>'],
  runAt: 'document_start',
  persistAcrossSessions: true,
});

const sniffers = (): Script[] => [
  { id: 'mbd-fb-sniffer', js: ['content-scripts/fb-media-sniffer.js'], matches: ['*://*.facebook.com/*'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
  { id: 'mbd-hls-sniffer', js: ['content-scripts/hls-sniffer.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
  { id: 'mbd-ig-sniffer', js: ['content-scripts/ig-media-sniffer.js'], matches: ['*://*.instagram.com/*'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
  { id: 'mbd-mangadex-sniffer', js: ['content-scripts/mangadex-media-sniffer.js'], matches: ['*://*.mangadex.org/*'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
  {
    id: 'mbd-pinterest-sniffer', js: ['content-scripts/pinterest-media-sniffer.js'],
    matches: PINTEREST_MATCHES,
    runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true,
  },
  { id: 'mbd-x-sniffer', js: ['content-scripts/x-media-sniffer.js'], matches: ['*://x.com/*', '*://twitter.com/*'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
];

let syncChain: Promise<void> = Promise.resolve();

/** Reconcile persisted registrations from authoritative local privacy consent.
 * Failures are fail-closed: no fallback manifest scripts are installed. */
export function syncRuntimeContentScripts(
  settings: SettingsData,
  privacy: PrivacyPreferences,
): Promise<void> {
  const run = syncChain.then(async () => {
    if (!chrome.scripting?.registerContentScripts) return;
    try {
      // Omitting ids removes every dynamic registration owned by this extension.
      // Chrome rejects a mixed id list when any id was never registered, which
      // otherwise leaves a previously consented collector/sniffer active.
      await chrome.scripting.unregisterContentScripts();
    } catch {
      // A fresh install has nothing registered.
    }
    const scripts: Script[] = [];
    if (privacy.automaticBadgeScanning) scripts.push(collector());
    if (settings.bubbleEnabled) scripts.push(bubble());
    if (privacy.observeMediaRequests) scripts.push(snifferRelay(), ...sniffers());
    if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
    if (settings.bubbleEnabled && chrome.scripting.executeScript) {
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.slice(0, 50).map(async (tab) => {
        if (tab.id == null || !/^https?:/i.test(tab.url ?? '')) return;
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/bubble.js'] }); }
        catch { /* restricted or closing tab */ }
      }));
    }
  });
  syncChain = run.catch(() => undefined);
  return run;
}

export function stopObservationInOpenTabs(): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      void chrome.tabs.sendMessage(tab.id, { type: 'OBSERVATION_STOP' }).catch(() => {});
    }
  });
}

/** Activate observation in pages that were already loaded when consent was
 * granted. This can observe only future requests; the UI tells the user to
 * reload when they need requests made before activation. */
export async function injectObservationIntoOpenTabs(): Promise<void> {
  if (!chrome.scripting?.executeScript) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.slice(0, 50).map(async (tab) => {
    if (tab.id == null || !/^https?:/i.test(tab.url ?? '')) return;
    let host = '';
    try { host = new URL(tab.url!).hostname.toLowerCase(); } catch { return; }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/sniffer-relay.js'],
      });
      const files = ['content-scripts/hls-sniffer.js'];
      if (host === 'facebook.com' || host.endsWith('.facebook.com')) files.push('content-scripts/fb-media-sniffer.js');
      if (host === 'instagram.com' || host.endsWith('.instagram.com')) files.push('content-scripts/ig-media-sniffer.js');
      if (host === 'mangadex.org' || host.endsWith('.mangadex.org')) files.push('content-scripts/mangadex-media-sniffer.js');
      if (isPinterestHost(host)) files.push('content-scripts/pinterest-media-sniffer.js');
      if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
        files.push('content-scripts/x-media-sniffer.js');
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files, world: 'MAIN' });
    } catch { /* restricted, closed, or unsupported tab */ }
  }));
}
