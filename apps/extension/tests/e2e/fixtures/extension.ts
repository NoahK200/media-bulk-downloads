import { test as base, chromium, expect as baseExpect, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const target = process.env.E2E_EXTENSION_TARGET || 'chrome-mv3';
const browserChannel = process.env.E2E_BROWSER_CHANNEL || 'chromium';
const extensionPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.output', target);

/**
 * Playwright fixtures that load the built MV3 extension into a persistent
 * Chromium context (the only way Chromium loads an unpacked extension) and
 * expose the extension id. Per Playwright's chrome-extensions guide, the
 * `chromium` channel lets the extension run headless.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: browserChannel,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = await serviceWorker(context);
    await use(worker.url().split('/')[2]);
  },
});

export const expect = baseExpect;

/** The extension's background service worker (waits for it if not yet started). */
export async function serviceWorker(context: BrowserContext): Promise<Worker> {
  const [existing] = context.serviceWorkers();
  const worker = existing ?? (await context.waitForEvent('serviceworker'));
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await worker.evaluate(() =>
      (globalThis as typeof globalThis & { __mbdBackgroundReady?: boolean }).__mbdBackgroundReady === true);
    if (ready) return worker;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Extension background did not finish registering its listeners.');
}
