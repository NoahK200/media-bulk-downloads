const MAX_ITEMS = 5_000;
const MAX_URL_CHARS = 16_384;
const MAX_TEXT_CHARS = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = 128 * 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const shortString = (value: unknown, max = MAX_URL_CHARS): value is string =>
  typeof value === 'string' && value.length <= max;
const webOrImageDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && (
    (value.length <= MAX_URL_CHARS && /^https?:\/\//i.test(value))
    || (value.length <= MAX_BASE64_CHARS && /^data:image\//i.test(value))
    // Preserve safe legacy/test relative media references while rejecting
    // protocol-relative and active/custom schemes.
    || (value.length <= MAX_URL_CHARS && !value.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(value))
  );
const finiteNonNegative = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

function validMedia(value: unknown): boolean {
  if (!isObject(value) || !webOrImageDataUrl(value.src)) return false;
  if (value.kind !== 'image' && value.kind !== 'video' && value.kind !== 'audio') return false;
  return typeof value.type === 'string'
    && value.type.length <= 256
    && finiteNonNegative(value.width, 100_000)
    && finiteNonNegative(value.height, 100_000)
    && finiteNonNegative(value.fileSize)
    && typeof value.isBase64 === 'boolean'
    && (value.alt === undefined || shortString(value.alt, 1_024));
}

function validArray(value: unknown, item: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(item);
}

/** Runtime messages cross extension contexts and are therefore untrusted even
 * when their TypeScript producer is internal. Reject excessive or malformed
 * payloads before they reach storage, downloads, URL, or capture sinks. */
export function isValidBackgroundMessage(value: unknown): value is Record<string, unknown> & { type: string } {
  if (!isObject(value) || !shortString(value.type, 64)) return false;
  switch (value.type) {
    case 'DOWNLOAD_IMAGES': return validArray(value.images, validMedia);
    case 'DOWNLOAD_ZIP': return shortString(value.filename, 1_024) && shortString(value.b64, MAX_BASE64_CHARS);
    case 'DOWNLOAD_TEXT': return shortString(value.filename, 1_024) && shortString(value.mime, 256) && shortString(value.text, MAX_TEXT_CHARS);
    case 'DOWNLOAD_BYTES': return shortString(value.filename, 1_024) && shortString(value.mime, 256) && shortString(value.b64, MAX_BASE64_CHARS);
    case 'SET_SETTINGS': return isObject(value.patch);
    case 'SET_PRIVACY_PREFERENCES': return isObject(value.patch);
    case 'COLLECT_OPEN_TABS': return shortString(value.requestId, 128)
      && value.requestId.length > 0
      && (value.tabIds === undefined
        || (Array.isArray(value.tabIds)
          && value.tabIds.length <= 50
          && value.tabIds.every((id) => Number.isInteger(id) && id > 0)
          && new Set(value.tabIds).size === value.tabIds.length));
    case 'SET_PER_HOST_SETTINGS': return shortString(value.host, 253) && (value.patch === null || isObject(value.patch));
    case 'SAVE_SCAN_MEMORY': return shortString(value.host, 253) && isObject(value.sample);
    case 'RESTORE_DATA': return validArray(value.favourites, (v) => isObject(v) && webOrImageDataUrl(v.src))
      && validArray(value.history, (v) => isObject(v) && webOrImageDataUrl(v.src))
      && validArray(value.excluded, (v) => isObject(v) && shortString(v.value));
    case 'OPEN_URL': return shortString(value.url) && /^https?:\/\//i.test(value.url);
    case 'OPEN_DOWNLOAD_FILE':
    case 'SHOW_DOWNLOAD': return Number.isInteger(value.downloadId) && (value.downloadId as number) >= 0;
    case 'RESOLVE_ORIGINALS': return validArray(value.hints, (v) => isObject(v)
      && webOrImageDataUrl(v.src)
      && isObject(v.hint)
      && shortString(v.hint.platform, 64)
      && shortString(v.hint.id, 8_192))
      && (value.credentialScopes === undefined
        || (Array.isArray(value.credentialScopes)
          && value.credentialScopes.length <= 1
          && value.credentialScopes.every((scope) => scope === 'sankaku-session')));
    case 'CAPTURE_STREAM': return shortString(value.runId, 128)
      && validMedia(value.item)
      && isObject(value.sourcePage)
      && shortString(value.sourcePage.url);
    case 'LIST_VARIANTS': return webOrImageDataUrl(value.manifestUrl) && (value.engine === 'hls' || value.engine === 'dash');
    case 'CAPTURE_PROGRESS': return shortString(value.runId, 128)
      && finiteNonNegative(value.done)
      && finiteNonNegative(value.total)
      && (value.bytesDone === undefined || finiteNonNegative(value.bytesDone))
      && (value.bytesLimit === undefined || finiteNonNegative(value.bytesLimit));
    case 'X_MEDIA_SEEN': return validArray(value.pairs, (pair) => Array.isArray(pair)
      && pair.length === 2
      && shortString(pair[0], 8_192)
      && isObject(pair[1])
      && webOrImageDataUrl(pair[1].url));
    case 'PASSIVE_SNIFFER_SEEN': return ['ig', 'fb', 'pinterest', 'mangadex', 'hls'].includes(value.kind as string)
      && validArray(value.entries, (entry) => value.kind === 'hls' ? webOrImageDataUrl(entry) : isObject(entry));
    case 'QUEUE_CANCEL': return value.id === undefined || shortString(value.id, 128);
    case 'QUEUE_RETRY': return shortString(value.id, 128) && (value.referer === undefined || typeof value.referer === 'boolean');
    case 'QUEUE_OPEN': return shortString(value.id, 128);
    case 'REMOVE_HISTORY_ENTRY':
    case 'REMOVE_FAVOURITE': return webOrImageDataUrl(value.src);
    case 'ADD_FAVOURITE': return isObject(value.entry)
      && webOrImageDataUrl(value.entry.src)
      && (value.entry.kind === 'image' || value.entry.kind === 'video' || value.entry.kind === 'audio')
      && shortString(value.entry.type, 256)
      && finiteNonNegative(value.entry.time);
    case 'ADD_EXCLUDED': return isObject(value.entry)
      && (value.entry.kind === 'url' || value.entry.kind === 'host')
      && shortString(value.entry.value)
      && finiteNonNegative(value.entry.time);
    case 'REMOVE_EXCLUDED': return (value.kind === 'url' || value.kind === 'host') && shortString(value.value);
    case 'QUEUE_PAUSE':
    case 'QUEUE_RESUME':
    case 'QUEUE_CLEAR':
    case 'GET_SETTINGS':
    case 'GET_PRIVACY_PREFERENCES':
    case 'LIST_OPEN_TABS':
    case 'GET_DOWNLOADED_SRCS':
    case 'GET_PASSIVE_SNIFFER_SNAPSHOT':
    case 'CLEAR_HISTORY':
    case 'CLEAR_FAVOURITES':
    case 'CLEAR_EXCLUDED': return true;
    default: return false;
  }
}
