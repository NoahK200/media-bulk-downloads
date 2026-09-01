import {
  ChromeMessage,
  DownloadResponse,
  ResolveOriginalsResponse,
  ProbeMediaMetaResponse,
  CaptureStreamResponse,
  SettingsData,
  ListVariantsResult,
  MutationResponse,
  PrivacyPreferences,
  PersistenceResult,
  CollectOpenTabsProgressMessage,
  CollectOpenTabsResponse,
  ListOpenTabsResponse,
} from '@mbd/core/types';
import { filterImagesBySettings, filterExcluded } from '@mbd/core/collection/filters';
import { textToBase64 } from '@mbd/core/download/base64';
import { buildMediaSidecar, serializeSidecar } from '@mbd/core/download/metadata-sidecar';
import { recordDownloads, removeEntry, clearHistory, restoreHistory, loadHistory, srcsStillOnDisk, DiskState } from '@mbd/storage/history';
import { addFavourite, removeFavourite, clearFavourites, restoreFavourites } from '@mbd/storage/favourites';
import { addExcluded, removeExcluded, clearExcluded, restoreExcluded } from '@mbd/storage/excluded';
import { savePerHostSettings, clearPerHostSettings } from '@mbd/storage/per-host-settings';
import { clearScanMemoryForHost, saveScanMemoryForHost } from '@mbd/storage/per-host-scan-memory';
import { streamErrorMessage } from '@mbd/core/download/stream/stream-error-message';
import { isMasterPlaylist } from '@mbd/core/download/stream/hls';
import { variantsFromMaster, variantsFromMpd } from '@mbd/core/download/stream/variants';
import { assertSafeCaptureUrl } from '@mbd/core/download/stream/ssrf-guard';
import { probeMediaMetaBatch } from '@mbd/core/net/size-probe';
import { retryingFetch } from '@mbd/core/net/retry';
import { readBoundedText } from '@mbd/core/download/stream/bounded-fetch';
import { MANIFEST_MAX_BYTES } from '@mbd/core/download/stream/capture-constants';
import {
  pauseQueue, resumeQueue, cancelQueue, retryQueueItem,
  clearFinishedQueue, retryAllFailedQueue, openQueueItem,
} from '@/extension/background/download/download-queue';
import { enqueueMedia } from '@/extension/background/download/enqueue-media';
import { scheduleSidecar } from '@/extension/background/download/sidecar-writer';
import { platform } from '@/extension/platform';
import type { QueueState } from '@mbd/storage/download-queue';
import {
  currentPrivacy,
  currentSettings,
  excludedCache,
  settingsReady,
  privacyReady,
  excludedReady,
  setCurrentPrivacy,
  writeSettingsPatch,
} from '@/extension/background/state';
import {
  clearPassiveSnifferEntries,
  getPassiveSnifferSnapshot,
  storePassiveSnifferEntries,
  storeSniffedMedia,
  snifferByTab,
  resolveOriginalsBatch,
  type PassiveSnifferSnapshot,
} from '@/extension/background/sniffer-store';
import { captureStreamToFile, captureRunTabs } from '@/extension/background/download/capture';
import { patchPrivacyPreferences } from '@mbd/storage/privacy';
import { injectObservationIntoOpenTabs, stopObservationInOpenTabs } from '@/extension/background/content-scripts';
import { collectOpenTabs, listOpenTabs } from '@/extension/shared/active-tab/collect-open-tabs';

/** Response callback shape for the background message router. */
export type SendResponse = (
  response: DownloadResponse | MutationResponse | ResolveOriginalsResponse | ProbeMediaMetaResponse | string[] | CaptureStreamResponse | QueueState | SettingsData | PrivacyPreferences | ListVariantsResult | PassiveSnifferSnapshot | ListOpenTabsResponse | CollectOpenTabsResponse,
) => void;

/** Push the current settings to every tab's content script so the on-page bubble
 *  applies changes live. Safari content scripts don't fire storage.onChanged for
 *  sync writes, so this broadcast — not the storage event — is what drives them.
 *  Used for both local writes (SET_SETTINGS) and remotely-synced changes picked up
 *  by the background's storage.onChanged. */
