import type { CaptureArtifact, CaptureSink } from '@mbd/core/types';
import {
  FILE_CAPTURE_MAX_BYTES,
  MEMORY_CAPTURE_MAX_BYTES,
} from '@mbd/core/download/stream/capture-constants';

const DIRECTORY = 'mbd-captures';
const QUOTA_RESERVE = 128 * 1024 * 1024;
const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

type ArtifactRecord = {
  url: string;
  backing: CaptureArtifact['backing'];
  directory?: FileSystemDirectoryHandle;
  filename?: string;
};

const artifacts = new Map<string, ArtifactRecord>();
let purgePromise: Promise<void> | null = null;

const token = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

class MemoryCaptureSink implements CaptureSink {
  readonly backing = 'memory' as const;
  readonly limit: number;
  private chunks: ArrayBuffer[] = [];
  size = 0;

  constructor(limit = MEMORY_CAPTURE_MAX_BYTES) {
    this.limit = Math.min(limit, MEMORY_CAPTURE_MAX_BYTES);
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.size + chunk.byteLength > this.limit) throw new Error('memory-limit');
    this.size += chunk.byteLength;
    this.chunks.push(arrayBuffer(chunk));
  }

  async finalize(mime: string): Promise<CaptureArtifact> {
    // Blob creation may retain the source chunks. Reserve an equal-sized working
    // copy inside the fixed memory budget rather than failing during allocation.
    if (this.size * 2 > this.limit) throw new Error('memory-limit');
    const url = URL.createObjectURL(new Blob(this.chunks, { type: mime }));
    const cleanupToken = token();
    artifacts.set(cleanupToken, { url, backing: 'memory' });
    this.chunks = [];
    return { url, size: this.size, backing: 'memory', cleanupToken };
  }

  async abort(): Promise<void> {
    this.chunks = [];
    this.size = 0;
  }
}

class OpfsCaptureSink implements CaptureSink {
  readonly backing = 'opfs' as const;
  size = 0;
  private closed = false;

  constructor(
    readonly limit: number,
    private directory: FileSystemDirectoryHandle,
    private filename: string,
    private handle: FileSystemFileHandle,
    private writable: FileSystemWritableFileStream,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('capture-sink-closed');
    if (this.size + chunk.byteLength > this.limit) throw new Error('too-large');
    await this.writable.write(arrayBuffer(chunk));
    this.size += chunk.byteLength;
  }

  async finalize(): Promise<CaptureArtifact> {
    if (!this.closed) {
      await this.writable.close();
      this.closed = true;
    }
    const file = await this.handle.getFile();
    const url = URL.createObjectURL(file);
    const cleanupToken = `opfs:${this.filename}`;
    artifacts.set(cleanupToken, { url, backing: 'opfs', directory: this.directory, filename: this.filename });
    return { url, size: this.size, backing: 'opfs', cleanupToken };
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      try { await this.writable.abort(); } catch { /* already closed */ }
      this.closed = true;
    }
    try { await this.directory.removeEntry(this.filename); } catch { /* already removed */ }
  }
}

export async function purgeAbandonedCaptureFiles(): Promise<void> {
  if (!navigator.storage?.getDirectory) return;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
    const now = Date.now();
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== 'file') continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (now - file.lastModified > STALE_AFTER_MS) await directory.removeEntry(name);
      } catch { /* best-effort startup cleanup */ }
    }
  } catch { /* OPFS unavailable */ }
}

export async function createCaptureSink(runId: string, requestedLimit = FILE_CAPTURE_MAX_BYTES): Promise<CaptureSink> {
  purgePromise ??= purgeAbandonedCaptureFiles();
  await purgePromise;
  if (navigator.storage?.getDirectory) {
    try {
      try { await navigator.storage.persist?.(); } catch { /* persistence is advisory */ }
      const estimate = await navigator.storage.estimate();
      const available = typeof estimate.quota === 'number'
        ? Math.max(0, estimate.quota - (estimate.usage ?? 0) - QUOTA_RESERVE)
        : FILE_CAPTURE_MAX_BYTES;
      const limit = Math.min(requestedLimit, FILE_CAPTURE_MAX_BYTES, available);
      if (limit < 1024 * 1024) throw new Error('insufficient-storage');
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
      const safeRun = runId.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'capture';
      const filename = `${Date.now()}-${safeRun}-${token()}.part`;
      const handle = await directory.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      return new OpfsCaptureSink(limit, directory, filename, handle, writable);
    } catch (error) {
      if (error instanceof Error && error.message === 'insufficient-storage') throw error;
      // OPFS unsupported/denied: use the conservative memory sink.
    }
  }
  return new MemoryCaptureSink(requestedLimit);
}

export async function createMemoryArtifact(bytes: Uint8Array, mime: string): Promise<CaptureArtifact> {
  if (bytes.byteLength * 2 > MEMORY_CAPTURE_MAX_BYTES) throw new Error('memory-limit');
  const url = URL.createObjectURL(new Blob([arrayBuffer(bytes)], { type: mime }));
  const cleanupToken = token();
  artifacts.set(cleanupToken, { url, backing: 'memory' });
  return { url, size: bytes.byteLength, backing: 'memory', cleanupToken };
}

export async function cleanupCaptureArtifact(cleanupToken: string): Promise<void> {
  const artifact = artifacts.get(cleanupToken);
  if (!artifact) {
    // OPFS tokens are self-describing so cleanup remains idempotent across an
    // offscreen/service-worker restart that clears this realm's in-memory map.
    const filename = cleanupToken.startsWith('opfs:') ? cleanupToken.slice(5) : '';
    if (!/^[a-z0-9_-]{1,200}\.part$/i.test(filename) || !navigator.storage?.getDirectory) return;
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
      await directory.removeEntry(filename);
    } catch { /* already removed or OPFS unavailable */ }
    return;
  }
  artifacts.delete(cleanupToken);
  URL.revokeObjectURL(artifact.url);
  if (artifact.backing === 'opfs' && artifact.directory && artifact.filename) {
    try { await artifact.directory.removeEntry(artifact.filename); } catch { /* already removed */ }
  }
}

export async function cleanupAllCaptureArtifacts(): Promise<void> {
  await Promise.all([...artifacts.keys()].map((cleanupToken) => cleanupCaptureArtifact(cleanupToken)));
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void cleanupAllCaptureArtifacts(); });
}
