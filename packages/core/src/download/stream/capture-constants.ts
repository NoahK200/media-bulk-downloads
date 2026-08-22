/**
 * Capture policy shared by the offscreen engine host (which enforces the cap)
 * and the background (which supplies quality/cap to the offscreen document).
 * Applies to BOTH the HLS and DASH engines — the `STREAM_` prefix is deliberate.
 */

/** Release-1 memory-only cap. File-backed capture uses FILE_CAPTURE_MAX_BYTES. */
export const MEMORY_CAPTURE_MAX_BYTES = 256 * 1024 * 1024;
/** Backward-compatible engine option name while capture remains memory-backed. */
export const STREAM_MAX_BYTES = MEMORY_CAPTURE_MAX_BYTES;
/** Release-2 OPFS-backed direct-stream cap. */
export const FILE_CAPTURE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
export const RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
export const PREFETCH_MAX_BYTES = 64 * 1024 * 1024;

/** Default capture quality — the variant/representation closest to 720p, a sane
 *  size/quality balance for typical VOD clips. */
export const STREAM_TARGET_HEIGHT = 720;
