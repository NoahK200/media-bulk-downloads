import { captureHls, type HlsDeps } from '@mbd/core/download/stream/hls';
import type { CaptureSink } from '@mbd/core/types';

const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
one.ts
#EXTINF:4,
two.ts
#EXT-X-ENDLIST`;

describe('captureHls file-backed sink', () => {
  it('writes direct segments in order without returning assembled bytes', async () => {
    const written: number[][] = [];
    let size = 0;
    const sink: CaptureSink = {
      backing: 'opfs',
      limit: 1_024,
      get size() { return size; },
      async write(chunk) { written.push([...chunk]); size += chunk.byteLength; },
      async finalize() { return { url: 'blob:file', size, backing: 'opfs', cleanupToken: 'cleanup' }; },
      async abort() {},
    };
    const deps: HlsDeps = {
      fetchText: async () => manifest,
      fetchBytes: async (url) => new Uint8Array(url.endsWith('one.ts') ? [1] : [2]),
      decrypt: async (_key, _iv, bytes) => bytes,
      concurrency: 4,
    };
    const result = await captureHls('https://cdn.test/index.m3u8', deps, { sink, maxBytes: 1_024 });
    expect(written).toEqual([[1], [2]]);
    expect(result.bytes).toHaveLength(0);
    expect(result.artifact).toEqual({ url: 'blob:file', size: 2, backing: 'opfs', cleanupToken: 'cleanup' });
  });

  it('prefetches at most four segments while preserving write order', async () => {
    const many = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n${Array.from(
      { length: 7 },
      (_, index) => `#EXTINF:1,\n${index}.ts`,
    ).join('\n')}\n#EXT-X-ENDLIST`;
    const written: number[] = [];
    let size = 0;
    let active = 0;
    let peak = 0;
    const sink: CaptureSink = {
      backing: 'opfs',
      limit: 1_024,
      get size() { return size; },
      async write(chunk) { written.push(chunk[0]); size += chunk.byteLength; },
      async finalize() { return { url: 'blob:file', size, backing: 'opfs', cleanupToken: 'cleanup' }; },
      async abort() {},
    };
    const deps: HlsDeps = {
      fetchText: async () => many,
      fetchBytes: async (url) => {
        const index = Number(new URL(url).pathname.slice(1).split('.')[0]);
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, (7 - index) * 2));
        active--;
        return new Uint8Array([index]);
      },
      decrypt: async (_key, _iv, bytes) => bytes,
      concurrency: 20,
    };
    await captureHls('https://cdn.test/index.m3u8', deps, { sink, maxBytes: 1_024 });
    expect(peak).toBe(4);
    expect(written).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('aborts and removes the partial sink when quota is exhausted', async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const sink: CaptureSink = {
      backing: 'opfs',
      limit: 1_024,
      size: 0,
      async write() { throw new DOMException('quota', 'QuotaExceededError'); },
      async finalize() { throw new Error('unreachable'); },
      abort,
    };
    const deps: HlsDeps = {
      fetchText: async () => manifest,
      fetchBytes: async () => new Uint8Array([1]),
      decrypt: async (_key, _iv, bytes) => bytes,
    };
    await expect(captureHls('https://cdn.test/index.m3u8', deps, { sink, maxBytes: 1_024 }))
      .rejects.toMatchObject({ code: 'insufficient-storage' });
    expect(abort).toHaveBeenCalledOnce();
  });
});
