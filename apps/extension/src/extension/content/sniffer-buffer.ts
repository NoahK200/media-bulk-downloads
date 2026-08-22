export type BufferKey = 'ig' | 'fb' | 'pinterest' | 'mangadex' | 'hls';
export type SnifferBuffer = Record<BufferKey, unknown[]>;
type SharedGlobal = typeof globalThis & { __mbdSnifferBuffer?: SnifferBuffer };
const CAP = 1_000;

export const snifferSnapshot = (): SnifferBuffer => {
  const shared = globalThis as SharedGlobal;
  return shared.__mbdSnifferBuffer ??= { ig: [], fb: [], pinterest: [], mangadex: [], hls: [] };
};

/** Cross-bundle, isolated-world handoff. The relay stays tiny and retains only
 * extracted media metadata; raw response bodies never enter this buffer. */
export function bufferSniffed(key: BufferKey, values: unknown[]): void {
  const target = snifferSnapshot()[key];
  target.push(...values);
  if (target.length > CAP) target.splice(0, target.length - CAP);
}

export function clearSnifferBufferValues(): void {
  const buffered = snifferSnapshot();
  for (const key of Object.keys(buffered) as BufferKey[]) buffered[key].splice(0);
}
