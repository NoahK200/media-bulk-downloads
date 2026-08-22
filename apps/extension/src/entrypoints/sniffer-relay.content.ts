import { defineContentScript } from 'wxt/utils/define-content-script';
export default defineContentScript({
  registration: 'runtime', matches: ['<all_urls>'], runAt: 'document_start',
  async main() {
    const scope = globalThis as typeof globalThis & { __mbdSnifferRelayReady?: Promise<unknown> };
    scope.__mbdSnifferRelayReady ??= import('@/extension/content/sniffer-relay');
    await scope.__mbdSnifferRelayReady;
  },
});

