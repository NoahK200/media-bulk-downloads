/**
 * Downloader — the browser-capability seam over the file-download API.
 *
 * Chrome/Edge/Firefox implement this with `chrome.downloads`; Safari (which
 * ships no downloads API) implements it with a page-context `<a download>`
 * blob click. The extension talks only to this interface so the divergent
 * backends stay isolated in the app layer.
 */

/** A single download to start. */
export interface DownloadRequest {
  /** Source URL (http(s) or a blob:/data: URL). */
  url: string;
  /** Suggested target filename, may include a subdirectory on backends that support it. */
  filename: string;
  /** Prompt the user for a save location instead of using the default directory. */
  saveAs?: boolean;
  /** How to resolve an existing file of the same name. */
  conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
}

/** Starting a download is tracked whenever the backend can expose a stable
 * lifecycle id, including Safari's bounded anchor-download registry. The
 * untracked case remains available for capability-degraded backends, and
 * failure is explicit so callers never confuse a missing id with success. */
export type DownloadStartResult =
  | { kind: 'tracked'; id: number }
  | { kind: 'untracked' }
  | { kind: 'failed'; code: string };

/** State of a download as reported by the backend. */
export interface DownloadRecord {
  id: number;
  filename: string;
  /** Original request URL, when the backend reports it. Used to reconcile a
   *  started-but-unpersisted download back to its queue item by URL. */
  url?: string;
  state: 'in_progress' | 'complete' | 'interrupted';
  bytesReceived?: number;
  totalBytes?: number;
  error?: string;
  /** Whether the downloaded file still exists on disk (drives the on-disk
   *  dedupe "already downloaded" mark). Undefined when the backend can't tell. */
  exists?: boolean;
}

/** Query for {@link Downloader.search}. */
export interface DownloadQuery {
  id?: number;
  /** 0 means "all". */
  limit?: number;
}

/** Notified when a download's state changes. */
export type DownloadChangeListener = (change: {
  id: number;
  state?: DownloadRecord['state'];
  error?: string;
}) => void;

export interface Downloader {
  /** Whether this backend can actually download (false on capability-degraded targets). */
  readonly available: boolean;
  /** Start a download and state whether its lifecycle can be tracked. */
  download(request: DownloadRequest): Promise<DownloadStartResult>;
  /** Look up prior/in-flight downloads (used for on-disk dedupe + progress). */
  search(query: DownloadQuery): Promise<DownloadRecord[]>;
  /** Reveal the finished file / open it, when supported. */
  open(id: number): void;
  show(id: number): void;
  /** Cancel an in-flight download. No-op on backends without a cancellable download. */
  cancel(id: number): void;
  /** Subscribe to state changes (progress, completion, failure). */
  onChanged(listener: DownloadChangeListener): void;
}
