import type { Mock } from 'vitest';
import { requestMediaMeta } from '@/extension/shared/active-tab/probe-media-meta';

const send = chrome.runtime.sendMessage as Mock;

describe('requestMediaMeta', () => {
  beforeEach(() => {
    send.mockReset();
    (chrome.runtime as unknown as { lastError?: unknown }).lastError = undefined;
  });

  it('short-circuits to an empty map when there are no targets', async () => {
    await expect(requestMediaMeta([])).resolves.toEqual({});
    expect(send).not.toHaveBeenCalled();
  });

  it('requests metadata and returns the background response', async () => {
    const srcs = ['https://cdn.example/a.jpg'];
    const meta = { [srcs[0]]: { ok: true, bytes: 1_024, type: 'image/jpeg' } };
    send.mockImplementation((_message, callback) => callback({ meta }));

    await expect(requestMediaMeta(srcs)).resolves.toEqual(meta);
    expect(send).toHaveBeenCalledWith(
      { type: 'PROBE_MEDIA_META', srcs },
      expect.any(Function),
    );
  });

  it('returns an empty map when the receiver is unavailable or malformed', async () => {
    (chrome.runtime as unknown as { lastError?: unknown }).lastError = { message: 'no receiver' };
    send.mockImplementation((_message, callback) => callback(undefined));
    await expect(requestMediaMeta(['https://cdn.example/a.jpg'])).resolves.toEqual({});

    (chrome.runtime as unknown as { lastError?: unknown }).lastError = undefined;
    send.mockImplementation((_message, callback) => callback({}));
    await expect(requestMediaMeta(['https://cdn.example/b.jpg'])).resolves.toEqual({});
  });
});
