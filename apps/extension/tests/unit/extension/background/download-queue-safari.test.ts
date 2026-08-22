import type { Mock } from 'vitest';

const { download, recordDownloads } = vi.hoisted(() => ({
  download: vi.fn(async () => ({ kind: 'untracked' as const })),
  recordDownloads: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock('@/extension/platform', () => ({
  platform: {
    downloader: {
      available: true,
      download,
      search: vi.fn(async () => []),
      cancel: vi.fn(),
      open: vi.fn(),
      show: vi.fn(),
      onChanged: vi.fn(),
    },
  },
}));
vi.mock('@mbd/storage/history', () => ({ recordDownloads }));

import {
  enqueueDownloads,
  getQueueSnapshot,
  initQueueDispatcher,
} from '@/extension/background/download/download-queue';

describe('Safari untracked queue dispatch', () => {
  beforeEach(() => {
    const store: Record<string, unknown> = {};
    (chrome.storage.local.get as Mock).mockImplementation(async (key: string) =>
      key in store ? { [key]: store[key] } : {});
    (chrome.storage.local.set as Mock).mockImplementation(async (value: Record<string, unknown>) => {
      Object.assign(store, value);
    });
    download.mockClear();
    recordDownloads.mockClear();
    initQueueDispatcher({ getConcurrency: () => 5, getSaveAs: () => false });
  });

  it('completes more than the concurrency cap without waiting for nonexistent ids', async () => {
    await enqueueDownloads(Array.from({ length: 7 }, (_, index) => ({
      url: `https://cdn.example/${index}.jpg`,
      filename: `${index}.jpg`,
      history: {
        src: `https://cdn.example/${index}.jpg`,
        filename: `${index}.jpg`,
        kind: 'image' as const,
        type: 'image/jpeg',
        sourcePageUrl: 'https://example.com/',
      },
    })));

    await vi.waitFor(async () => {
      const state = await getQueueSnapshot();
      expect(state.items.filter((item) => item.status === 'done')).toHaveLength(7);
    });
    const state = await getQueueSnapshot();
    expect(download).toHaveBeenCalledTimes(7);
    expect(recordDownloads).toHaveBeenCalledTimes(7);
    expect(state.items.every((item) => item.downloadId === undefined)).toBe(true);
  });
});