export function broadcastSettings(settings: SettingsData): void {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.id != null) {
        void chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_CHANGED', settings }).catch(() => {
          /* tab has no content script / was closed */
        });
      }
    }
  });
}

/**
 * One handler per message `type`. A handler returns `true` to keep the
 * sendResponse channel open for an async reply, and nothing otherwise
 * (fire-and-forget / synchronous). Each handler receives its message already
 * narrowed to that type, so there are no per-branch casts. Message types not
 * listed here are handled elsewhere (content scripts) and fall through to no
 * response.
 */
/** The object-shaped ChromeMessages (those with a discriminating `type`); the
 *  union also carries bare-string messages (GET_IMAGES, …) handled elsewhere. */
type ObjectMessage = Extract<ChromeMessage, { type: string }>;

/** Bounds on the explicit size/type probe: one request per item, so a huge
 *  gallery must not turn one click into a thousand parallel requests. */
const PROBE_CAP = 400;
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 10_000;

/** Popup status for a queued batch, including any skipped-as-duplicate count. */
function queuedSkipMessage(queued: number, skipped: number): string {
  if (queued === 0) return skipped > 0 ? `Nothing new — ${skipped} already saved.` : 'No files to download.';
  const s = queued === 1 ? '' : 's';
  const tail = skipped > 0 ? ` (${skipped} skipped — already saved)` : '';
  return `Queued ${queued} download${s}${tail}.`;
}

function mutationResult(result: PersistenceResult, successMessage?: string): MutationResponse {
  return result.ok
    ? { status: 'success', ...(successMessage ? { message: successMessage } : {}) }
    : {
        status: 'error',
        code: `storage-${result.code}`,
        message: result.code === 'quota'
          ? 'This change was not saved because extension storage is full.'
          : 'This change could not be saved. Please try again.',
      };
}

type MessageRouter = {
  [K in ObjectMessage['type']]?: (
    message: Extract<ObjectMessage, { type: K }>,
    sender: chrome.runtime.MessageSender,
    respond: SendResponse,
  ) => boolean | void;
};

