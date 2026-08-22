import { test, expect, serviceWorker } from '../fixtures/extension';

const registrations = async (context: Parameters<typeof serviceWorker>[0]): Promise<string[]> => {
  const worker = await serviceWorker(context);
  return worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id).sort());
};

const setPrivacy = async (
  context: Parameters<typeof serviceWorker>[0],
  patch: Record<string, boolean>,
): Promise<void> => {
  const worker = await serviceWorker(context);
  await worker.evaluate(async (next) => {
    await chrome.storage.local.set({
      privacyPreferences: {
        version: 1,
        reviewComplete: false,
        automaticBadgeScanning: false,
        observeMediaRequests: false,
        sankakuSessionResolution: false,
        ...next,
      },
    });
  }, patch);
};

test('fresh profile is inspection-free and each consent changes runtime registration immediately', async ({ context, baseURL }) => {
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${baseURL}/products/privacy-product`);

  await expect.poll(() => registrations(context)).toEqual([]);
  expect(await page.evaluate(() => ({
    fetchNative: window.fetch === (window as typeof window & { __mbdNativeFetch: typeof fetch }).__mbdNativeFetch,
    xhrNative: XMLHttpRequest.prototype.open === (window as typeof window & { __mbdNativeXhrOpen: typeof XMLHttpRequest.prototype.open }).__mbdNativeXhrOpen,
  }))).toEqual({ fetchNative: true, xhrNative: true });

  const worker = await serviceWorker(context);
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
  const probe = await worker.evaluate((tabId) => new Promise<{ response: unknown; error: boolean }>((resolve) => {
    chrome.tabs.sendMessage(tabId!, { type: 'GET_IMAGES', allowNetwork: false }, (response) => {
      resolve({ response, error: Boolean(chrome.runtime.lastError) });
    });
  }), tab.id);
  expect(probe.error).toBe(true);
  expect(requests).not.toContain('/products/privacy-product.js');

  await setPrivacy(context, { reviewComplete: true, automaticBadgeScanning: true });
  await expect.poll(() => registrations(context)).toContain('mbd-content');
  await expect.poll(() => requests.includes('/products/privacy-product.js')).toBe(false);
  await setPrivacy(context, { automaticBadgeScanning: false });
  await expect.poll(() => registrations(context)).not.toContain('mbd-content');

  await setPrivacy(context, { observeMediaRequests: true });
  await expect.poll(() => registrations(context)).toEqual(expect.arrayContaining(['mbd-sniffer-relay', 'mbd-hls-sniffer']));
  await expect.poll(() => page.evaluate(() => window.fetch !== (window as typeof window & { __mbdNativeFetch: typeof fetch }).__mbdNativeFetch)).toBe(true);
  await page.evaluate(() => fetch('/observed.m3u8').catch(() => undefined));
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __mbdHlsEvents: number }).__mbdHlsEvents)).toBeGreaterThan(0);
  const beforeDisable = await page.evaluate(() => (window as typeof window & { __mbdHlsEvents: number }).__mbdHlsEvents);

  await setPrivacy(context, { observeMediaRequests: false });
  await expect.poll(() => registrations(context)).not.toContain('mbd-sniffer-relay');
  await page.evaluate(() => fetch('/after-disable.m3u8').catch(() => undefined));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as typeof window & { __mbdHlsEvents: number }).__mbdHlsEvents)).toBe(beforeDisable);
});
