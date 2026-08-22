import { DEFAULT_SETTINGS } from '@mbd/storage/settings';
import { DEFAULT_PRIVACY_PREFERENCES } from '@mbd/storage/privacy';
import {
  injectObservationIntoOpenTabs,
  stopObservationInOpenTabs,
  syncRuntimeContentScripts,
} from '@/extension/background/content-scripts';
import type { Mock } from 'vitest';

describe('runtime content-script consent', () => {
  beforeEach(() => {
    (chrome.scripting.registerContentScripts as Mock).mockClear();
    (chrome.scripting.unregisterContentScripts as Mock).mockClear();
    (chrome.scripting.executeScript as Mock).mockClear();
    (chrome.tabs.sendMessage as Mock).mockClear();
  });

  it('registers nothing for a fresh fail-closed install', async () => {
    await syncRuntimeContentScripts(DEFAULT_SETTINGS, DEFAULT_PRIVACY_PREFERENCES);
    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalled();
    expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('registers only the relay for consented automatic badge scans', async () => {
    await syncRuntimeContentScripts(DEFAULT_SETTINGS, {
      ...DEFAULT_PRIVACY_PREFERENCES,
      reviewComplete: true,
      automaticBadgeScanning: true,
    });
    const scripts = (chrome.scripting.registerContentScripts as Mock).mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(scripts.map((script) => script.id)).toEqual(['mbd-content']);
  });

  it('registers site sniffers only after observation consent', async () => {
    await syncRuntimeContentScripts(DEFAULT_SETTINGS, {
      ...DEFAULT_PRIVACY_PREFERENCES,
      reviewComplete: true,
      observeMediaRequests: true,
    });
    const scripts = (chrome.scripting.registerContentScripts as Mock).mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(scripts.map((script) => script.id)).toEqual(expect.arrayContaining([
      'mbd-sniffer-relay', 'mbd-hls-sniffer', 'mbd-fb-sniffer', 'mbd-ig-sniffer',
    ]));
    expect(scripts.map((script) => script.id)).not.toContain('mbd-content');
  });

  it('broadcasts one-way observation stop to open tabs', async () => {
    (chrome.tabs.query as Mock).mockImplementation(
      (_query: unknown, callback: (tabs: Array<{ id: number }>) => void) => callback([{ id: 1 }, { id: 2 }]),
    );
    stopObservationInOpenTabs();
    await Promise.resolve();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'OBSERVATION_STOP' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { type: 'OBSERVATION_STOP' });
  });

  it('injects the relay plus matching MAIN-world sniffers into already-loaded tabs', async () => {
    (chrome.tabs.query as Mock).mockResolvedValue([
      { id: 1, url: 'https://www.instagram.com/p/1/' },
      { id: 2, url: 'https://example.com/' },
    ]);
    await injectObservationIntoOpenTabs();
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 }, files: ['content-scripts/sniffer-relay.js'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content-scripts/hls-sniffer.js', 'content-scripts/ig-media-sniffer.js'],
      world: 'MAIN',
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: ['content-scripts/hls-sniffer.js'],
      world: 'MAIN',
    });
  });
});
