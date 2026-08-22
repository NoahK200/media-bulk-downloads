import {
  cleanupCaptureArtifact,
  createCaptureSink,
} from '@/extension/capture/capture-sink';

describe('capture sinks', () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: originalStorage });
    vi.restoreAllMocks();
  });

  it('uses the conservative memory sink when OPFS is unavailable', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: vi.fn() } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:memory');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const sink = await createCaptureSink('memory', 1_024);
    expect(sink.backing).toBe('memory');
    await sink.write(new Uint8Array(100));
    const artifact = await sink.finalize('video/mp2t', 'ts');
    expect(artifact).toMatchObject({ backing: 'memory', size: 100, url: 'blob:memory' });
    await cleanupCaptureArtifact(artifact.cleanupToken);
    expect(revoke).toHaveBeenCalledWith('blob:memory');
  });

  it('writes and cleans a file-backed OPFS artifact', async () => {
    const chunks: ArrayBuffer[] = [];
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const fileHandle = {
      kind: 'file',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn(async (chunk: ArrayBuffer) => { chunks.push(chunk); }),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      }),
      getFile: vi.fn(async () => new File(chunks, 'capture.part', { type: 'video/mp2t', lastModified: Date.now() })),
    };
    const directory = {
      kind: 'directory',
      entries: async function* () { /* no stale files */ },
      getFileHandle: vi.fn().mockResolvedValue(fileHandle),
      removeEntry,
    };
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(directory) };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
        estimate: vi.fn().mockResolvedValue({ quota: 1024 * 1024 * 1024, usage: 0 }),
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:opfs');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const sink = await createCaptureSink('opfs', 2 * 1024 * 1024);
    expect(sink.backing).toBe('opfs');
    await sink.write(new Uint8Array([1, 2, 3]));
    const artifact = await sink.finalize('video/mp2t', 'ts');
    expect(artifact).toMatchObject({ backing: 'opfs', size: 3, url: 'blob:opfs' });
    await cleanupCaptureArtifact(artifact.cleanupToken);
    expect(removeEntry).toHaveBeenCalled();
  });

  it('cleans an OPFS token idempotently after an offscreen-host restart', async () => {
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const directory = { removeEntry };
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(directory) };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: vi.fn().mockResolvedValue(root) },
    });
    await cleanupCaptureArtifact('opfs:1700000000000-run-deadbeef.part');
    expect(removeEntry).toHaveBeenCalledWith('1700000000000-run-deadbeef.part');
  });

  it('streams a simulated 1.5 GiB direct artifact without retaining written chunks', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const fileHandle = {
      kind: 'file',
      createWritable: vi.fn().mockResolvedValue({
        write,
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      }),
      getFile: vi.fn(async () => new File([], 'capture.part', { type: 'video/mp2t' })),
    };
    const directory = {
      kind: 'directory',
      entries: async function* () { /* no stale files */ },
      getFileHandle: vi.fn().mockResolvedValue(fileHandle),
      removeEntry,
    };
    const root = { getDirectoryHandle: vi.fn().mockResolvedValue(directory) };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue(root),
        estimate: vi.fn().mockResolvedValue({ quota: 3 * 1024 ** 3, usage: 0 }),
        persist: vi.fn().mockResolvedValue(true),
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:large-opfs');
    const sink = await createCaptureSink('large', 2 * 1024 ** 3);
    const chunk = new Uint8Array(16 * 1024 ** 2);
    for (let index = 0; index < 96; index++) await sink.write(chunk);
    const artifact = await sink.finalize('video/mp2t', 'ts');
    expect(artifact).toMatchObject({ backing: 'opfs', size: 1.5 * 1024 ** 3 });
    expect(write).toHaveBeenCalledTimes(96);
    await cleanupCaptureArtifact(artifact.cleanupToken);
  });
});
