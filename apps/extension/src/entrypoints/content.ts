import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  registration: 'runtime',
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    const scope = globalThis as typeof globalThis & { __mbdContentReady?: Promise<unknown> };
    scope.__mbdContentReady ??= import('@/extension/content');
    await scope.__mbdContentReady;
  },
});
