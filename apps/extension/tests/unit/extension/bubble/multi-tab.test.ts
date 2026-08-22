import type { Mock } from 'vitest';
import { collectOpenTabsFromBackground, listOpenTabsFromBackground } from '@/extension/bubble/multi-tab';

describe('bubble multi-tab background bridge', () => {
  beforeEach(() => {
    (chrome.runtime.sendMessage as Mock).mockReset();
    (chrome.runtime.onMessage.addListener as Mock).mockClear();
    (chrome.runtime.onMessage.removeListener as Mock).mockClear();
    (chrome.runtime as { lastError?: unknown }).lastError = undefined;
  });

  it('lists tabs through the background', async () => {
    (chrome.runtime.sendMessage as Mock).mockImplementation((message, callback) => {
      expect(message).toEqual({ type: 'LIST_OPEN_TABS' });
      callback({ ok: true, tabs: [{ id: 4, title: 'Four', url: 'https://four.example/' }] });
    });

    await expect(listOpenTabsFromBackground()).resolves.toEqual([
      { id: 4, title: 'Four', url: 'https://four.example/' },
    ]);
  });

  it('relays request-scoped progress and selected tab ids', async () => {
    const progress = vi.fn();
    (chrome.runtime.sendMessage as Mock).mockImplementation((message, callback) => {
      expect(message).toEqual(expect.objectContaining({ type: 'COLLECT_OPEN_TABS', tabIds: [3, 8] }));
      const listener = (chrome.runtime.onMessage.addListener as Mock).mock.calls.at(-1)?.[0];
      listener({ type: 'COLLECT_OPEN_TABS_PROGRESS', requestId: 'another-request', done: 9, total: 9 });
      listener({ type: 'COLLECT_OPEN_TABS_PROGRESS', requestId: message.requestId, done: 1, total: 2 });
      callback({ ok: true, items: [], scanned: 2, skipped: 0 });
    });

    await expect(collectOpenTabsFromBackground({ tabIds: [3, 8], onProgress: progress })).resolves.toEqual({
      items: [], scanned: 2, skipped: 0,
    });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
  });

  it('stops observing progress when the caller aborts', async () => {
    (chrome.runtime.sendMessage as Mock).mockImplementation(() => undefined);
    const controller = new AbortController();
    const pending = collectOpenTabsFromBackground({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow('cancelled');
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
  });

  it('surfaces a typed background failure message', async () => {
    (chrome.runtime.sendMessage as Mock).mockImplementation((_message, callback) => {
      callback({ ok: false, code: 'no-origin-tab', message: 'The origin tab closed.' });
    });
    await expect(collectOpenTabsFromBackground()).rejects.toThrow('The origin tab closed.');
  });
});