export const messageRouter: MessageRouter = {
  X_MEDIA_SEEN: (message, sender) => {
    if (sender.tab?.id != null) storeSniffedMedia(sender.tab.id, message.pairs);
  },

  PASSIVE_SNIFFER_SEEN: (message, sender) => {
    if (sender.tab?.id != null) storePassiveSnifferEntries(sender.tab.id, message.kind, message.entries);
  },

  GET_PASSIVE_SNIFFER_SNAPSHOT: (_message, sender, respond) => {
    respond(sender.tab?.id == null
      ? { ig: [], fb: [], pinterest: [], mangadex: [], hls: [] }
      : getPassiveSnifferSnapshot(sender.tab.id));
  },

  DOWNLOAD_IMAGES: (message, _sender, respond) => {
    const { images, sourcePage } = message;
    void Promise.all([settingsReady, excludedReady]).then(async () => {
      try {
        const eligible = message.explicit
          ? images
          : filterExcluded(filterImagesBySettings(images, currentSettings), excludedCache);

        const { queued, skipped } = await enqueueMedia(eligible, sourcePage, {
          skipDuplicates: !message.explicit && currentSettings.skipDuplicateDownloads,
        });
        respond({ status: 'success', message: queuedSkipMessage(queued, skipped) });
      } catch (e) {
        respond({ status: 'error', message: `Queue failed: ${e instanceof Error ? e.message : 'unknown error'}` });
      }
    });
    return true;
  },
  QUEUE_PAUSE: (_message, _sender, respond) => {
    void pauseQueue().then(() => respond({ status: 'success', message: 'Paused' }));
    return true;
  },
  QUEUE_RESUME: (_message, _sender, respond) => {
    void resumeQueue().then(() => respond({ status: 'success', message: 'Resumed' }));
    return true;
  },
  QUEUE_CANCEL: (message, _sender, respond) => {
    void cancelQueue(message.id ?? 'all').then(() => respond({ status: 'success', message: 'Cancelled' }));
    return true;
  },
  QUEUE_RETRY: (message, _sender, respond) => {
    const p = message.id === 'all-failed' ? retryAllFailedQueue() : retryQueueItem(message.id, message.referer);
    void p.then(() => respond({ status: 'success', message: 'Retrying' }));
    return true;
  },
  QUEUE_CLEAR: (_message, _sender, respond) => {
    void clearFinishedQueue().then(() => respond({ status: 'success', message: 'Cleared' }));
    return true;
  },
  QUEUE_OPEN: (message, _sender, respond) => {
    void openQueueItem(message.id).then(() => respond({ status: 'success', message: 'Opened' }));
    return true;
  },

  DOWNLOAD_ZIP: (message, _sender, respond) => {
    const { b64, filename } = message;
    void settingsReady.then(async () => {
      const url = `data:application/zip;base64,${b64}`;
      const started = await platform.downloader.download(
        { url, filename, saveAs: currentSettings.saveAs, conflictAction: 'uniquify' },
      );
      if (started.kind === 'failed') {
        respond({ status: 'error', message: `Couldn't save ${filename}.` });
      } else {
        respond({ status: 'success', message: `Saved ${filename}.` });
      }
    });
    return true;
  },

  DOWNLOAD_TEXT: (message) => {
    const { filename, text, mime } = message;
    void settingsReady.then(() => {
      const url = `data:${mime};base64,${textToBase64(text)}`;
      void platform.downloader.download({ url, filename, saveAs: currentSettings.saveAs, conflictAction: 'uniquify' });
    });
  },

  DOWNLOAD_BYTES: (message) => {
    const { filename, b64, mime, source } = message;
    void settingsReady.then(async () => {
      const url = `data:${mime};base64,${b64}`;
      const sidecarJson = currentSettings.metadataSidecar && source
        ? serializeSidecar(buildMediaSidecar(
            { src: source.src, alt: source.alt ?? '', width: source.width ?? 0, height: source.height ?? 0, type: source.type, kind: source.kind, ext: source.ext, fileSize: source.fileSize },
            { url: source.sourcePageUrl, title: source.sourcePageTitle },
            new Date().toISOString(),
          ))
        : undefined;
      const started = await platform.downloader.download(
        { url, filename, saveAs: currentSettings.saveAs, conflictAction: 'uniquify' },
      );
      if (started.kind === 'failed') return;
      if (sidecarJson && started.kind === 'tracked') scheduleSidecar(started.id, filename, sidecarJson);
      if (!source) return;
      void recordDownloads([{
        src: source.src,
        filename: filename.split('/').pop() ?? filename,
        kind: source.kind,
        type: source.type,
        thumbnailSrc: source.thumbnailSrc ?? source.src,
        sourcePageUrl: source.sourcePageUrl,
        sourcePageTitle: source.sourcePageTitle,
        time: Date.now(),
        ...(started.kind === 'tracked' ? { downloadId: started.id } : {}),
      }]);
    });
  },

  SET_SETTINGS: (message, _sender, respond) => {
    void writeSettingsPatch(message.patch).then(({ settings, result }) => {
      if (result.ok) broadcastSettings(settings);
      respond(mutationResult(result, 'Settings saved.'));
    });
    return true;
  },

  GET_SETTINGS: (_message, _sender, respond) => {
    void settingsReady.then(() => respond(currentSettings));
    return true;
  },

  GET_PRIVACY_PREFERENCES: (_message, _sender, respond) => {
    void privacyReady.then(() => respond(currentPrivacy));
    return true;
  },

  SET_PRIVACY_PREFERENCES: (message, _sender, respond) => {
    void patchPrivacyPreferences(message.patch).then(({ result, preferences }) => {
      if (result.ok) {
        const enableObservation = !currentPrivacy.observeMediaRequests && preferences.observeMediaRequests;
        const disableObservation = currentPrivacy.observeMediaRequests && !preferences.observeMediaRequests;
        setCurrentPrivacy(preferences);
        if (enableObservation) void injectObservationIntoOpenTabs();
        if (disableObservation) {
          snifferByTab.clear();
          clearPassiveSnifferEntries();
          stopObservationInOpenTabs();
        }
      }
      respond(mutationResult(result, 'Privacy preferences saved.'));
    });
    return true;
  },

  LIST_OPEN_TABS: (_message, sender, respond) => {
    const windowId = sender.tab?.windowId;
    if (typeof windowId !== 'number' || !Number.isInteger(windowId) || windowId < 0) {
      respond({ ok: false, code: 'no-origin-tab', message: 'The browser window for this panel is unavailable.' });
      return;
    }
    void listOpenTabs(windowId).then(
      (tabs) => respond({ ok: true, tabs }),
      () => respond({ ok: false, code: 'unavailable', message: 'Open tabs could not be listed.' }),
    );
    return true;
  },

  COLLECT_OPEN_TABS: (message, sender, respond) => {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (
      typeof tabId !== 'number'
      || !Number.isInteger(tabId)
      || typeof windowId !== 'number'
      || !Number.isInteger(windowId)
      || windowId < 0
    ) {
      respond({ ok: false, code: 'no-origin-tab', message: 'The browser window for this panel is unavailable.' });
      return;
    }
    void collectOpenTabs({
      windowId,
      ...(message.tabIds ? { tabIds: message.tabIds } : {}),
      onProgress: (done, total) => {
        const progress: CollectOpenTabsProgressMessage = {
          type: 'COLLECT_OPEN_TABS_PROGRESS',
          requestId: message.requestId,
          done,
          total,
        };
        void Promise.resolve(chrome.tabs.sendMessage(tabId, progress)).catch(() => {
          /* requester closed or navigated; collection remains safe to finish */
        });
      },
    }).then(
      (result) => respond({ ok: true, ...result }),
      () => respond({ ok: false, code: 'unknown', message: 'Multi-tab collection failed.' }),
    );
    return true;
  },

  SET_PER_HOST_SETTINGS: (message) => {
    if (message.patch === null) {
      void clearPerHostSettings(message.host);
      void clearScanMemoryForHost(message.host);
    } else void savePerHostSettings(message.host, message.patch);
  },

  SAVE_SCAN_MEMORY: (message) => {
    void saveScanMemoryForHost(message.host, message.sample);
  },

  RESTORE_DATA: (message, _sender, respond) => {
    void Promise.all([
      restoreFavourites(message.favourites),
      restoreHistory(message.history),
      restoreExcluded(message.excluded),
    ]).then((results) => {
      const failed = results.filter((result) => !result.ok);
      respond(failed.length
        ? { status: 'error', code: 'restore-partial', message: `Restore was incomplete: ${failed.length} data store${failed.length === 1 ? '' : 's'} could not be saved.` }
        : { status: 'success', message: 'Backup data restored.' });
    });
    return true;
  },

  OPEN_DOWNLOAD_FILE: (message) => {
    platform.downloader.open(message.downloadId);
  },

  SHOW_DOWNLOAD: (message) => {
    platform.downloader.show(message.downloadId);
  },

  GET_DOWNLOADED_SRCS: (_message, _sender, respond) => {
    void (async () => {
      try {
        const history = await loadHistory();
        const items = await platform.downloader.search({ limit: 0 });
        const existsById = new Map(items.map((it) => [it.id, it.exists]));
        const stateById = (id: number): DiskState =>
          existsById.has(id) ? (existsById.get(id) ? 'exists' : 'deleted') : 'unknown';
        respond(srcsStillOnDisk(history, stateById));
      } catch {
        respond([]);
      }
    })();
    return true;
  },

  OPEN_URL: (message) => {
    if (/^https?:\/\//i.test(message.url)) void chrome.tabs.create({ url: message.url });
  },

  CLEAR_HISTORY: (_message, _sender, respond) => { void clearHistory().then((r) => respond(mutationResult(r))); return true; },
  REMOVE_HISTORY_ENTRY: (message, _sender, respond) => { void removeEntry(message.src).then((r) => respond(mutationResult(r))); return true; },
  ADD_FAVOURITE: (message, _sender, respond) => { void addFavourite(message.entry).then((r) => respond(mutationResult(r))); return true; },
  REMOVE_FAVOURITE: (message, _sender, respond) => { void removeFavourite(message.src).then((r) => respond(mutationResult(r))); return true; },
  CLEAR_FAVOURITES: (_message, _sender, respond) => { void clearFavourites().then((r) => respond(mutationResult(r))); return true; },
  ADD_EXCLUDED: (message, _sender, respond) => { void addExcluded(message.entry).then((r) => respond(mutationResult(r))); return true; },
  REMOVE_EXCLUDED: (message, _sender, respond) => { void removeExcluded(message.kind, message.value).then((r) => respond(mutationResult(r))); return true; },
  CLEAR_EXCLUDED: (_message, _sender, respond) => { void clearExcluded().then((r) => respond(mutationResult(r))); return true; },

  RESOLVE_ORIGINALS: (message, sender, respond) => {
    const seen = new Set<string>();
    const hints = message.hints.filter((h) => {
      if (seen.has(h.src)) return false;
      seen.add(h.src);
      return true;
    });
    const run = (tabId?: number) => {
      const sniffed = tabId != null ? snifferByTab.get(tabId) : undefined;
      void Promise.all([settingsReady, privacyReady]).then(() => {
        const authed = message.credentialScopes?.includes('sankaku-session') === true
          && currentPrivacy.sankakuSessionResolution;
        resolveOriginalsBatch(hints, undefined, sniffed, authed).then((resolved) => respond({ resolved }));
      });
    };
    if (sender.tab?.id != null) run(sender.tab.id);
    else chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => run(tabs[0]?.id));
    return true;
  },

  PROBE_MEDIA_META: (message, _sender, respond) => {
    const srcs = [...new Set(message.srcs)].slice(0, PROBE_CAP);
    void probeMediaMetaBatch(srcs, { fetch: retryingFetch(fetch, { maxAttempts: 2, timeoutMs: PROBE_TIMEOUT_MS }) }, PROBE_CONCURRENCY)
      .then((meta) => respond({ meta }))
      .catch(() => respond({ meta: {} }));
    return true;
  },

  CAPTURE_STREAM: (message, sender, respond) => {
    const { runId, item, sourcePage, audioOnly, audioFormat, quality } = message;
    if (sender.tab?.id != null) captureRunTabs.set(runId, sender.tab.id);
    void settingsReady.then(async () => {
      try {
        const cap = await captureStreamToFile(item, sourcePage, runId, audioOnly, audioFormat, quality);
        captureRunTabs.delete(runId);
        if (!cap.ok) {
          respond({ status: streamErrorMessage(cap.code), refusal: { code: cap.code } });
          return;
        }
        const audioNote = audioOnly ? ' (audio only)' : cap.muxedAudio ? ' (video + audio)' : '';
        respond({
          status: cap.saved
            ? `Captured ${cap.filename} — ${cap.segmentCount} segments${audioNote}.`
            : `Couldn’t save ${cap.filename}.`,
        });
      } catch {
        captureRunTabs.delete(runId);
        respond({ status: 'Couldn’t capture the stream.' });
      }
    });
    return true;
  },

  LIST_VARIANTS: (message, _sender, respond) => {
    const { manifestUrl, engine } = message;
    void (async () => {
      try {
        assertSafeCaptureUrl(manifestUrl);
        const text = await readBoundedText(await fetch(manifestUrl, { redirect: 'error' }), MANIFEST_MAX_BYTES);
        const variants = engine === 'dash'
          ? variantsFromMpd(text, manifestUrl)
          : isMasterPlaylist(text) ? variantsFromMaster(text, manifestUrl) : [];
        respond({ ok: true, variants });
      } catch {
        respond({ ok: false, code: 'variant_list_failed' });
      }
    })();
    return true;
  },

  CAPTURE_PROGRESS: (message) => {
    const tabId = captureRunTabs.get(message.runId);
    if (tabId != null) {
      void chrome.tabs.sendMessage(tabId, message).catch(() => {
        /* tab closed / no receiver */
      });
    }
  },
};
