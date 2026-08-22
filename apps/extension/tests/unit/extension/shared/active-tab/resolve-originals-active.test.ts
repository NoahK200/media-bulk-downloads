import type { Mock } from 'vitest';
import { requestResolveOriginals } from '@/extension/shared/active-tab/resolve-originals-active';

const send = chrome.runtime.sendMessage as Mock;

describe('requestResolveOriginals', () => {
  beforeEach(() => {
    send.mockReset();
    (chrome.runtime as unknown as { lastError?: unknown }).lastError = undefined;
  });

  it('short-circuits to an empty map with no message when there are no targets', async () => {
    await expect(requestResolveOriginals([])).resolves.toEqual({});
    expect(send).not.toHaveBeenCalled();
  });

  it('sends RESOLVE_ORIGINALS with the hints and resolves the returned map', async () => {
    const resolved = { 'https://x/a': { url: 'https://x/a.mp4' } };
    send.mockImplementation((_msg, cb) => cb({ resolved }));
    const targets = [{ src: 'https://x/a', hint: { platform: 'twitter' as const, id: '1' } }];

    await expect(requestResolveOriginals(targets)).resolves.toEqual(resolved);
    expect(send).toHaveBeenCalledWith(
      { type: 'RESOLVE_ORIGINALS', hints: targets, credentialScopes: [] },
      expect.any(Function),
    );
  });

  it('resolves to an empty map when the background reports a lastError', async () => {
    (chrome.runtime as unknown as { lastError?: unknown }).lastError = { message: 'no receiver' };
    send.mockImplementation((_msg, cb) => cb(undefined));
    await expect(requestResolveOriginals([{ src: 'https://x/a', hint: { platform: 'twitter', id: '1' } }])).resolves.toEqual({});
  });

  it('resolves to an empty map when the response is missing', async () => {
    send.mockImplementation((_msg, cb) => cb(undefined));
    await expect(requestResolveOriginals([{ src: 'https://x/a', hint: { platform: 'twitter', id: '1' } }])).resolves.toEqual({});
  });

  it('resolves to an empty map when the response carries no resolved field', async () => {
    send.mockImplementation((_msg, cb) => cb({}));
    await expect(requestResolveOriginals([{ src: 'https://x/a', hint: { platform: 'twitter', id: '1' } }])).resolves.toEqual({});
  });

  it('includes Sankaku session scope only when the batch contains a Sankaku target', async () => {
    send.mockImplementation((_msg, cb) => cb({ resolved: {} }));
    await requestResolveOriginals(
      [{ src: 'https://x/a', hint: { platform: 'twitter', id: '1' } }],
      ['sankaku-session'],
    );
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialScopes: [] }), expect.any(Function),
    );
    await requestResolveOriginals(
      [{ src: 'https://sankakucomplex.com/a', hint: { platform: 'sankaku', id: '1' } }],
      ['sankaku-session'],
    );
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialScopes: ['sankaku-session'] }), expect.any(Function),
    );
  });
});
