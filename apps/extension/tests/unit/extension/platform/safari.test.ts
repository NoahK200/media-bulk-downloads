/** @vitest-environment jsdom */
import {
  safariDownloader, safariNotifier, safariHeaderRules, __resetSafariDownloadsForTest,
} from '@/extension/platform/safari';

const stubAnchorClick = (): { clicked: string[]; restore: () => void } => {
  const clicked: string[] = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this.download); };
  return { clicked, restore: () => { HTMLAnchorElement.prototype.click = orig; } };
};

beforeEach(() => {
  __resetSafariDownloadsForTest();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('safariDownloader (anchor-blob)', () => {
  it('fetches an http(s) url to a blob and clicks an <a download>, dropping subdirs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x']), { status: 200 }));
    const a = stubAnchorClick();

    const result = await safariDownloader.download({ url: 'https://cdn/x.jpg', filename: 'sub/dir/photo.jpg' });

    expect(result).toEqual({ kind: 'tracked', id: expect.any(Number) });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(a.clicked).toEqual(['photo.jpg']);
    a.restore();
  });

  it('hands out a distinct id per download', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob(['x']), { status: 200 }));
    const a = stubAnchorClick();

    const first = await safariDownloader.download({ url: 'https://cdn/a.jpg', filename: 'a.jpg' });
    const second = await safariDownloader.download({ url: 'https://cdn/b.jpg', filename: 'b.jpg' });

    expect(first.kind).toBe('tracked');
    expect(second.kind).toBe('tracked');
    if (first.kind !== 'tracked' || second.kind !== 'tracked') throw new Error('Expected tracked Safari downloads');
    expect(first.id).not.toBe(second.id);
    a.restore();
  });

  it('search({id}) returns the completed record so the queue can settle it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['xyz']), { status: 200 }));
    const a = stubAnchorClick();

    const result = await safariDownloader.download({ url: 'https://cdn/x.jpg', filename: 'x.jpg' });
    expect(result.kind).toBe('tracked');
    if (result.kind !== 'tracked') throw new Error('Expected tracked Safari download');
    const [rec] = await safariDownloader.search({ id: result.id });

    expect(rec).toMatchObject({ id: result.id, url: 'https://cdn/x.jpg', filename: 'x.jpg', state: 'complete' });
    expect(rec.exists).toBeUndefined();
    a.restore();
  });

  it('notifies onChanged listeners with a terminal state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x']), { status: 200 }));
    const a = stubAnchorClick();
    const seen: { id: number; state?: string }[] = [];
    safariDownloader.onChanged((c) => seen.push(c));

    const result = await safariDownloader.download({ url: 'https://cdn/x.jpg', filename: 'x.jpg' });
    expect(result.kind).toBe('tracked');
    if (result.kind !== 'tracked') throw new Error('Expected tracked Safari download');

    expect(seen).toEqual([{ id: result.id, state: 'complete' }]);
    a.restore();
  });

  it('returns an explicit failure on a failed fetch and records nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    expect(await safariDownloader.download({ url: 'https://cdn/x.jpg', filename: 'x.jpg' })).toEqual({ kind: 'failed', code: 'http-404' });
    expect(await safariDownloader.search({ limit: 0 })).toEqual([]);
  });

  it('caps the in-memory registry so a long session cannot grow it without bound', async () => {
    // A Response body can only be read once — hand each call a fresh one.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Blob(['x']), { status: 200 }));
    const a = stubAnchorClick();

    for (let i = 0; i < 205; i++) {
      await safariDownloader.download({ url: `https://cdn/${i}.jpg`, filename: `${i}.jpg` });
    }
    const all = await safariDownloader.search({ limit: 0 });

    expect(all).toHaveLength(200);
    expect(all[all.length - 1].filename).toBe('204.jpg');
    a.restore();
  });

  it('open/show/cancel stay no-ops (no downloads API)', () => {
    expect(() => { safariDownloader.open(1); safariDownloader.show(1); safariDownloader.cancel(1); }).not.toThrow();
  });
});

describe('safari capability flags', () => {
  it('notifier + header rules report unavailable', () => {
    expect(safariNotifier.available).toBe(false);
    expect(safariHeaderRules.available).toBe(false);
  });
});
