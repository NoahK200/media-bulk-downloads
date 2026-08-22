import { captureHls, HlsError } from '@mbd/core/download/stream/hls';
import { captureDash, DashError } from '@mbd/core/download/stream/dash';
import { browserHlsDeps } from '@mbd/core/download/stream/hls-webcrypto';
import { browserDashDeps } from '@mbd/core/download/stream/dash-fetch';
import { encodeMp3, mp3BitrateFor, canTranscodeToMp3 } from '@mbd/core/download/stream/mp3';
import type { AudioFormat, CaptureRunResult } from '@mbd/core/types';
import type { CaptureRunRequest } from '@mbd/platform';
import { createCaptureSink, createMemoryArtifact } from '@/extension/capture/capture-sink';
import { MEMORY_CAPTURE_MAX_BYTES } from '@mbd/core/download/stream/capture-constants';

/**
 * The browser-agnostic capture host body: assemble an HLS/DASH stream (optionally
 * audio-only, optionally transcoded to MP3) in whatever DOM-capable realm calls
 * it, and return an object URL for the muxed file. Chrome runs this inside the
 * offscreen document; Firefox and Safari run it directly in their DOM-capable
 * background/extension page. Requires URL.createObjectURL + WebCrypto + Web Audio
 * (OfflineAudioContext, for the MP3 decode) + a CORS-free fetch — all present in
 * every host that calls it. Broadcasts CAPTURE_PROGRESS for the popup/bubble.
 */

/**
 * Decode the extracted M4A (AAC) and re-encode it to a CBR MP3 (#321). An
 * OfflineAudioContext (not a realtime AudioContext) does the decode — it touches
 * no audio hardware and is exempt from the autoplay policy, so no user gesture or
 * running graph is needed. lamejs is fed the decoded buffer's own sample rate, so
 * pitch is correct regardless of whether the decode resampled.
 */
async function transcodeToMp3(m4a: Uint8Array, kbps: number): Promise<Uint8Array> {
  if (!canTranscodeToMp3(m4a.byteLength)) throw new Error('mp3: audio too large to transcode');
  const ab = m4a.buffer.slice(m4a.byteOffset, m4a.byteOffset + m4a.byteLength) as ArrayBuffer;
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const audio = await ctx.decodeAudioData(ab);
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
  return encodeMp3(channels, audio.sampleRate, kbps);
}

export async function runCaptureInContext(req: CaptureRunRequest): Promise<CaptureRunResult> {
  const { runId, manifestUrl, engine, quality, maxBytes } = req;
  const audioOnly = !!req.audioOnly;
  const audioFormat: AudioFormat = req.audioFormat ?? 'm4a';
  const onProgress = (done: number, total: number): void => {
    void chrome.runtime.sendMessage({ type: 'CAPTURE_PROGRESS', runId, done, total });
  };
  let res;
  let sink: Awaited<ReturnType<typeof createCaptureSink>> | undefined;
  try {
    if (engine === 'hls' && (!audioOnly || audioFormat === 'm4a')) {
      sink = await createCaptureSink(runId, maxBytes);
    }
    res = engine === 'dash'
      ? await captureDash(manifestUrl, browserDashDeps(onProgress), {
          quality,
          maxBytes: Math.min(maxBytes, MEMORY_CAPTURE_MAX_BYTES),
          audioOnly,
        })
      : await captureHls(manifestUrl, browserHlsDeps(onProgress), {
          quality,
          maxBytes: sink?.limit ?? Math.min(maxBytes, MEMORY_CAPTURE_MAX_BYTES),
          audioOnly,
          sink,
        });
  } catch (e) {
    await sink?.abort();
    const code = e instanceof HlsError || e instanceof DashError ? e.code : 'unknown';
    if (e instanceof Error && e.message === 'insufficient-storage') return { ok: false, code: 'insufficient-storage' };
    return { ok: false, code };
  }

  if ('artifact' in res && res.artifact) {
    return {
      ok: true,
      blobUrl: res.artifact.url,
      size: res.artifact.size,
      backing: res.artifact.backing,
      cleanupToken: res.artifact.cleanupToken,
      ext: res.ext,
      segmentCount: res.segmentCount,
      muxedAudio: !!res.muxedAudio,
    };
  }
  await sink?.abort();

  const kbps = audioOnly ? mp3BitrateFor(audioFormat) : null;
  try {
    if (kbps !== null) {
      const mp3 = await transcodeToMp3(res.bytes, kbps);
      const artifact = await createMemoryArtifact(mp3, 'audio/mpeg');
      return { ok: true, blobUrl: artifact.url, size: artifact.size, backing: artifact.backing, cleanupToken: artifact.cleanupToken, ext: 'mp3', segmentCount: res.segmentCount, muxedAudio: !!res.muxedAudio };
    }
    const artifact = await createMemoryArtifact(res.bytes, res.mime);
    return { ok: true, blobUrl: artifact.url, size: artifact.size, backing: artifact.backing, cleanupToken: artifact.cleanupToken, ext: res.ext, segmentCount: res.segmentCount, muxedAudio: !!res.muxedAudio };
  } catch {
    return { ok: false, code: kbps !== null ? 'mp3_transcode_failed' : 'memory-limit' };
  }
}
