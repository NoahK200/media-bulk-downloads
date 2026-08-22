import { defineContentScript } from 'wxt/utils/define-content-script';
export default defineContentScript({
  registration: 'runtime', matches: ['<all_urls>'], runAt: 'document_idle',
  async main() {
    const scope = globalThis as typeof globalThis & { __mbdBubbleReady?: Promise<unknown> };
    scope.__mbdBubbleReady ??= import('@/extension/content/bubble-controller');
    await scope.__mbdBubbleReady;
  },
});

