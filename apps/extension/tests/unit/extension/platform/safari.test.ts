/** @vitest-environment jsdom */
import { safariDownloader, safariNotifier, safariHeaderRules } from '@/extension/platform/safari';

afterEach(() => { vi.restoreAllMocks(); });

describe('safariDownloader (anchor-blob)', () => {
  it('fetches an http(s) url to a blob and clicks an <a download>, dropping subdirs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x']), { status: 200 }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this.download); };

    const result = await safariDownloader.download({ url: 'https://cdn/x.jpg', filename: 'sub/dir/photo.jpg' });

    expect(result).toEqual({ kind: 'untracked' });
    expect(createObjectURL).toHaveBeenCalled();
    expect(clicked).toEqual(['photo.jpg']);
    HTMLAnchorElement.prototype.click = orig;
  });

  it('returns an explicit failure on a failed fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    expect(await safariDownloader.download({ url: 'https://cdn/x.jpg', filename: 'x.jpg' })).toEqual({ kind: 'failed', code: 'http-404' });
  });

  it('search() returns [] and open/show are no-ops (no downloads API)', async () => {
    expect(await safariDownloader.search({ limit: 0 })).toEqual([]);
    expect(() => { safariDownloader.open(1); safariDownloader.show(1); safariDownloader.onChanged(() => {}); safariDownloader.cancel(1); }).not.toThrow();
  });
});

describe('safari capability flags', () => {
  it('notifier + header rules report unavailable', () => {
    expect(safariNotifier.available).toBe(false);
    expect(safariHeaderRules.available).toBe(false);
  });
});
