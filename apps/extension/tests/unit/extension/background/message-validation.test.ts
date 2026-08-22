import { isValidBackgroundMessage } from '@/extension/background/message-validation';

const media = {
  src: 'https://cdn.example/a.jpg',
  kind: 'image',
  type: 'jpeg',
  width: 100,
  height: 100,
  fileSize: 1_024,
  isBase64: false,
};

describe('background message validation', () => {
  it('accepts a bounded media download and rejects malformed media metadata', () => {
    expect(isValidBackgroundMessage({ type: 'DOWNLOAD_IMAGES', images: [media] })).toBe(true);
    expect(isValidBackgroundMessage({ type: 'DOWNLOAD_IMAGES', images: [{ ...media, width: Number.NaN }] })).toBe(false);
    expect(isValidBackgroundMessage({ type: 'DOWNLOAD_IMAGES', images: [{ ...media, src: 'javascript:alert(1)' }] })).toBe(false);
  });

  it('allows only the explicit Sankaku credential scope', () => {
    const base = {
      type: 'RESOLVE_ORIGINALS',
      hints: [{ src: 'https://sankakucomplex.com/a', hint: { platform: 'sankaku', id: '1' } }],
    };
    expect(isValidBackgroundMessage({ ...base, credentialScopes: ['sankaku-session'] })).toBe(true);
    expect(isValidBackgroundMessage({ ...base, credentialScopes: ['generic-auth'] })).toBe(false);
    expect(isValidBackgroundMessage({ ...base, credentialScopes: ['sankaku-session', 'sankaku-session'] })).toBe(false);
  });

  it('rejects oversized text/base64 transfers and malformed sniffer pairs', () => {
    expect(isValidBackgroundMessage({
      type: 'DOWNLOAD_TEXT', filename: 'x.txt', mime: 'text/plain', text: 'x'.repeat(10 * 1024 * 1024 + 1),
    })).toBe(false);
    expect(isValidBackgroundMessage({ type: 'X_MEDIA_SEEN', pairs: [['1', { url: 'https://video.example/v.mp4' }]] })).toBe(true);
    expect(isValidBackgroundMessage({ type: 'X_MEDIA_SEEN', pairs: [['1', { url: 'file:///secret' }]] })).toBe(false);
  });

  it('accepts bounded unique multi-tab requests and rejects malformed tab ids', () => {
    expect(isValidBackgroundMessage({ type: 'LIST_OPEN_TABS' })).toBe(true);
    expect(isValidBackgroundMessage({ type: 'COLLECT_OPEN_TABS', requestId: 'request-1' })).toBe(true);
    expect(isValidBackgroundMessage({ type: 'COLLECT_OPEN_TABS', requestId: 'request-2', tabIds: [1, 2, 3] })).toBe(true);
    expect(isValidBackgroundMessage({ type: 'COLLECT_OPEN_TABS', requestId: '', tabIds: [1] })).toBe(false);
    expect(isValidBackgroundMessage({ type: 'COLLECT_OPEN_TABS', requestId: 'request-3', tabIds: [1, 1] })).toBe(false);
    expect(isValidBackgroundMessage({ type: 'COLLECT_OPEN_TABS', requestId: 'request-4', tabIds: [0, -1, 1.5] })).toBe(false);
    expect(isValidBackgroundMessage({
      type: 'COLLECT_OPEN_TABS', requestId: 'request-5', tabIds: Array.from({ length: 51 }, (_, i) => i + 1),
    })).toBe(false);
  });
});
