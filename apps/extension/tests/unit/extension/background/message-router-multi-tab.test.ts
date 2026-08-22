import type { Mock } from 'vitest';
import type { CollectOpenTabsMessage, CollectOpenTabsResponse, ListOpenTabsResponse } from '@mbd/core/types';

vi.mock('@/extension/shared/active-tab/collect-open-tabs', () => ({
  collectOpenTabs: vi.fn(),
  listOpenTabs: vi.fn(),
}));

import { messageRouter } from '@/extension/background/message-router';
import { collectOpenTabs, listOpenTabs } from '@/extension/shared/active-tab/collect-open-tabs';

const sender = (tabId = 4, windowId = 12): chrome.runtime.MessageSender => ({
  tab: { id: tabId, windowId } as chrome.tabs.Tab,
});

describe('background multi-tab bridge', () => {
  beforeEach(() => {
    (collectOpenTabs as Mock).mockReset();
    (listOpenTabs as Mock).mockReset();
    (chrome.tabs.sendMessage as Mock).mockReset().mockResolvedValue(undefined);
  });

  it('lists tabs only from the sender tab window', async () => {
    (listOpenTabs as Mock).mockResolvedValue([{ id: 7, title: 'Seven', url: 'https://seven.example/' }]);
    const response = await new Promise<ListOpenTabsResponse>((resolve) => {
      expect(messageRouter.LIST_OPEN_TABS!(
        { type: 'LIST_OPEN_TABS' }, sender(), (value) => resolve(value as ListOpenTabsResponse),
      )).toBe(true);
    });

    expect(listOpenTabs).toHaveBeenCalledWith(12);
    expect(response).toEqual({ ok: true, tabs: [{ id: 7, title: 'Seven', url: 'https://seven.example/' }] });
  });

  it('collects selected tabs in the sender window and relays scoped progress', async () => {
    (collectOpenTabs as Mock).mockImplementation(async (options) => {
      options.onProgress(1, 2);
      return { items: [], scanned: 1, skipped: 1 };
    });
    const message: CollectOpenTabsMessage = { type: 'COLLECT_OPEN_TABS', requestId: 'scan-1', tabIds: [3, 8] };
    const response = await new Promise<CollectOpenTabsResponse>((resolve) => {
      expect(messageRouter.COLLECT_OPEN_TABS!(
        message, sender(), (value) => resolve(value as CollectOpenTabsResponse),
      )).toBe(true);
    });

    expect(collectOpenTabs).toHaveBeenCalledWith(expect.objectContaining({ windowId: 12, tabIds: [3, 8] }));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(4, {
      type: 'COLLECT_OPEN_TABS_PROGRESS', requestId: 'scan-1', done: 1, total: 2,
    });
    expect(response).toEqual({ ok: true, items: [], scanned: 1, skipped: 1 });
  });

  it('fails closed when a content-script request has no originating tab window', () => {
    const respond = vi.fn();
    const result = messageRouter.COLLECT_OPEN_TABS!(
      { type: 'COLLECT_OPEN_TABS', requestId: 'scan-2' },
      {} as chrome.runtime.MessageSender,
      respond,
    );

    expect(result).toBeUndefined();
    expect(collectOpenTabs).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'no-origin-tab' }));
  });
});
