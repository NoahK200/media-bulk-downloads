import { STREAM_MAX_BYTES, STREAM_TARGET_HEIGHT } from '@mbd/core/download/stream/capture-constants';

describe('capture-constants', () => {
  it('caps memory-backed assembly at 256 MiB', () => {
    expect(STREAM_MAX_BYTES).toBe(256 * 1024 * 1024);
  });
  it('targets 720p by default', () => {
    expect(STREAM_TARGET_HEIGHT).toBe(720);
  });
});
